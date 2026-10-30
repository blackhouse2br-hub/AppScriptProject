'use strict';
// Entry point. `npm start` loads preview/.env (if present) and starts in the configured mode:
//   demo  - fictional data in the browser, no database, API off
//   mongo - Express API + MongoDB (MONGODB_URI) with sign-in; refuses to start if MongoDB is unreachable
const http = require('http');
const { loadConfig, redact } = require('./src/config');
const { connectDb, disconnectDb } = require('./src/db');
const { createApp } = require('./src/app');

/** Friendly messages for listen errors; the original error stays attached as `cause`. */
function listenError(err, config) {
  const where = `${config.host}:${config.port}`;
  const msg = err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use on ${config.host}. Another preview may still be running: stop it, or start with a different PORT (for example: $env:PORT=4180; npm start).`
    : err.code === 'EACCES' ? `No permission to listen on ${where}. Use a port above 1024 (PORT in preview/.env).`
    : err.code === 'EADDRNOTAVAIL' || err.code === 'ENOTFOUND' ? `HOST "${config.host}" is not an address on this computer. Use 127.0.0.1 (HOST in preview/.env).`
    : `Could not listen on ${where}: ${err.message}`;
  const e = new Error(msg, { cause: err });
  e.code = err.code;
  return e;
}

/**
 * Listens on a plain Node server. (Express 5's app.listen also passes listen *errors* to its callback,
 * which made a busy port look like a successful start and hid EADDRINUSE behind server.address() === null.)
 */
function listen(app, config) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (err) => { server.removeListener('listening', onListening); reject(listenError(err, config)); };
    const onListening = () => { server.removeListener('error', onError); resolve(server); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });
}

/** The URL to print. address() can be null (not listening) or a string (pipe), so never assume { port }. */
function serverUrl(server, config) {
  const a = server && typeof server.address === 'function' ? server.address() : null;
  if (!a) return null;
  if (typeof a === 'string') return a;
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  return `http://${host.includes(':') ? `[${host}]` : host}:${a.port}`;
}

async function start(env = process.env, argv = process.argv, { dbTimeoutMs } = {}) {
  const config = loadConfig(env, argv);
  if (config.mode === 'mongo') await connectDb(config.mongoUri, { timeoutMs: dbTimeoutMs });
  try {
    const app = createApp(config);
    const server = await listen(app, config);
    return { server, config, app };
  } catch (err) {
    if (config.mode === 'mongo') await disconnectDb().catch(() => {});   // don't leave a DB connection open on a failed start
    throw err;
  }
}

/** Prints an error and its causes (messages only for known startup errors; stack for unexpected ones). Credentials are redacted. */
function reportStartupError(err, log = console.error) {
  const known = err && (err.code || /^(APP_MODE|MONGODB_URI|PORT|SESSION_HOURS|Demo mode|Email-and-password|Could not connect to MongoDB|MONDAY_|RESPOND_|KPI_REVIEWER|GOOGLE_DRIVE_|ANTHROPIC_|PUBLIC_API_URL|PORTAL_URL|AUTH_PROVIDER|GOOGLE_|Google sign-in needs|The portal \(|Production start refused|LOI_|GOTENBERG_|SMTP_)/.test(err.message || ''));
  log('[startup] ' + redact(err && err.message ? err.message : String(err)));
  let c = err && err.cause, depth = 0;
  while (c && depth++ < 5) { log('  caused by: ' + redact(c.code ? `${c.code}: ${c.message}` : c.message || String(c))); c = c.cause; }
  if (!known && err && err.stack) log(redact(err.stack.split('\n').slice(1).join('\n')));
}

function printBanner(server, config, log = console.log) {
  const url = serverUrl(server, config);
  log(url ? `Blackhouse Leads Portal preview running at ${url}` : 'Blackhouse Leads Portal preview started, but the server address is not available.');
  log(config.mode === 'mongo'
    ? 'Mode: MONGO. Records are read from and saved to MongoDB; sign-in required. Monday.com and respond.io are read-only unless switched on (see below; MONDAY_WRITES=on allows only the allowlisted, confirmed Monday updates).'
    : 'Mode: DEMO. Fictional data only, kept in your browser. No database, no API, no outside services.');
  if (config.production) log('Production: every production condition was met (src/production.js).');
  if (config.integrations) {
    const m = config.integrations.monday, r = config.integrations.respond;
    log(`Monday.com (${m.writes ? 'reads + allowlisted confirmed updates' : 'read-only'}): ${m.token && Object.values(m.boards).some(Boolean) ? 'configured' : 'not connected'} · respond.io (${r.sends ? 'reads + Upselling sends, each confirmed' : 'read-only'}): ${r.token ? 'configured' : 'not connected'}`);
  }
  if (config.ignoredIntegrationVars.length) log(`Ignored in demo mode: ${config.ignoredIntegrationVars.join(', ')} (integrations run only in MongoDB mode).`);
  log('Press Ctrl+C to stop.');
}

/**
 * Monday.com is the default data source in MongoDB mode, and a full first load can take minutes, so the boards are
 * read once in the background right after startup (read-only; results stay in server memory). Logs counts and errors
 * only (redacted), never data or credentials. The page shows its own loading/error state either way.
 */
function preloadMonday(app, log = console.log) {
  const integ = app && app.locals && app.locals.integ;
  if (!integ || !integ.monday) return null;
  const t0 = Date.now();
  log('Monday.com: loading the boards in the background (read-only)…');
  return integ.monday.loadAll(false).then((all) => {
    const errs = Object.entries(all.errors);
    log(`Monday.com: ready in ${Math.round((Date.now() - t0) / 1000)} s — ${all.leads.length} leads, ${all.listings.length} listings, ${all.viewings.length} viewings`
      + (errs.length ? ` · errors: ${errs.map(([k, v]) => k + ': ' + redact(v)).join(' | ')}` : ''));
    return all;
  }, (err) => { log('Monday.com: preload failed: ' + redact(err.message)); return null; });
}

if (require.main === module) {
  start().then(({ server, config, app }) => {
    try { printBanner(server, config); } catch (err) { reportStartupError(err); }   // the server is up; a banner problem must not hide that
    preloadMonday(app);
    // a redeploy (Railway sends SIGTERM): stop taking requests, let the ones running finish (up to 20 s), then close the
    // database, so a save or a signature in progress isn't cut off halfway
    let stopping = false;
    const stop = (sig) => {
      if (stopping) return; stopping = true;
      console.log(`[shutdown] ${sig}: finishing requests in progress…`);
      const force = setTimeout(() => process.exit(0), 20000); force.unref();
      server.close(async () => { if (config.mode === 'mongo') await disconnectDb().catch(() => {}); process.exit(0); });
      if (server.closeIdleConnections) server.closeIdleConnections();
    };
    process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
  }).catch((err) => {
    reportStartupError(err);
    process.exit(1);
  });
}

module.exports = { start, serverUrl, listenError, reportStartupError, printBanner, preloadMonday };
