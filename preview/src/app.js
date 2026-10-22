'use strict';
const path = require('path');
const express = require('express');
const { dbReady } = require('./db');

const PUBLIC = path.join(__dirname, '..', 'public');

function securityHeaders(mode) {
  // demo mode: the page may not make any network request at all; mongo mode: same-origin API only
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${mode === 'mongo' ? "'self'" : "'none'"}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`;
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(securityHeaders(config.mode));

  app.get('/healthz', (req, res) => {
    const db = config.mode === 'mongo' ? (dbReady() ? 'connected' : 'disconnected') : 'not used';
    res.status(db === 'disconnected' ? 503 : 200).json({ ok: db !== 'disconnected', mode: config.mode, db });
  });
  app.get('/config.js', (req, res) => res.type('text/javascript').send(`window.BH_CONFIG = ${JSON.stringify({ mode: config.mode })};\n`));

  if (config.mode === 'mongo') app.use('/api', require('./api').apiRouter(config));
  else app.use('/api', (req, res) => res.status(404).json({ error: 'The API is switched off in demo mode. Demo data stays in your browser.' }));

  app.use(express.static(PUBLIC, { index: 'index.html', dotfiles: 'deny', redirect: false }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body.' });
    if (err.code === 11000) return res.status(409).json({ error: 'That ' + Object.keys(err.keyPattern || { value: 1 })[0] + ' is already in use.' });
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: 'Invalid value.' });
    if (err.status && err.status < 500) return res.status(err.status).type('text/plain').send('Bad request');
    console.error('[error]', err.message);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}

module.exports = { createApp };
