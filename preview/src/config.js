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
function loadIntegrations(env) {
  return {
    monday: {
      token: String(env.MONDAY_TOKEN || '').trim(),
      apiUrl: apiBase(env, 'MONDAY_API_URL', 'https://api.monday.com/v2'),
      boards: { leads: boardId(env, 'MONDAY_LEADS_BOARD_ID'), listings: boardId(env, 'MONDAY_LISTINGS_BOARD_ID'), calendar: boardId(env, 'MONDAY_CALENDAR_BOARD_ID') },
    },
    respond: {
      token: String(env.RESPOND_TOKEN || '').trim(),
      apiUrl: apiBase(env, 'RESPOND_API_URL', 'https://api.respond.io/v2'),
      spaceId: /^\d{1,20}$/.test(String(env.RESPOND_SPACE_ID || '').trim()) ? String(env.RESPOND_SPACE_ID).trim() : '',
      // list-wide reply-state checks (last 15 messages of every visible lead) are off unless switched on;
      // with them off, respond.io is read only when someone opens a lead's Chat tab
      listChecks: String(env.RESPOND_LIST_CHECKS || '').trim().toLowerCase() === 'on',
    },
  };
}

/** Hides credentials if a connection string ever ends up in a message. */
const redact = (s) => String(s).replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1***@').replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
  .replace(/\b(GOCSPX-)[\w-]+/g, '$1***').replace(/\b(client_secret|code_verifier|code)=[^&\s"']+/gi, '$1=***');

module.exports = { loadConfig, redact, MODES };
