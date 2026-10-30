'use strict';
// NODE_ENV=production (mongo mode): the server starts only when every condition below holds, checked after all other
// settings. It replaces the earlier blanket "Production start is still blocked" with what that block stood for:
// Google sign-in on a public https address, no local-test settings, the Atlas database, the KPI reviewers, a stable
// signing key, and the owner's statement that DEPLOYMENT.md "Before production" passed on the staging run
// (PRODUCTION_CHECKLIST_ACK). A message names the variable, never its value.
const { isLoopback } = require('./deploy');

// bump the version when the checklist in DEPLOYMENT.md changes materially: production then needs a new acknowledgement
const CHECKLIST_ACK = 'DEPLOYMENT.md-before-production-v1';
// local mock servers and test switches: never on a production server, whatever they point to
const TEST_ONLY = ['MONDAY_API_URL', 'RESPOND_API_URL', 'GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_JWKS_URL', 'GOOGLE_REVOKE_URL',
  'GOOGLE_DRIVE_API_URL', 'GOOGLE_DRIVE_TOKEN_URL', 'GOOGLE_DRIVE_UPLOAD_URL', 'ANTHROPIC_BASE_URL', 'GOTENBERG_TEST_URL', 'SMTP_SECURE'];

/** The database host of a mongodb:// or mongodb+srv:// URI (first host of a list), lower case. */
function mongoHost(uri) {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/?,:]+)/i);
  return m ? m[1].toLowerCase().replace(/^\[|\]$/g, '') : '';
}

/** Throws the first unmet production condition. cfg: the loaded configuration (mongo mode, NODE_ENV=production). */
function assertProductionReady(env, cfg) {
  const v = (k) => String(env[k] || '').trim();
  const fail = (msg) => { throw new Error('Production start refused: ' + msg); };
  if (!cfg.auth || cfg.auth.provider !== 'google' || !cfg.auth.google) fail('production requires Google sign-in (AUTH_PROVIDER=google with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).');
  if (isLoopback(cfg.host) || !/^https:\/\//.test(cfg.web.apiOrigin) || !v('PUBLIC_API_URL')) fail('production requires HOST=0.0.0.0 and PUBLIC_API_URL set to the public https:// address.');
  const test = TEST_ONLY.filter((k) => v(k));
  if (test.length) fail(`${test.join(', ')} ${test.length > 1 ? 'are' : 'is'} for local tests only; remove ${test.length > 1 ? 'them' : 'it'} from this server's variables.`);
  const host = mongoHost(cfg.mongoUri);
  if (!host || isLoopback(host) || host === '0.0.0.0' || /^127\./.test(host)) fail('MONGODB_URI points at this computer; production needs the hosted (Atlas) database.');
  const missing = (cfg.kpiReview ? cfg.kpiReview.reviewers : []).filter((r) => !r.email).map((r) => `KPI_REVIEWER_${r.key.toUpperCase()}_EMAIL`);
  if (missing.length) fail(`${missing.join(' and ')} must be set: KPI Review is private to its two reviewers.`);
  if (cfg.storage && cfg.storage.signing && v('LOI_SIGN_SECRET').length < 32) fail('LOI_SIGNING=on needs LOI_SIGN_SECRET (at least 32 random characters), so signing pages survive a restart.');
  if (v('PRODUCTION_CHECKLIST_ACK') !== CHECKLIST_ACK) fail(`set PRODUCTION_CHECKLIST_ACK=${CHECKLIST_ACK} once every item in DEPLOYMENT.md "Before production" has passed on the staging run.`);
}

module.exports = { assertProductionReady, CHECKLIST_ACK, TEST_ONLY, mongoHost };
