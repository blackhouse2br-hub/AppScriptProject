'use strict';
// Reads configuration from the environment (preview/.env is loaded by `node --env-file-if-exists`).
// The mode is always explicit: demo mode never touches MongoDB, and mongo mode never falls back to demo data.

const { loadDeploy, isLoopback } = require('./deploy');

const MODES = ['demo', 'mongo'];

function loadConfig(env = process.env, argv = process.argv) {
  const flag = (argv.find((a) => a.startsWith('--mode=')) || '').slice(7).trim().toLowerCase();
  const raw = flag || String(env.APP_MODE || '').trim().toLowerCase();
  const uri = String(env.MONGODB_URI || '').trim();
  if (raw && !MODES.includes(raw)) throw new Error(`APP_MODE must be "demo" or "mongo" (got "${raw}").`);
  const mode = raw || (uri ? 'mongo' : 'demo');
  const production = env.NODE_ENV === 'production';

  if (mode === 'mongo') {
    if (!uri) throw new Error('APP_MODE=mongo needs MONGODB_URI. Add it to preview/.env (copy .env.example). It will not fall back to demo mode.');
    if (!/^mongodb(\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
  // demo mode has no sign-in at all ("View as" is a preview switch), so it must never run as a production deployment
  if (mode === 'demo' && production) throw new Error('Demo mode is for local use only and will not start with NODE_ENV=production.');

  const port = env.PORT === undefined || env.PORT === '' ? 4173 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a number between 0 and 65535.');
  const sessionHours = Number(env.SESSION_HOURS) || 12;
  if (!(sessionHours > 0 && sessionHours <= 24 * 30)) throw new Error('SESSION_HOURS must be between 1 and 720.');
  const host = String(env.HOST || '127.0.0.1');
  if (mode === 'demo' && !isLoopback(host)) throw new Error('Demo mode has no sign-in, so it only listens on this computer (HOST=127.0.0.1).');
  // sign-in method and page/API addresses (GitHub Pages + Railway); every check runs before the production block below
  const { web, auth } = mode === 'mongo' ? loadDeploy(env, { host, port, production }) : { web: null, auth: null };

  // Production stays blocked until Google sign-in and the Pages + Railway setup have been tested on a real deployment
  // (DEPLOYMENT.md, "Before production"). The configuration above is already fully checked, so errors show first.
  if (mode === 'mongo' && production) throw new Error('Production start is still blocked: Google sign-in is required before production, and it and the GitHub Pages + Railway setup must first be tested on a staging deployment (see DEPLOYMENT.md, "Before production").');

  return {
    mode,
    mongoUri: mode === 'mongo' ? uri : '',
    production,
    host,
    port,
    sessionHours,
    web,
    auth,
    // read-only Monday.com / respond.io access exists only in mongo mode (signed in); demo mode never uses them
    integrations: mode === 'mongo' ? loadIntegrations(env) : null,
    // KPI Review reviewers (Toby, Jonjo): who may write coaching and feedback, set only on the server
    kpiReview: mode === 'mongo' ? loadKpiReviewers(env) : null,
    // Project Pages: optional read-only Google Drive (service account) and the AI reader for "Build from Google Drive"
    projects: mode === 'mongo' ? loadProjectPages(env, isLoopback(host)) : null,
    storage: mode === 'mongo' ? loadStorage(env, isLoopback(host)) : null,
    ignoredIntegrationVars: mode === 'demo' ? ['MONDAY_TOKEN', 'RESPOND_TOKEN'].filter((k) => String(env[k] || '').trim()) : [],
  };
}

const boardId = (env, key) => {
  const v = String(env[key] || '').trim();
  if (v && !/^\d{5,20}$/.test(v)) throw new Error(`${key} must be a Monday board ID (digits only).`);
  return v;
};
// API base URLs are fixed to the official hosts; an override is accepted only for a local mock server (tests)
function apiBase(env, key, official) {
  const v = String(env[key] || '').trim();
  if (!v) return official;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+(\/[\w/.-]*)?$/.test(v)) throw new Error(`${key} may only point to a local mock server (http://127.0.0.1:<port>).`);
  return v.replace(/\/$/, '');
}
/** Allowlisted Monday update attempts per user per minute (the server as a whole: 3×). Default 10. */
function writeLimit(env) {
  const v = String(env.MONDAY_WRITE_LIMIT || '').trim();
  if (!v) return 10;
  if (!/^\d{1,2}$/.test(v) || Number(v) < 1 || Number(v) > 60) throw new Error('MONDAY_WRITE_LIMIT must be a number from 1 to 60 (Monday updates per user per minute).');
  return Number(v);
}
function columnId(env, key) {
  const v = String(env[key] || '').trim();
  if (v && !/^[a-z0-9_]{1,64}$/.test(v)) throw new Error(`${key} must be a Monday column ID (lower-case letters, digits and _).`);
  return v;
}
function loadIntegrations(env) {
  return {
    monday: {
      token: String(env.MONDAY_TOKEN || '').trim(),
      apiUrl: apiBase(env, 'MONDAY_API_URL', 'https://api.monday.com/v2'),
      boards: { leads: boardId(env, 'MONDAY_LEADS_BOARD_ID'), listings: boardId(env, 'MONDAY_LISTINGS_BOARD_ID'), calendar: boardId(env, 'MONDAY_CALENDAR_BOARD_ID') },
      // the few allowlisted Monday updates (src/integrations/mondayWrite.js) are off unless switched on explicitly;
      // with them off, Monday stays strictly read-only
      writes: String(env.MONDAY_WRITES || '').trim().toLowerCase() === 'on',
      writeLimit: writeLimit(env),
      // optional: the Calendar-board column (id) that also receives a viewing's broker feedback; there is no such
      // column by default, so the feedback stays in the portal (as the Apps Script kept it) unless the owner names one
      calFeedbackColumn: columnId(env, 'MONDAY_CALENDAR_FEEDBACK_COLUMN'),
    },
    respond: {
      token: String(env.RESPOND_TOKEN || '').trim(),
      apiUrl: apiBase(env, 'RESPOND_API_URL', 'https://api.respond.io/v2'),
      spaceId: /^\d{1,20}$/.test(String(env.RESPOND_SPACE_ID || '').trim()) ? String(env.RESPOND_SPACE_ID).trim() : '',
      // list-wide reply-state checks (last 15 messages of every visible lead) are off unless switched on;
      // with them off, respond.io is read only when someone opens a lead's Chat tab
      listChecks: String(env.RESPOND_LIST_CHECKS || '').trim().toLowerCase() === 'on',
      // Upselling sends (messages and tags to clients, each one confirmed): off unless switched on explicitly
      sends: String(env.RESPOND_SENDS || '').trim().toLowerCase() === 'on',
    },
  };
}

/**
 * KPI_REVIEWER_TOBY_EMAIL / KPI_REVIEWER_JONJO_EMAIL: the Team & Access email of each reviewer. Unset = that reviewer
 * slot has nobody yet (their column is read-only for everyone). A sign-in alone never makes someone a reviewer.
 */
function loadKpiReviewers(env) {
  const { KPI_REVIEW, EMAIL_RE } = require('../public/shared');
  const reviewers = KPI_REVIEW.reviewers.map(({ key, label }) => {
    const name = `KPI_REVIEWER_${key.toUpperCase()}_EMAIL`, email = String(env[name] || '').trim().toLowerCase();
    if (email && (!EMAIL_RE.test(email) || email.length > 120)) throw new Error(`${name} must be one email address (the reviewer's Team & Access email), or left empty.`);
    if (KPI_REVIEW.neverReviewers.includes(email)) throw new Error(`${name} must be ${label}'s own Google account. The shared Blackhouse account can't be a KPI reviewer.`);
    return { key, label, email };
  });
  const set = reviewers.filter((r) => r.email);
  if (new Set(set.map((r) => r.email)).size !== set.length) throw new Error('KPI_REVIEWER_TOBY_EMAIL and KPI_REVIEWER_JONJO_EMAIL must be different people.');
  return { reviewers };
}

/**
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: the service account's JSON key (as downloaded, or base64 of it). Unset: Drive
 * features are off and Project Pages works without them. ANTHROPIC_API_KEY: reads Drive documents for "Build from
 * Google Drive"; unset: that only imports the folder's media. Values are never printed.
 */
function loadProjectPages(env, local) {
  // the test-only overrides for these services are refused outright on a server others can reach
  if (!local) ['GOOGLE_DRIVE_API_URL', 'GOOGLE_DRIVE_TOKEN_URL', 'ANTHROPIC_BASE_URL'].forEach((k) => { if (String(env[k] || '').trim()) throw new Error(`${k} is for local tests only; remove it from this server's variables.`); });
  let drive = null;
  const raw = String(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    let j = null;
    try { j = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); } catch (e) { /* below */ }
    if (!j || typeof j.client_email !== 'string' || typeof j.private_key !== 'string' || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(j.client_email) || !/-----BEGIN PRIVATE KEY-----/.test(j.private_key)) {
      throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON must be a Google Cloud service account JSON key (with client_email and private_key), or base64 of it.');
    }
    try { require('crypto').createPrivateKey(j.private_key); } catch (e) { throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON has a private_key that can\'t be read.'); }
    drive = { email: j.client_email, key: j.private_key,
      apiUrl: apiBase(env, 'GOOGLE_DRIVE_API_URL', 'https://www.googleapis.com/drive/v3'), tokenUrl: apiBase(env, 'GOOGLE_DRIVE_TOKEN_URL', 'https://oauth2.googleapis.com/token') };
  }
  const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const ai = apiKey ? { apiKey, baseURL: apiBase(env, 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com') } : null;
  return { drive, ai };
}

/** A service account JSON key (as downloaded, or base64 of it) → { email, key }; `name` is the variable, for the error. */
function serviceAccount(raw, name) {
  let j = null;
  try { j = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); } catch (e) { /* below */ }
  if (!j || typeof j.client_email !== 'string' || typeof j.private_key !== 'string' || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(j.client_email) || !/-----BEGIN PRIVATE KEY-----/.test(j.private_key)) {
    throw new Error(`${name} must be a Google Cloud service account JSON key (with client_email and private_key), or base64 of it.`);
  }
  try { require('crypto').createPrivateKey(j.private_key); } catch (e) { throw new Error(`${name} has a private_key that can't be read.`); }
  return { email: j.client_email, key: j.private_key };
}

/**
 * Files the portal writes to Google Drive (LOI signed copies, deal files) and LOI e-signature. All optional; each part
 * that isn't set shows a setup state instead. Values are never printed.
 *   GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON  a service account (separate from the read-only Project Pages one) that is
 *     a Content manager / Editor of the folders below, in a Shared Drive (service accounts have no storage of their own)
 *   GOOGLE_DRIVE_LOI_FOLDER_ID / GOOGLE_DRIVE_DEALS_FOLDER_ID  the folders' IDs (from their Drive links)
 *   LOI_SIGNING=on  signing links can be created; LOI_SIGN_TTL_DAYS (default 14) is how long a link stays valid
 *   LOI_PDF_CONVERTER  drive (Google's own converter, as the Apps Script) | gotenberg (GOTENBERG_URL) | none
 *   SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, SMTP_FROM  email delivery of signing links
 */
function loadStorage(env, local) {
  const v = (k) => String(env[k] || '').trim();
  if (!local) ['GOOGLE_DRIVE_UPLOAD_URL', 'GOTENBERG_TEST_URL'].forEach((k) => { if (v(k)) throw new Error(`${k} is for local tests only; remove it from this server's variables.`); });
  const folder = (k) => { const s = v(k); if (s && !/^[\w-]{10,100}$/.test(s)) throw new Error(`${k} must be a Google Drive folder ID (the part after /folders/ in its link).`); return s; };
  let drive = null;
  if (v('GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON')) {
    drive = { ...serviceAccount(v('GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON'), 'GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON'), scope: 'https://www.googleapis.com/auth/drive',
      apiUrl: apiBase(env, 'GOOGLE_DRIVE_API_URL', 'https://www.googleapis.com/drive/v3'), uploadUrl: apiBase(env, 'GOOGLE_DRIVE_UPLOAD_URL', 'https://www.googleapis.com/upload/drive/v3'),
      tokenUrl: apiBase(env, 'GOOGLE_DRIVE_TOKEN_URL', 'https://oauth2.googleapis.com/token') };
  }
  const ttl = v('LOI_SIGN_TTL_DAYS') ? Number(v('LOI_SIGN_TTL_DAYS')) : 14;
  if (!(Number.isInteger(ttl) && ttl >= 1 && ttl <= 60)) throw new Error('LOI_SIGN_TTL_DAYS must be a whole number of days from 1 to 60.');
  const conv = (v('LOI_PDF_CONVERTER') || 'none').toLowerCase();
  if (!['none', 'drive', 'gotenberg'].includes(conv)) throw new Error('LOI_PDF_CONVERTER must be drive, gotenberg or none.');
  if (conv === 'gotenberg' && !v('GOTENBERG_URL') && !v('GOTENBERG_TEST_URL')) throw new Error('LOI_PDF_CONVERTER=gotenberg needs GOTENBERG_URL.');
  const gotUrl = v('GOTENBERG_TEST_URL') || v('GOTENBERG_URL');
  if (gotUrl && !/^https:\/\/[^\s/]+/.test(gotUrl) && !(local && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(gotUrl.replace(/\/$/, '')))) throw new Error('GOTENBERG_URL must be an https address.');
  let smtp = null;
  if (v('SMTP_HOST')) {
    const port = Number(v('SMTP_PORT') || 465), secure = v('SMTP_SECURE').toLowerCase() !== 'off';
    if (!secure && !(local && /^(127\.0\.0\.1|localhost)$/.test(v('SMTP_HOST')))) throw new Error('SMTP_SECURE=off is for local tests only.');
    if (!v('SMTP_FROM') || !/^[^@\s]+@[^@\s]+$/.test(v('SMTP_FROM').replace(/^.*<|>$/g, ''))) throw new Error('SMTP_FROM must be the sender address (e.g. Blackhouse <loi@example.com>).');
    smtp = { host: v('SMTP_HOST'), port, secure, user: v('SMTP_USER'), pass: v('SMTP_PASS'), from: v('SMTP_FROM') };
  }
  return { drive, loiFolder: folder('GOOGLE_DRIVE_LOI_FOLDER_ID'), dealsFolder: folder('GOOGLE_DRIVE_DEALS_FOLDER_ID'),
    signing: v('LOI_SIGNING').toLowerCase() === 'on', signTtlDays: ttl, pdf: conv, gotenbergUrl: gotUrl.replace(/\/$/, ''), smtp };
}

/** Hides credentials if a connection string ever ends up in a message. */
const redact = (s) => String(s).replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1***@').replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
  .replace(/\b(GOCSPX-)[\w-]+/g, '$1***').replace(/\b(client_secret|code_verifier|code|assertion)=[^&\s"']+/gi, '$1=***')
  .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?(-----END PRIVATE KEY-----|$)/g, '[private key]').replace(/\bsk-ant-[\w-]+/g, 'sk-ant-***');

module.exports = { loadConfig, redact, MODES };
