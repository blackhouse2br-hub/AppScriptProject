'use strict';
// Sign-in for MongoDB mode: email + password on the local preview, Google (google.js) on a hosted server.
// Sessions live in MongoDB; identity and permissions are loaded per request (never cached between requests),
// so removing a member or changing their role takes effect on their next request.
const crypto = require('crypto');
const { User, Session } = require('./models');

const COOKIE = 'bh_sid';
// over HTTPS the __Host- prefix makes the browser insist on Secure, Path=/ and no Domain (no sharing with subdomains)
const cookieName = (secure) => (secure ? '__Host-' + COOKIE : COOKIE);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${(await scrypt(password, salt)).toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[5], 'base64');
  const key = await scrypt(password, Buffer.from(parts[4], 'base64'));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
let dummyHash;   // compared against when the email is unknown, so response time doesn't reveal which emails exist
const getDummyHash = async () => dummyHash || (dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex')));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignore bad cookie */ } } });
  return out;
}
// SameSite=Strict also works with the portal on GitHub Pages, because the page and the API must be the same site (deploy.js)
function cookieHeader(value, maxAgeSec, secure) {
  return `${cookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Failed-login throttle (per process). Enough for local use; a shared store is needed with several instances.
const WINDOW_MS = 15 * 60e3, MAX_PER_ACCOUNT = 8, MAX_PER_IP = 40;
const fails = new Map();
function throttled(keys) {
  const now = Date.now();
  return keys.some(([k, max]) => { const f = fails.get(k); if (f && f.reset < now) { fails.delete(k); return false; } return f && f.count >= max; });
}
function recordFail(keys) {
  const now = Date.now();
  keys.forEach(([k]) => { const f = fails.get(k); if (!f || f.reset < now) fails.set(k, { count: 1, reset: now + WINDOW_MS }); else f.count++; });
}

/** Signs a member in: a new random session token (only its hash is stored) in an HttpOnly cookie. */
async function startSession(res, user, config) {
  const maxAge = config.sessionHours * 3600, secure = config.web.secureCookies;
  const token = crypto.randomBytes(32).toString('base64url');
  await Session.create({ tokenHash: sha256(token), userId: user._id, expiresAt: new Date(Date.now() + maxAge * 1000) });
  res.append('Set-Cookie', cookieHeader(token, maxAge, secure));
}

function authRoutes(router, config) {
  const secure = config.web.secureCookies;

  /** Attaches req.user / req.sessionDoc when a valid session cookie is present. */
  router.use(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[cookieName(secure)];
    if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return next();
    const sess = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
    if (!sess) return next();
    const user = await User.findById(sess.userId);
    if (user && user.active) { req.user = user; req.sessionDoc = sess; }
    next();
  });

  router.get('/auth/methods', (req, res) => res.json({ provider: config.auth.provider }));

  if (config.auth.provider === 'google') require('./google').googleRoutes(router, config, { startSession });

  router.post('/auth/login', async (req, res) => {
    if (config.auth.provider !== 'password') return res.status(404).json({ error: 'Email-and-password sign-in is switched off on this server. Use "Sign in with Google".' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || email.length > 120 || password.length > 200) return res.status(400).json({ error: 'Enter your email and password.' });
    const keys = [['a:' + email, MAX_PER_ACCOUNT], ['i:' + req.ip, MAX_PER_IP]];
    if (throttled(keys)) return res.status(429).json({ error: 'Too many failed sign-ins. Try again in 15 minutes.' });
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = await verifyPassword(password, user && user.passwordHash ? user.passwordHash : await getDummyHash());
    if (!ok || !user || !user.active || !user.passwordHash) { recordFail(keys); return res.status(401).json({ error: 'Email or password is incorrect.' }); }
    keys.forEach(([k]) => fails.delete(k));
    await startSession(res, user, config);
    res.json({ user: user.toJSON() });
  });

  router.post('/auth/logout', async (req, res) => {
    if (req.sessionDoc) await Session.deleteOne({ _id: req.sessionDoc._id });
    res.setHeader('Set-Cookie', cookieHeader('', 0, secure));
    res.json({ ok: true });
  });

  router.get('/session', (req, res) => (req.user ? res.json({ user: req.user.toJSON() }) : res.status(401).json({ error: 'Not signed in.' })));
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

/** Ends a user's other sessions, e.g. after a password reset or removal. */
const revokeSessions = (userId, keepId) => Session.deleteMany({ userId, ...(keepId ? { _id: { $ne: keepId } } : {}) });

module.exports = { authRoutes, requireUser, hashPassword, verifyPassword, revokeSessions, parseCookies, cookieName, sha256, COOKIE };
