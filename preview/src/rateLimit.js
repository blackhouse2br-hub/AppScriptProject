'use strict';
// Limits for the routes anyone can reach without signing in (Google sign-in start and return, Drive connect return, the
// signing page, published project pages, offer images). In memory, one server (Railway runs one replica).
//
// An office shares one public address, so per-address limits are generous and a tighter limit is kept per signing link
// (or per published page) where one exists: a team behind one connection is not blocked by one busy colleague, while a
// script hammering one link or one route is. Memory is bounded: at most `maxKeys` keys per limiter, least recent dropped.

/** take(key) → 0 when allowed (and counted), else the seconds until it is allowed again. Fixed windows of `windowMs`. */
function createLimiter({ max, windowMs, maxKeys = 10000, now = Date.now }) {
  const hits = new Map();   // key → { start, n }, in least-recently-seen order
  return function take(key) {
    const t = now(); let h = hits.get(key);
    if (!h || t - h.start >= windowMs) h = { start: t, n: 0 };
    hits.delete(key); hits.set(key, h);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    if (h.n >= max) return Math.max(1, Math.ceil((h.start + windowMs - t) / 1000));
    h.n++;
    return 0;
  };
}

/**
 * Express middleware: limits[] of { take, key(req) } (a key of '' is not limited); the first one exceeded answers 429
 * with Retry-After, as JSON or as a short page (html: true).
 */
function limitRoute(limits, { html = false, message = 'Too many requests. Try again in a few minutes.' } = {}) {
  return (req, res, next) => {
    for (const l of limits) {
      const k = l.key(req); if (!k) continue;
      const wait = l.take(k);
      if (wait) {
        res.set('Retry-After', String(wait));
        if (html) return res.status(429).type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Too many requests</title><p style="font:16px system-ui;margin:24px">${message}</p>`);
        return res.status(429).json({ error: message, retryAfter: wait });
      }
    }
    next();
  };
}
const byIp = (req) => 'ip:' + String(req.ip || '');

module.exports = { createLimiter, limitRoute, byIp };
