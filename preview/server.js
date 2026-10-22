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
    const server = await listen(createApp(config), config);
    return { server, config };
  } catch (err) {
    if (config.mode === 'mongo') await disconnectDb().catch(() => {});   // don't leave a DB connection open on a failed start
    throw err;
  }
}

/** Prints an error and its causes (messages only for known startup errors; stack for unexpected ones). Credentials are redacted. */
function reportStartupError(err, log = console.error) {
  const known = err && (err.code || /^(APP_MODE|MONGODB_URI|PORT|SESSION_HOURS|Demo mode|Email-and-password|Could not connect to MongoDB|MONDAY_|RESPOND_)/.test(err.message || ''));
  log('[startup] ' + redact(err && err.message ? err.message : String(err)));
  let c = err && err.cause, depth = 0;
  while (c && depth++ < 5) { log('  caused by: ' + redact(c.code ? `${c.code}: ${c.message}` : c.message || String(c))); c = c.cause; }
  if (!known && err && err.stack) log(redact(err.stack.split('\n').slice(1).join('\n')));
}

function printBanner(server, config, log = console.log) {
  const url = serverUrl(server, config);
  log(url ? `Blackhouse Leads Portal preview running at ${url}` : 'Blackhouse Leads Portal preview started, but the server address is not available.');
  log(config.mode === 'mongo'
    ? 'Mode: MONGO. Records are read from and saved to MongoDB; sign-in required. Monday.com, respond.io and Google are not connected.'
    : 'Mode: DEMO. Fictional data only, kept in your browser. No database, no API, no outside services.');
  if (config.integrations) {
    const m = config.integrations.monday, r = config.integrations.respond;
    log(`Monday.com (read-only): ${m.token && Object.values(m.boards).some(Boolean) ? 'configured' : 'not connected'} · respond.io (read-only): ${r.token ? 'configured' : 'not connected'}`);
  }
  if (config.ignoredIntegrationVars.length) log(`Ignored in demo mode: ${config.ignoredIntegrationVars.join(', ')} (integrations run only in MongoDB mode).`);
  log('Press Ctrl+C to stop.');
}

if (require.main === module) {
  start().then(({ server, config }) => {
    try { printBanner(server, config); } catch (err) { reportStartupError(err); }   // the server is up; a banner problem must not hide that
  }).catch((err) => {
    reportStartupError(err);
    process.exit(1);
  });
}

module.exports = { start, serverUrl, listenError, reportStartupError, printBanner };
