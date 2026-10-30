'use strict';
// "Sign in with Google" for a hosted server (Railway): OAuth 2.0 authorization-code flow with PKCE, state and nonce, run
// entirely by the API, so the client secret never reaches the page. The ID token's signature is checked against Google's
// published keys, then its issuer, audience, expiry, nonce and verified email. Only people already on Team & Access (active) can sign in, and they
// keep exactly their Manager / VA / Broker role and module access from MongoDB. Google only proves who they are.
//
//   GET /api/auth/google/start     → Google's account chooser
//   GET /api/auth/google/callback  → checks everything, starts a session, returns to the portal (PORTAL_URL)
//
// Failures return to the portal as #signin-error=<code>; the reason is never a token, code or email address.
const crypto = require('crypto');
const { User, OAuthState, Session } = require('./models');
const { parseCookies, sha256 } = require('./auth');
const { createLimiter, limitRoute, byIp } = require('./rateLimit');

const STATE_COOKIE = 'bh_oauth';
const TTL_SEC = 600;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Reads the ID token's claims without checking it (use verifyIdToken). */
function claimsOf(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch (e) { return null; }
}

/** Google's public signing keys, cached as long as Google's Cache-Control allows (at most 6 hours). */
function createKeyStore(jwksUrl) {
  let keys = null, until = 0, pending = null;
  async function fetchKeys() {
    const r = await fetch(jwksUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('signing keys: HTTP ' + r.status);
    const maxAge = Number((String(r.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1]) || 3600;
    keys = new Map(((await r.json()).keys || []).filter((k) => k.kty === 'RSA' && k.kid).map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
    until = Date.now() + Math.min(maxAge, 6 * 3600) * 1000;
  }
  return async function key(kid) {
    if (!keys || Date.now() > until || !keys.has(kid)) {   // unknown kid: Google may have rotated its keys
      pending = pending || fetchKeys().finally(() => { pending = null; });
      await pending;
    }
    return keys.get(kid) || null;
  };
}

/** Checks the ID token's RS256 signature against Google's published keys; returns its claims, or null. */
async function verifyIdToken(idToken, keyFor) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const key = await keyFor(header.kid);
  if (!key) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  return ok ? claimsOf(idToken) : null;
}

/** Every rule an ID token must pass; returns an error code or '' (exported for tests). */
function checkClaims(c, { clientId, nonce, allowedDomain, now = Date.now() }) {
  if (!c) return 'google';
  if (!ISSUERS.includes(c.iss)) return 'google';
  if (Array.isArray(c.aud) ? !c.aud.includes(clientId) : c.aud !== clientId) return 'google';
  if (!(Number(c.exp) * 1000 > now)) return 'expired';
  if (!nonce || c.nonce !== nonce) return 'expired';
  if (!c.sub || !c.email) return 'google';
  if (c.email_verified !== true && c.email_verified !== 'true') return 'unverified';
  if (allowedDomain && String(c.hd || '').toLowerCase() !== allowedDomain) return 'domain';
  return '';
}

function googleRoutes(router, config, { startSession }) {
  const g = config.auth.google, secure = config.web.secureCookies, keyFor = createKeyStore(g.jwksUrl);
  const cookieName = secure ? '__Host-' + STATE_COOKIE : STATE_COOKIE;
  // Lax (not Strict): the browser must send it when Google sends the person back to the callback
  const stateCookie = (v, maxAge) => `${cookieName}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const back = (res, code) => {
    res.append('Set-Cookie', stateCookie('', 0));
    const u = new URL(config.web.portalUrl, config.web.apiOrigin);
    u.hash = code ? 'signin-error=' + code : '';
    res.redirect(303, u.href);
  };

  // each start writes a short-lived state record (expired by the database after 10 minutes): limited per address (an
  // office shares one: 60 in 10 minutes is plenty), and a very high cap for the whole server against a wide flood
  const startLimit = limitRoute([{ take: createLimiter({ max: 60, windowMs: 10 * 60e3 }), key: byIp }, { take: createLimiter({ max: 20000, windowMs: 10 * 60e3 }), key: () => 'all' }],
    { html: true, message: 'Too many sign-in attempts from this connection. Wait a few minutes, then sign in again.' });
  const backLimit = limitRoute([{ take: createLimiter({ max: 120, windowMs: 10 * 60e3 }), key: byIp }], { html: true, message: 'Too many sign-in attempts from this connection. Wait a few minutes, then sign in again.' });
  router.get('/auth/google/start', startLimit, async (req, res) => {
    const state = b64url(crypto.randomBytes(32)), browser = b64url(crypto.randomBytes(32));
    const verifier = b64url(crypto.randomBytes(48)), nonce = b64url(crypto.randomBytes(24));
    await OAuthState.create({ stateHash: sha256(state), browserHash: sha256(browser), verifier, nonce, expiresAt: new Date(Date.now() + TTL_SEC * 1000) });
    const u = new URL(g.authUrl);
    u.search = new URLSearchParams({
      client_id: g.clientId, redirect_uri: g.redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      prompt: 'select_account', ...(g.allowedDomain ? { hd: g.allowedDomain } : {}),
    }).toString();
    res.append('Set-Cookie', stateCookie(browser, TTL_SEC));
    res.redirect(302, u.href);
  });

  router.get('/auth/google/callback', backLimit, async (req, res) => {
    const q = req.query, state = typeof q.state === 'string' ? q.state : '', code = typeof q.code === 'string' ? q.code : '';
    const browser = parseCookies(req.headers.cookie)[cookieName] || '';
    // one use only, and only in the browser that started it (stops someone sending you their sign-in link)
    const saved = state && browser ? await OAuthState.findOneAndDelete({ stateHash: sha256(state), purpose: { $ne: 'drive' }, expiresAt: { $gt: new Date() } }) : null;
    if (q.error) return back(res, q.error === 'access_denied' ? 'cancelled' : 'google');
    if (!saved || saved.browserHash !== sha256(browser) || !code) return back(res, 'expired');

    let tokens = null;
    try {
      const r = await fetch(g.tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: g.redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) tokens = await r.json();
      else console.warn(`[auth] Google sign-in: token exchange returned HTTP ${r.status}`);
    } catch (e) { console.warn('[auth] Google sign-in: could not reach Google (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ')'); }
    if (!tokens || !tokens.id_token) return back(res, 'google');

    let c = null;
    try { c = await verifyIdToken(tokens.id_token, keyFor); } catch (e) { console.warn('[auth] Google sign-in: could not load Google\'s signing keys'); return back(res, 'google'); }
    if (!c) { console.warn('[auth] Google sign-in refused: bad_signature'); return back(res, 'google'); }
    const bad = checkClaims(c,{ clientId: g.clientId, nonce: saved.nonce, allowedDomain: g.allowedDomain });
    if (bad) { console.warn('[auth] Google sign-in refused: ' + bad); return back(res, bad); }

    // must already be an active team member; the Google account is linked on first sign-in and must match afterwards
    const user = await User.findOne({ email: String(c.email).trim().toLowerCase() }).select('+googleSub');
    if (!user || !user.active) { console.warn('[auth] Google sign-in refused: not_member'); return back(res, 'not_member'); }
    if (user.googleSub && user.googleSub !== String(c.sub)) { console.warn('[auth] Google sign-in refused: mismatch'); return back(res, 'mismatch'); }
    if (!user.googleSub) {
      // a newly linked Google account takes over this member: sessions started before the link (for example one an
      // admin kept while changing their own email to this address) end now
      await Session.deleteMany({ userId: user._id });
      user.googleSub = String(c.sub); user.googleLinkedAt = new Date(); await user.save();
    }
    await startSession(res, user, config, { googleSub: c.sub });
    back(res, '');
  });
}

module.exports = { googleRoutes, checkClaims, claimsOf, verifyIdToken, createKeyStore };
