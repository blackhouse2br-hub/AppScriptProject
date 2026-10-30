/*
 * JSON client for MongoDB mode. Only /api/ paths are allowed, on one API address:
 *   - served by the Express server itself: same origin (BH_CONFIG.apiBase is empty)
 *   - on GitHub Pages: the Railway API from the build's config.js (BH_CONFIG.apiBase, an https origin of the same site)
 * The sign-in cookie is HttpOnly and set by the API; this file never sees or stores it.
 * In demo mode the server's CSP (connect-src 'none') blocks every request, and app.js never calls this.
 */
(function () {
  'use strict';
  const raw = (window.BH_CONFIG && window.BH_CONFIG.apiBase) || '';
  let BASE = '';
  if (raw) {
    const u = new URL(raw);
    const local = u.protocol === 'http:' && u.hostname === '127.0.0.1';
    if ((u.protocol !== 'https:' && !local) || u.pathname !== '/' || u.search || u.hash || u.username) throw new Error('BH_CONFIG.apiBase must be an https origin.');
    BASE = u.origin;
  }
  const url = (path) => {
    if (!/^\/api\/[A-Za-z0-9/_-]+(\?[A-Za-z0-9=&_-]*)?$/.test(path)) throw new Error('Only /api/ calls are allowed.');
    return BASE + path;
  };
  async function request(method, path, body, file, asText) {
    let res;
    try {
      res = await fetch(url(path), {
        method, credentials: BASE ? 'include' : 'same-origin', cache: 'no-store', mode: BASE ? 'cors' : 'same-origin',
        // a file is sent as is (the server checks what it really is); everything else is JSON
        headers: file ? { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') } : body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: file || (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch (e) {
      // the local preview runs on this computer; the hosted portal is reached over the internet
      const local = !BASE && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
      throw new Error(local ? 'Could not reach the local server. Is it still running?' : 'Could not reach the portal. Check your connection, or try again in a minute.');
    }
    if (asText && res.ok) return asText === 'blob' ? res.blob() : res.text();
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status}).`); err.status = res.status; err.stale = !!(data && data.stale); err.partial = !!(data && data.partial); throw err; }
    return data;
  }
  window.BH_API = {
    base: BASE,
    /** Full address of an API path, for links and images (listing photos). */
    url,
    get: (u) => request('GET', u),
    /** A text download (CSV); errors come back as JSON like every other call. */
    getText: (u) => request('GET', u, undefined, undefined, true),
    /** A file download (an LOI .docx). */
    getBlob: (u) => request('GET', u, undefined, undefined, 'blob'),
    post: (u, b) => request('POST', u, b || {}),
    patch: (u, b) => request('PATCH', u, b),
    put: (u, b) => request('PUT', u, b),
    del: (u) => request('DELETE', u),
    /** Uploads one File (Project Pages media, Upselling images, LOI templates). */
    upload: (u, file) => request('POST', u, undefined, file),
  };
})();
