'use strict';
// Where the portal keeps the files it writes to Google Drive: LOI signed copies, deal files, and the PDF converter's
// temporary Doc. One of two set-ups (src/config.js loadStorage):
//
//   Shared Drive (service account)  GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_LOI_FOLDER_ID /
//     GOOGLE_DRIVE_DEALS_FOLDER_ID. A service account has no storage of its own, so a My Drive folder shared with it
//     can't take uploads (Drive answers storageQuotaExceeded); this only works in a Shared Drive.
//   My Drive (OAuth)  GOOGLE_DRIVE_OAUTH=on. A Manager connects one Google account in Settings → Files. The portal asks
//     for drive.file only: it sees nothing in that Drive except the "Blackhouse Portal" folders and files it creates.
//     Google's refresh token keeps the access working (renewable without anyone signing in again) until it is revoked;
//     it is stored AES-256-GCM encrypted with GOOGLE_DRIVE_TOKEN_KEY, never sent to the page and never logged.
//     Access tokens live in memory for under an hour.
//
//   GET  /api/drive/storage           the set-up and connection state (Settings view access)
//   GET  /api/drive/oauth/start       a Manager → Google's consent screen (offline access, drive.file)
//   GET  /api/drive/oauth/callback    Google → here: checks state, browser and Manager, stores the token, makes the folders
//   POST /api/drive/disconnect        a Manager: revokes the token at Google; the files stay in that Drive
//
// The callback runs without the portal's session (Google's redirect is cross-site, and the session cookie is
// SameSite=Strict): it is bound instead to the one-use state the same Manager started in the same browser.
const crypto = require('crypto');
const { createDrive, DriveError, FILE_SCOPE } = require('./drive');
const { DriveConnection, OAuthState, User } = require('./models');
const { parseCookies, sha256 } = require('./auth');
const { need } = require('./access');
const { verifyIdToken, checkClaims, createKeyStore } = require('./google');
const { createLimiter, limitRoute, byIp } = require('./rateLimit');

const STATE_COOKIE = 'bh_drive_oauth';
const TTL_SEC = 600;
// the token is bound to the OAuth client and Google account it belongs to (additional authenticated data)
const aadFor = (clientId, sub) => Buffer.from(`bh-drive-writer|v1|${clientId}|${sub}`);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const FOLDERS = { root: 'Blackhouse Portal', loi: 'Signed LOIs', deals: 'Deal files' };

/** AES-256-GCM: { iv, tag, data } (base64). */
function seal(key, text, aad) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(key, e, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAAD(aad); d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
}

function createWriterStore(config) {
  const st = config.storage || {}, o = st.oauth;
  const mode = st.drive ? 'service-account' : o ? 'oauth' : null;
  const sa = st.drive ? createDrive(st.drive) : null;
  let conn = null, client = null, loaded = 0, recheckedAt = 0;   // oauth: the connection (no token) and its Drive client

  /** A fresh access token from the stored refresh token; a revoked or expired grant marks the connection. */
  async function tokenSource() {
    const c = await DriveConnection.findOne({ key: 'writer' }).select('+refreshToken').lean();
    if (!c || !c.refreshToken) throw new DriveError('Google Drive storage is not connected. A Manager connects it in Settings → Files.', 409);
    if (c.clientId && c.clientId !== o.clientId) throw await problem('Google Drive was connected with a different OAuth client than this server now uses, so its files can\'t be reached. Restore the earlier client, or reconnect (files saved before stay in Drive).');
    let rt;
    try { rt = unseal(o.key, c.refreshToken, aadFor(c.clientId || o.clientId, c.sub)); } catch (e) { throw await problem('GOOGLE_DRIVE_TOKEN_KEY changed since Google Drive was connected, so the stored access can\'t be read. A Manager must reconnect Google Drive in Settings → Files.'); }
    let r, d;
    try {
      r = await fetch(o.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: rt, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15000) });
      d = await r.json().catch(() => ({}));
    } catch (e) { throw new DriveError('Google could not be reached to renew the Drive access. Try again in a minute.'); }
    if (!r.ok || !d.access_token) {
      if (d.error === 'invalid_grant') throw await problem(`Google Drive access for ${c.email} has expired or was removed in that Google account. A Manager must reconnect Google Drive in Settings → Files.`);
      // a server setting, not the connection: not stored as a problem (fixing the variables is enough)
      if (d.error === 'invalid_client' || d.error === 'unauthorized_client') throw new DriveError(`Google refused the portal's OAuth client (${d.error}). Check ${o.ownClient ? 'GOOGLE_DRIVE_OAUTH_CLIENT_ID / _SECRET' : 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET'} on the server.`, 502);
      throw new DriveError('Google refused to renew the Drive access (HTTP ' + r.status + '). Try again in a minute.');
    }
    const set = {};
    if (d.refresh_token) set.refreshToken = seal(o.key, d.refresh_token, aadFor(c.clientId || o.clientId, c.sub));   // Google may rotate it
    if (c.problem || !c.lastOkAt || Date.now() - new Date(c.lastOkAt).getTime() > 3600e3) Object.assign(set, { lastOkAt: new Date(), problem: '' });
    if (Object.keys(set).length) { await DriveConnection.updateOne({ _id: c._id }, { $set: set }); if (conn && set.problem === '') conn = { ...conn, problem: '' }; }
    return { token: d.access_token, expiresIn: d.expires_in };
  }
  async function problem(text) {
    await DriveConnection.updateOne({ key: 'writer' }, { $set: { problem: text.slice(0, 400) } });
    if (conn) conn = { ...conn, problem: text };
    return new DriveError(text, 409);
  }
  const clientFor = (c) => createDrive({ tokenSource, scope: FILE_SCOPE, email: c.email, apiUrl: o.apiUrl, uploadUrl: o.uploadUrl });
  function use(c) { conn = c; client = c ? clientFor(c) : null; }
  /** Reads the connection (oauth): the status route every time, uploads when the copy is over a minute old. */
  async function load() {
    if (mode !== 'oauth') return;
    const c = await DriveConnection.findOne({ key: 'writer' }).lean();
    if (!c || !conn || String(c._id) !== String(conn._id) || c.email !== conn.email || String(c.connectedAt) !== String(conn.connectedAt)) use(c); else conn = c;
    loaded = Date.now();
  }

  const folderOf = (kind) => (mode === 'service-account' ? (kind === 'loi' ? st.loiFolder : st.dealsFolder) : mode === 'oauth' && conn ? (conn.folders || {})[kind] || '' : '');
  const store = {
    mode,
    /** The Drive client that writes (or null). */
    client: () => (mode === 'service-account' ? sa : client),
    folder: folderOf,
    /** Files of this kind ('loi' | 'deals') can be saved now. */
    ready: (kind) => !!(store.client() && folderOf(kind) && !(mode === 'oauth' && conn && conn.problem)),
    /** What is still missing, in words for the setup notes. */
    needs(kind) {
      if (!mode) return ['Google Drive storage: GOOGLE_DRIVE_OAUTH=on (a My Drive, connected by a Manager in Settings → Files) or GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON (a service account in a Shared Drive)'];
      if (mode === 'service-account') return [!folderOf(kind) ? (kind === 'loi' ? 'GOOGLE_DRIVE_LOI_FOLDER_ID (the folder for signed LOIs, in the Shared Drive)' : 'GOOGLE_DRIVE_DEALS_FOLDER_ID (the folder for deal files, in the Shared Drive)') : ''].filter(Boolean);
      if (!conn) return ['A Manager connects Google Drive in Settings → Files (GOOGLE_DRIVE_OAUTH is on)'];
      return conn.problem ? [conn.problem] : [];
    },
    load,
  };

  /** The connection, as the page sees it (never a token). */
  function out() {
    const base = { mode, redirectPath: '/api/drive/oauth/callback' };
    if (mode === 'service-account') return { ...base, account: st.drive.email, folders: { loi: !!st.loiFolder, deals: !!st.dealsFolder } };
    if (mode !== 'oauth') return base;
    return { ...base, ignored: o.ignoredFolders, client: o.ownClient ? 'GOOGLE_DRIVE_OAUTH_CLIENT_ID' : 'GOOGLE_CLIENT_ID (the sign-in client)',
      connected: !!conn, email: conn ? conn.email : '', connectedAt: conn ? conn.connectedAt : null, connectedBy: conn && conn.connectedBy ? conn.connectedBy.name : '',
      lastOkAt: conn ? conn.lastOkAt : null, problem: conn ? conn.problem : '', folders: { loi: !!folderOf('loi'), deals: !!folderOf('deals') },
      folderNames: { root: FOLDERS.root, loi: `${FOLDERS.root} / ${FOLDERS.loi}`, deals: `${FOLDERS.root} / ${FOLDERS.deals}` } };
  }

  const secure = config.web.secureCookies;
  const cookieName = secure ? '__Host-' + STATE_COOKIE : STATE_COOKIE;
  const stateCookie = (v, maxAge) => `${cookieName}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const redirectUri = () => config.web.apiOrigin + '/api/drive/oauth/callback';
  const back = (res, code) => {
    res.append('Set-Cookie', stateCookie('', 0));
    const u = new URL(config.web.portalUrl, config.web.apiOrigin);
    u.searchParams.set('view', 'team'); u.hash = 'drive=' + code;
    res.redirect(303, u.href);
  };
  const isManager = (u) => !!(u && u.active !== false && u.role === 'Manager');

  /** The callback: mounted before sign-in is required (see the note at the top). */
  function publicRoutes(r) {
    if (mode !== 'oauth') return;
    const keyFor = createKeyStore(o.jwksUrl);
    // reached without a session (Google's redirect): limited per address
    const backLimit = limitRoute([{ take: createLimiter({ max: 30, windowMs: 10 * 60e3 }), key: byIp }], { html: true, message: 'Too many attempts to connect Google Drive. Wait a few minutes and try again.' });
    r.get('/drive/oauth/callback', backLimit, async (req, res) => {
      const q = req.query, state = typeof q.state === 'string' ? q.state : '', code = typeof q.code === 'string' ? q.code : '';
      const browser = parseCookies(req.headers.cookie)[cookieName] || '';
      const saved = state && browser ? await OAuthState.findOneAndDelete({ stateHash: sha256(state), purpose: 'drive', expiresAt: { $gt: new Date() } }) : null;
      if (q.error) return back(res, q.error === 'access_denied' ? 'cancelled' : 'google');
      if (!saved || saved.browserHash !== sha256(browser) || !code) return back(res, 'expired');
      const manager = saved.userId ? await User.findById(saved.userId).lean() : null;
      if (!isManager(manager)) return back(res, 'forbidden');

      let t = null;
      try {
        const x = await fetch(o.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: saved.verifier }), signal: AbortSignal.timeout(15000) });
        if (x.ok) t = await x.json(); else console.warn(`[drive] connect: token exchange returned HTTP ${x.status}`);
      } catch (e) { console.warn('[drive] connect: could not reach Google'); }
      if (!t || !t.access_token) return back(res, 'google');
      // from here Google has granted something. A connection that isn't kept gives it back, but only when that can't touch
      // the stored connection: Google's revocation removes every grant of that account for this project, so a failed
      // reconnect of the connected account itself (or of an account not yet identified) is left alone
      const stored = await DriveConnection.findOne({ key: 'writer' }, { sub: 1 }).lean();
      let who = '';
      const fail = async (why) => { if (!stored || (who && who !== stored.sub)) { try { await revoke(t.refresh_token || t.access_token); } catch (e) { /* best effort */ } } return back(res, why); };
      if (!t.id_token) return fail('google');
      if (!String(t.scope || '').split(/\s+/).includes(FILE_SCOPE)) return fail('scope');   // the Drive box was left unticked
      if (!t.refresh_token) return fail('offline');
      let c = null;
      try { c = await verifyIdToken(t.id_token, keyFor); } catch (e) { return fail('google'); }
      if (!c || checkClaims(c, { clientId: o.clientId, nonce: saved.nonce, allowedDomain: '' })) return fail('google');
      who = String(c.sub);
      // another Google account than the connected one: only when the Manager chose "Use another Google account"
      // (files already saved stay in the first account's Drive and can't be opened through the portal any more)
      const prev = await DriveConnection.findOne({ key: 'writer' }).select('+refreshToken').lean();
      const switching = !!(prev && prev.sub && prev.sub !== String(c.sub));
      if (switching && !saved.allowSwitch) return fail('other_account');

      // the portal's folders in that Drive: found again by their tag, or made now
      const tmp = createDrive({ tokenSource: async () => ({ token: t.access_token, expiresIn: t.expires_in }), scope: FILE_SCOPE, email: c.email, apiUrl: o.apiUrl, uploadUrl: o.uploadUrl });
      const folders = {};
      try {
        const root = (await tmp.findFolder('root')) || (await tmp.createFolder(FOLDERS.root, { tag: 'root' }));
        folders.root = root.id;
        for (const k of ['loi', 'deals']) folders[k] = ((await tmp.findFolder(k)) || (await tmp.createFolder(FOLDERS[k], { parent: root.id, tag: k }))).id;
      } catch (e) { console.warn('[drive] connect: folders: ' + (e.integration ? e.message : 'failed')); return fail(e.integration && /API is not enabled/.test(e.message) ? 'api' : 'folders'); }

      await DriveConnection.findOneAndUpdate({ key: 'writer' }, { $set: { email: String(c.email).toLowerCase(), sub: String(c.sub), clientId: o.clientId, scope: String(t.scope).slice(0, 400), refreshToken: seal(o.key, t.refresh_token, aadFor(o.clientId, String(c.sub))),
        folders, connectedBy: { name: manager.name, userId: manager._id }, connectedAt: new Date(), lastOkAt: new Date(), problem: '' } }, { upsert: true });
      // another Google account replaced: its access is given back
      if (switching && prev.refreshToken) { try { await revoke(unseal(o.key, prev.refreshToken, aadFor(prev.clientId || o.clientId, prev.sub))); } catch (e) { /* best effort */ } }
      console.log(`[drive] Google Drive storage connected by ${manager.name}`);
      await load();
      back(res, switching ? 'switched' : 'connected');
    });
  }
  async function revoke(token) {
    const r = await fetch(o.revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000) });
    if (!r.ok && r.status !== 400) throw new Error('revoke: HTTP ' + r.status);   // 400: already invalid
  }

  /** Status, start and disconnect: behind sign-in. */
  function routes(r) {
    r.get('/drive/storage', need('team', 'view'), async (req, res) => {
      await load();
      // Google ends a refresh token unused for six months: one not used for 30 days is used now (nothing is changed in Drive)
      // and a recorded problem is checked again (at most once a minute), so fixing a setting clears it without a reconnect
      const stale = conn && (!conn.lastOkAt || Date.now() - new Date(conn.lastOkAt).getTime() > 30 * 864e5);
      if (mode === 'oauth' && conn && ((!conn.problem && stale) || (conn.problem && Date.now() - recheckedAt > 60e3))) { recheckedAt = Date.now(); try { await tokenSource(); } catch (e) { /* recorded */ } await load(); }
      res.json({ storage: out() });
    });
    if (mode !== 'oauth') return;
    r.get('/drive/oauth/start', async (req, res) => {
      if (!isManager(req.user)) return res.status(403).json({ error: 'Only a Manager can connect Google Drive storage.' });
      const state = b64url(crypto.randomBytes(32)), browser = b64url(crypto.randomBytes(32));
      const verifier = b64url(crypto.randomBytes(48)), nonce = b64url(crypto.randomBytes(24));
      await OAuthState.create({ stateHash: sha256(state), browserHash: sha256(browser), verifier, nonce, purpose: 'drive', userId: req.user._id, allowSwitch: req.query.switch === '1', expiresAt: new Date(Date.now() + TTL_SEC * 1000) });
      const u = new URL(o.authUrl);
      u.search = new URLSearchParams({ client_id: o.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email ' + FILE_SCOPE,
        access_type: 'offline', prompt: 'consent select_account', state, nonce,
        code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' }).toString();
      res.append('Set-Cookie', stateCookie(browser, TTL_SEC));
      res.redirect(302, u.href);
    });
    r.post('/drive/disconnect', async (req, res) => {
      if (!isManager(req.user)) return res.status(403).json({ error: 'Only a Manager can disconnect Google Drive storage.' });
      if ((req.body || {}).confirm !== true) return res.status(400).json({ error: 'Confirm first.', errors: ['Confirm first.'] });
      const c = await DriveConnection.findOneAndDelete({ key: 'writer' }).select('+refreshToken').lean();
      let revoked = false;
      if (c && c.refreshToken) { try { await revoke(unseal(o.key, c.refreshToken, aadFor(c.clientId || o.clientId, c.sub))); revoked = true; } catch (e) { /* the record is gone either way */ } }
      console.log(`[drive] Google Drive storage disconnected by ${req.user.name}`);
      use(null);
      res.json({ ok: true, revoked, storage: out() });
    });
  }

  store.publicRoutes = publicRoutes;
  store.routes = routes;
  /** Reads the connection once, if it hasn't been read yet (e.g. the database came up after the router). */
  store.ensure = async () => { if (mode === 'oauth' && Date.now() - loaded > 60e3) await load(); };
  return store;
}

module.exports = { createWriterStore, seal, unseal, aadFor };
