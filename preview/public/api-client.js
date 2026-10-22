/*
 * Same-origin JSON client for MongoDB mode. Only relative /api/ paths are allowed.
 * In demo mode the server's CSP (connect-src 'none') blocks every request, and app.js never calls this.
 */
(function () {
  'use strict';
  async function request(method, url, body) {
    if (!/^\/api\/[A-Za-z0-9/_-]+$/.test(url)) throw new Error('Only same-origin /api/ calls are allowed.');
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error('Could not reach the local server. Is it still running?'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status}).`); err.status = res.status; throw err; }
    return data;
  }
  window.BH_API = {
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b || {}),
    patch: (u, b) => request('PATCH', u, b),
    del: (u) => request('DELETE', u),
  };
})();
