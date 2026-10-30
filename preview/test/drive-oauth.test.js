'use strict';
// "My Drive storage" (src/driveStore.js, GOOGLE_DRIVE_OAUTH=on) end to end, with fakes only: an in-memory MongoDB, the
// fake Monday board, and a fake Google (OAuth consent, token, keys, revoke; Drive with the drive.file scope). A
// Manager connects one Google account; deal files and LOI signed copies go into the folders the portal made there;
// the access renews from the stored refresh token, which is encrypted and never reaches the page or the logs.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { User, DriveConnection, OAuthState, DealFile, Loi } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { unseal, aadFor } = require('../src/driveStore');
const docx = require('../src/docx');
const fx = require('./fixtures/fake-integrations');
const { createFakeGoogleOAuth, FILE_SCOPE } = require('./fixtures/fake-google-oauth');
const { PNG } = require('./fixtures/fake-google-ai');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const CLIENT_ID = 'fake-portal-client.apps.googleusercontent.com', CLIENT_SECRET = 'fake-client-secret-for-tests';
const KEY = crypto.randomBytes(32);
const P = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const ROW = (a) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc><w:p/></w:tc></w:tr>`;
const TEMPLATE = docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>') },
  { name: 'word/document.xml', data: Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${P('Date: _______________')}${P('RE: LETTER OF INTENT TO LEASE')}<w:tbl>${ROW('Lessor')}${ROW('Lessee')}${ROW('Monthly Rental')}</w:tbl>`
    + `${P('_______________________________')}${P('Print Name &amp; Signature')}${P('_______________________________')}${P('LESSOR')}<w:sectPr/></w:body></w:document>`) }]);
const FIELDS = { DATE: 'October 30, 2026', TO_1: 'Owner A', TO_2: 'Fake Tower', TO_3: 'Makati', DEAR: 'Owner A', CLIENT: 'Test Client One', BROKER_SIGN: 'Ely Santos', PROPERTY: 'Fake Tower, Makati', LEASE_TERM: 'One (1) year',
  MONTHLY_RENT: '₱180,000', ADVANCE: 'One (1) month', DEPOSIT: 'Two (2) months', CONCESSIONS: '', COMM_PCT: '3' };

let fake, google, mem, server, base, env;
const logs = [];
const cookies = {};
async function call(method, url, { body, cookie, file, b = base } = {}) {
  const headers = { ...(cookie ? { cookie } : {}) };
  if (file) headers['content-type'] = 'application/octet-stream'; else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(b + url, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (e) { /* not JSON */ }
  return { status: res.status, data, buf, text: buf.toString(), headers: res.headers };
}
async function login(who) {
  if (cookies[who]) return cookies[who];
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who); return (cookies[who] = r.headers.get('set-cookie').split(';')[0]);
}
// the server is started on port 0, so its own address (and the redirect URI) says :0: point those at the test server
const local = (loc) => { const x = new URL(loc, base); return base + x.pathname + x.search + x.hash; };
/** Runs the whole "Connect Google Drive" round trip as a browser would; → the callback's redirect target. */
async function connect(cookie, qs = '') {
  const s = await call('GET', '/api/drive/oauth/start' + qs, { cookie });
  assert.strictEqual(s.status, 302, s.text);
  const state = s.headers.get('set-cookie').split(';')[0];
  const consent = await fetch(s.headers.get('location'), { redirect: 'manual' });   // the fake approves at once
  const callbackUrl = local(consent.headers.get('location'));
  const cb = await fetch(callbackUrl, { headers: { cookie: state }, redirect: 'manual' });
  return { start: s, stateCookie: state, callbackUrl, status: cb.status, to: cb.headers.get('location') ? local(cb.headers.get('location')) : '' };
}

test.before(async () => {
  ['log', 'warn', 'error'].forEach((k) => { const orig = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(' ')); orig.apply(console, a); }; });
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  google = createFakeGoogleOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  const f = `http://127.0.0.1:${fake.address().port}`, g = `http://127.0.0.1:${google.address().port}`;
  env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_drive_oauth'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond',
    GOOGLE_DRIVE_OAUTH: 'on', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('base64'),
    GOOGLE_AUTH_URL: g + '/auth', GOOGLE_TOKEN_URL: g + '/token', GOOGLE_JWKS_URL: g + '/certs', GOOGLE_REVOKE_URL: g + '/revoke',
    GOOGLE_DRIVE_API_URL: g + '/drive/v3', GOOGLE_DRIVE_UPLOAD_URL: g + '/upload/drive/v3', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive' };
  ({ server } = await start(env, ARGV)); base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', team: 'edit' }, passwordHash }]);
  assert.strictEqual((await call('POST', '/api/loi/templates/lease', { cookie: await login('boss'), file: TEMPLATE })).status, 201);
});
test.after(async () => { [server, fake, google].forEach((s) => { s.close(); if (s.closeAllConnections) s.closeAllConnections(); }); await mongoose.disconnect(); await mem.stop(); });

test('config: My Drive storage needs its key and the OAuth client, and is not mixed with a service account', () => {
  const base0 = { APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1:1/x', GOOGLE_DRIVE_OAUTH: 'on', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET };
  assert.throws(() => loadConfig(base0, ARGV), /GOOGLE_DRIVE_TOKEN_KEY/);
  assert.throws(() => loadConfig({ ...base0, GOOGLE_DRIVE_TOKEN_KEY: 'too-short' }, ARGV), /GOOGLE_DRIVE_TOKEN_KEY/);
  assert.throws(() => loadConfig({ ...base0, GOOGLE_CLIENT_SECRET: '', GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('hex') }, ARGV), /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...base0, GOOGLE_DRIVE_OAUTH: 'yes' }, ARGV), /on or off/);
  const sa = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  assert.throws(() => loadConfig({ ...base0, GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('hex'), GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON: sa }, ARGV), /not both/);
  const c = loadConfig({ ...base0, GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('hex'), GOOGLE_DRIVE_LOI_FOLDER_ID: 'SomeFolderIdAAAAAAA' }, ARGV).storage;
  assert.strictEqual(c.oauth.clientId, CLIENT_ID, 'the sign-in client is reused');
  assert.deepStrictEqual([c.loiFolder, c.oauth.ignoredFolders], ['', ['GOOGLE_DRIVE_LOI_FOLDER_ID']], 'folder IDs are not used with drive.file');
  const own = loadConfig({ ...base0, GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('hex'), GOOGLE_DRIVE_OAUTH_CLIENT_ID: 'other.apps.googleusercontent.com', GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: 's' }, ARGV).storage.oauth;
  assert.deepStrictEqual([own.clientId, own.ownClient], ['other.apps.googleusercontent.com', true]);
  assert.throws(() => loadConfig({ ...base0, GOOGLE_DRIVE_TOKEN_KEY: KEY.toString('hex'), HOST: '0.0.0.0', PUBLIC_API_URL: 'https://x.example.com', AUTH_PROVIDER: 'google', GOOGLE_REVOKE_URL: 'https://evil.example.com/revoke' }, ARGV), /local mock server/);
});

test('connect: a Manager only; Google consent asks for drive.file with offline access; state is one-use and tied to the browser', async () => {
  const boss = await login('boss');
  let s = await call('GET', '/api/drive/storage', { cookie: boss });
  assert.deepStrictEqual([s.data.storage.mode, s.data.storage.connected], ['oauth', false]);
  assert.strictEqual((await call('GET', '/api/deals/monday/9001', { cookie: boss })).data.setup.ready, false);
  assert.strictEqual((await call('GET', '/api/drive/oauth/start', { cookie: await login('ana') })).status, 403, 'not a Manager');
  assert.strictEqual((await call('GET', '/api/drive/oauth/start')).status, 401, 'signed out');

  const st = await call('GET', '/api/drive/oauth/start', { cookie: boss });
  const q = new URL(st.headers.get('location')).searchParams;
  assert.deepStrictEqual([q.get('client_id'), q.get('redirect_uri'), q.get('access_type'), q.get('code_challenge_method'), q.get('response_type')],
    [CLIENT_ID, 'http://127.0.0.1:0/api/drive/oauth/callback', 'offline', 'S256', 'code'], 'the redirect URI is PUBLIC_API_URL (here the local address) + /api/drive/oauth/callback');
  assert.deepStrictEqual(q.get('scope').split(' ').sort(), ['email', 'openid', FILE_SCOPE].sort(), 'drive.file only: no full Drive scope');
  assert.match(q.get('prompt'), /consent/);
  assert.match(st.headers.get('set-cookie'), /^bh_drive_oauth=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600/);
  // another browser (no state cookie) can't finish it; a sign-in state can't finish it either
  const consent = await fetch(st.headers.get('location'), { redirect: 'manual' });
  const cbUrl = local(consent.headers.get('location'));
  assert.match((await fetch(cbUrl, { redirect: 'manual' })).headers.get('location'), /#drive=expired$/);
  await OAuthState.updateMany({ purpose: 'drive' }, { $set: { purpose: 'signin' } });
  assert.match((await fetch(cbUrl, { headers: { cookie: st.headers.get('set-cookie').split(';')[0] }, redirect: 'manual' })).headers.get('location'), /#drive=expired$/);
  assert.strictEqual(await DriveConnection.countDocuments(), 0);

  // cancelled on Google's screen; the Drive box left unticked
  google.decision = 'deny'; assert.match((await connect(boss)).to, /#drive=cancelled$/); google.decision = 'allow';
  google.grantScope = 'openid email'; assert.match((await connect(boss)).to, /#drive=scope$/); google.grantScope = '';
  assert.strictEqual(await DriveConnection.countDocuments(), 0);

  // connected: back to Settings → Files; the portal's folders made in that Drive
  const c = await connect(boss);
  assert.strictEqual(c.status, 303); assert.strictEqual(c.to, base + '/?view=team#drive=connected');
  assert.match((await fetch(c.callbackUrl, { headers: { cookie: c.stateCookie }, redirect: 'manual' })).headers.get('location'), /#drive=expired$/, 'one use only');
  s = (await call('GET', '/api/drive/storage', { cookie: boss })).data.storage;
  assert.deepStrictEqual([s.connected, s.email, s.connectedBy, s.folders, s.problem], [true, 'blackhouse.files@example.com', 'Test Manager', { loi: true, deals: true }, '']);
  const folders = Object.entries(google.files).filter(([, f]) => f.mimeType === 'application/vnd.google-apps.folder');
  const root = folders.find(([, f]) => f.appProperties.bhPortal === 'root');
  assert.ok(root && root[1].name === 'Blackhouse Portal' && root[1].parent === 'root');
  assert.deepStrictEqual(folders.filter(([, f]) => f.parent === root[0]).map(([, f]) => f.name).sort(), ['Deal files', 'Signed LOIs']);
  // the refresh token: encrypted at rest, never in an answer
  const rec = await DriveConnection.findOne().select('+refreshToken').lean(), rts = google.issuedRefreshTokens();
  assert.ok(rts.includes(unseal(KEY, rec.refreshToken, aadFor(CLIENT_ID, rec.sub))), 'the stored token opens with GOOGLE_DRIVE_TOKEN_KEY');
  assert.ok(!rts.some((t) => JSON.stringify(rec).includes(t)), 'not stored in plain text');
  assert.throws(() => unseal(KEY, rec.refreshToken, aadFor(CLIENT_ID, 'another-account')), 'bound to its Google account');
  assert.throws(() => unseal(KEY, rec.refreshToken, aadFor('other.apps.googleusercontent.com', rec.sub)), 'bound to its OAuth client');
  assert.ok(!/fake-(refresh|access)-/.test(JSON.stringify(s)), 'never sent to the page');
  // reconnecting finds the same folders instead of making new ones
  assert.match((await connect(boss)).to, /#drive=connected$/);
  assert.strictEqual(Object.values(google.files).filter((f) => f.mimeType === 'application/vnd.google-apps.folder').length, 3);
});

test('deal files and LOI signed copies go into the connected My Drive; the access renews; a revoked access says to reconnect', async () => {
  const boss = await login('boss'), u = '/api/deals/monday/9001/6001';
  const rec = await DriveConnection.findOne().lean();
  const pdf = Buffer.from('%PDF-1.4\n% a made-up signed contract\n%%EOF');
  assert.strictEqual((await call('GET', '/api/deals/monday/9001', { cookie: boss })).data.setup.ready, true);
  const up = await call('POST', u + '/contract?start=2026-11-01&months=12', { cookie: boss, file: pdf });
  assert.strictEqual(up.status, 201, up.text);
  assert.strictEqual(google.uploads.at(-1).parent, rec.folders.deals);
  // an hour later: the access token has expired and is renewed from the stored refresh token, unseen by anyone
  google.expireAccess(); const before = google.refreshCount();
  const dl = await call('GET', u + '/contract/file', { cookie: boss });
  assert.strictEqual(dl.status, 200); assert.ok(dl.buf.equals(pdf));
  assert.strictEqual(google.refreshCount(), before + 1);

  // LOI e-signature: the PDF is made in the LOI folder (temporary Doc, deleted), signed copies kept there and in the deal files
  const made = await call('POST', '/api/loi/monday/9001', { cookie: boss, body: { slot: 'lease', fields: FIELDS, unitKey: '6001', unitName: 'Fake Tower, Makati' } });
  assert.strictEqual(made.status, 201, made.text);
  const url = `/api/loi/monday/9001/${made.data.loi.id}`;
  const sent = await call('POST', url + '/send', { cookie: boss, body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(sent.status, 201, sent.text);
  const tmp = google.uploads.find((x) => /^\(temporary\)/.test(x.name));
  assert.ok(tmp && tmp.parent === rec.folders.loi && !google.files[tmp.id], 'converted in the LOI folder, then deleted');
  const link = new URL(sent.data.link).pathname, page = await call('GET', link), nonce = (page.text.match(/data-nonce="([^"]+)"/) || [])[1];
  const ok = await call('POST', link, { body: { name: 'Test Client One', agree: true, signature: 'data:image/png;base64,' + PNG(0).toString('base64'), nonce } });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.ok(google.uploads.some((x) => /SIGNED by client\.pdf$/.test(x.name) && x.parent === rec.folders.loi));
  assert.strictEqual((await Loi.findById(made.data.loi.id).lean()).status, 'clientSigned');
  assert.strictEqual((await DealFile.findOne({ leadId: '9001', unitKey: '6001' }).lean()).slots.clientLoi.src, 'esign');

  // the account owner removes the portal's access in Google: a clear message, nothing half-saved, setup shows it
  google.revokeAll();
  const no = await call('POST', u + '/deposit', { cookie: boss, file: pdf });
  assert.strictEqual(no.status, 409, no.text); assert.match(no.data.error, /expired or was removed.*reconnect Google Drive in Settings/);
  assert.strictEqual((await DealFile.findOne({ leadId: '9001', unitKey: '6001' }).lean()).slots.deposit, null);
  const s = (await call('GET', '/api/drive/storage', { cookie: boss })).data.storage;
  assert.match(s.problem, /reconnect/); assert.strictEqual(s.folders.deals, true);
  assert.strictEqual((await call('GET', '/api/deals/monday/9001', { cookie: boss })).data.setup.ready, false);
  // reconnecting fixes it (same account, same folders)
  assert.match((await connect(boss)).to, /#drive=connected$/);
  assert.strictEqual((await call('POST', u + '/deposit', { cookie: boss, file: pdf })).status, 201);
  // a file over 5 MB goes up as a resumable upload (Google's simple upload is for 5 MB at most)
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]);
  const ren = await call('POST', u + '/renewal?start=2027-11-01&months=12', { cookie: boss, file: big });
  assert.strictEqual(ren.status, 201, ren.text);
  const last = google.uploads.at(-1);
  assert.deepStrictEqual([last.resumable, last.size, last.parent], [true, big.length, rec.folders.deals]);
});

test('a signature whose Drive copy fails is kept: a clear status, and a retry saves it once (no duplicate, no new signature)', async () => {
  const boss = await login('boss');
  const made = await call('POST', '/api/loi/monday/9001', { cookie: boss, body: { slot: 'lease', fields: FIELDS, unitKey: '6001', unitName: 'Fake Tower, Makati' } });
  assert.strictEqual(made.status, 201, made.text);
  const url = `/api/loi/monday/9001/${made.data.loi.id}`;
  const sent = await call('POST', url + '/send', { cookie: boss, body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(sent.status, 201, sent.text);
  const link = new URL(sent.data.link).pathname, nonce = ((await call('GET', link)).text.match(/data-nonce="([^"]+)"/) || [])[1];
  // the Drive access is removed in Google just before the client signs
  google.revokeAll();
  const n0 = google.uploads.length;
  const ok = await call('POST', link, { body: { name: 'Test Client One', agree: true, signature: 'data:image/png;base64,' + PNG(0).toString('base64'), nonce } });
  assert.strictEqual(ok.status, 200, 'the signer is told it was received: ' + ok.text);
  let lo = (await call('GET', '/api/loi/monday/9001', { cookie: boss })).data.lois.find((x) => x.id === made.data.loi.id);
  assert.strictEqual(lo.status, 'clientSigned', 'the signature counts');
  assert.deepStrictEqual([lo.signed.client.store.status, lo.signed.client.drive], ['failed', false]);
  assert.match(lo.signed.client.store.error, /not connected|expired or was removed/);
  assert.strictEqual((await call('GET', url + '/signed?fmt=docx', { cookie: boss })).status, 200, 'the signed copy downloads from the portal meanwhile');
  assert.strictEqual(google.uploads.length, n0, 'nothing half-saved in Drive');
  // the link is used: no second signature
  assert.strictEqual((await call('POST', link, { body: { name: 'Test Client One', agree: true, signature: 'data:image/png;base64,' + PNG(0).toString('base64'), nonce } })).status, 409);
  // reconnected; staff retry: saved once, linked to the unit's deal files
  assert.match((await connect(boss)).to, /#drive=connected$/);
  let r = await call('POST', url + '/store', { cookie: boss, body: { role: 'client' } });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual([r.data.store.status, r.data.deal.status, r.data.loi.signed.client.drive], ['saved', 'linked', true]);
  const mine = () => google.uploads.filter((x) => new RegExp(made.data.loi.id + '|Test Client One').test(x.name) && /SIGNED/.test(x.name));
  const after1 = mine().length;
  assert.ok(after1 >= 1);
  // a crash after the upload but before it was recorded: the retry finds the file in Drive instead of uploading it again
  const { Loi } = require('../src/models');
  await Loi.updateOne({ _id: made.data.loi.id }, { $set: { 'signed.client.docx': null, 'signed.client.pdf': null, 'signed.client.store.status': 'failed' } });
  r = await call('POST', url + '/store', { cookie: boss, body: { role: 'client' } });
  assert.deepStrictEqual([r.status, r.data.store.status], [200, 'saved']);
  assert.strictEqual(mine().length, after1, 'no duplicate file in Drive');
  // a retry by someone without edit access is refused
  assert.strictEqual((await call('POST', url + '/store', { cookie: await login('ana'), body: { role: 'owner' } })).status, 409);
});

test('another Google account: refused on Reconnect, allowed only when the Manager chose to switch; grants not kept are given back', async () => {
  const boss = await login('boss'), revokes = () => google.calls.filter((x) => x.path === '/revoke').length;
  const first = await DriveConnection.findOne().select('+refreshToken').lean();
  // Reconnect, but another account picked on Google's screen: nothing changes, and the new grant is given back
  google.email = 'someone.else@example.com';
  let n = revokes();
  assert.match((await connect(boss)).to, /#drive=other_account$/);
  assert.strictEqual((await DriveConnection.findOne().lean()).email, first.email);
  assert.strictEqual(revokes(), n + 1, 'the unused grant is revoked');
  // the Drive box unticked while a connection is stored: nothing is revoked (Google's revocation would also end the stored
  // connection if it were the same account), and the stored connection keeps working
  google.grantScope = 'openid email'; n = revokes();
  assert.match((await connect(boss)).to, /#drive=scope$/); google.grantScope = '';
  assert.strictEqual(revokes(), n);
  assert.strictEqual((await call('GET', '/api/deals/monday/9001', { cookie: boss })).data.setup.ready, true);
  // "Use another Google account…" (confirmed in the page): switched; the first account's access is removed
  n = revokes();
  assert.match((await connect(boss, '?switch=1')).to, /#drive=switched$/);
  const now = await DriveConnection.findOne().lean();
  assert.deepStrictEqual([now.email, now.clientId], ['someone.else@example.com', CLIENT_ID]);
  assert.ok(google.calls.slice(-5).some((x) => x.path === '/revoke' && x.body.token === unseal(KEY, first.refreshToken, aadFor(CLIENT_ID, first.sub))));
  assert.strictEqual(revokes(), n + 1);
  // and back, for the next test
  google.email = '';
  assert.match((await connect(boss, '?switch=1')).to, /#drive=switched$/);
});

test('disconnect: a Manager confirms; the token is revoked at Google; nothing is deleted from Drive; no token in any log', async () => {
  const boss = await login('boss'), nFiles = Object.keys(google.files).length;
  assert.strictEqual((await call('POST', '/api/drive/disconnect', { cookie: await login('ana'), body: { confirm: true } })).status, 403);
  assert.strictEqual((await call('POST', '/api/drive/disconnect', { cookie: boss, body: {} })).status, 400);
  const cur = await DriveConnection.findOne().select('+refreshToken').lean(), rt = unseal(KEY, cur.refreshToken, aadFor(CLIENT_ID, cur.sub));
  const d = await call('POST', '/api/drive/disconnect', { cookie: boss, body: { confirm: true } });
  assert.deepStrictEqual([d.status, d.data.revoked, d.data.storage.connected], [200, true, false]);
  assert.ok(google.calls.some((c) => c.path === '/revoke' && c.body.token === rt), 'the refresh token was given back to Google');
  assert.strictEqual(await DriveConnection.countDocuments(), 0);
  assert.strictEqual(Object.keys(google.files).length, nFiles, 'files stay in Drive');
  assert.strictEqual((await call('POST', '/api/deals/monday/9001/6001/deposit', { cookie: boss, file: Buffer.from('%PDF-1.4\n%%EOF..........') })).status, 503);
  const all = logs.join('\n');
  assert.ok(!google.issuedRefreshTokens().some((t) => all.includes(t)) && !/fake-access-\d/.test(all) && !all.includes(CLIENT_SECRET), 'no token or secret in the server log');
});
