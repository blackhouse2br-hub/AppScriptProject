'use strict';
const path = require('path');
const express = require('express');
const { dbReady } = require('./db');
const { redact } = require('./config');

const PUBLIC = path.join(__dirname, '..', 'public');

function securityHeaders(mode, hsts) {
  // demo mode: the page may not make any network request at all; mongo mode: same-origin API only
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${mode === 'mongo' ? "'self'" : "'none'"}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`;
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    // https only from now on, for a year (only on a server whose cookies are https-only anyway)
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

/**
 * The portal page on GitHub Pages (PORTAL_URL) calls this API from another origin of the same site. Only that exact
 * origin gets CORS access, with cookies; every other origin gets no CORS headers (the browser then blocks the reply).
 */
function portalCors(web) {
  return (req, res, next) => {
    res.vary('Origin');
    if (req.headers.origin !== web.portalOrigin) return req.method === 'OPTIONS' ? res.status(403).end() : next();
    res.setHeader('Access-Control-Allow-Origin', web.portalOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  };
}

function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  const web = config.web;
  if (config.production || (web && web.trustProxy)) app.set('trust proxy', 1);
  app.use(securityHeaders(config.mode, !!(config.web && config.web.secureCookies && /^https:/.test(config.web.apiOrigin))));
  if (web && web.crossOrigin) app.use('/api', portalCors(web));

  app.get('/healthz', (req, res) => {
    const db = config.mode === 'mongo' ? (dbReady() ? 'connected' : 'disconnected') : 'not used';
    // `app` and `auth` let the GitHub Pages redirect build confirm it points at this portal, signed in with Google
    res.status(db === 'disconnected' ? 503 : 200).json({ ok: db !== 'disconnected', app: 'blackhouse-leads-portal', mode: config.mode, db, auth: config.auth ? config.auth.provider : 'none' });
  });
  // page settings only (never a secret): the API is this same server, so apiBase is empty
  app.get('/config.js', (req, res) => res.type('text/javascript').send(`window.BH_CONFIG = ${JSON.stringify({ mode: config.mode, apiBase: '', auth: config.auth ? config.auth.provider : 'none' })};\n`));

  if (config.mode === 'mongo') {
    const api = require('./api').apiRouter(config); app.locals.integ = api.integ; app.use('/api', api);
    // published project pages (no sign-in): /p/<slug> and its media; unpublished projects are not found
    app.use((req, res, next) => (dbReady() ? next() : /^\/(p|upsell-media|sign)\//.test(req.path) ? res.status(503).type('text/plain').send('Temporarily unavailable') : next()));
    app.use(require('./projects').projectPublicRoutes());
    // an Upselling offer's image, for respond.io to fetch (unguessable link per image)
    app.use(require('./upsell').upsellPublicRoutes());
    // LOI signing links (/sign/<token>): no sign-in; each link expires and works once (src/loiSign.js)
    app.use(api.loiSign.publicRoutes());
  }
  else app.use('/api', (req, res) => res.status(404).json({ error: 'The API is switched off in demo mode. Demo data stays in your browser.' }));

  // with the portal on GitHub Pages this server is the API only; its address just forwards people to the portal.
  // The published project pages (/p/<slug>) are still served here, so their one script must be too.
  if (web && web.crossOrigin) {
    app.get('/project-page.js', (req, res) => res.type('text/javascript').sendFile(path.join(PUBLIC, 'project-page.js')));
    app.get('/', (req, res) => res.redirect(302, web.portalUrl));
  }
  else app.use(express.static(PUBLIC, { index: 'index.html', dotfiles: 'deny', redirect: false }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body.' });
    if (err.code === 11000) return res.status(409).json({ error: 'That ' + Object.keys(err.keyPattern || { value: 1 })[0] + ' is already in use.' });
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: 'Invalid value.' });
    if (err.status && err.status < 500) return res.status(err.status).type('text/plain').send('Bad request');
    console.error('[error]', redact(err.message));
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}

module.exports = { createApp };
