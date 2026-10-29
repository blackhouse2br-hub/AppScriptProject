'use strict';
// Optional, read-only Google Drive access for Project Pages ("Add from Drive", "Build from Google Drive"), as a Google
// Cloud service account: staff share a project's Drive folder with the service account's email (Viewer), and the
// server reads only what is shared with it. Scope drive.readonly; nothing is ever created, changed or deleted in Drive.
// The key stays on the server (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON); access tokens live in memory for under an hour.
// Portal sign-in is not involved: signing in with Google gives the portal no access to anyone's Drive.
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder', SHORTCUT = 'application/vnd.google-apps.shortcut';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,shortcutDetails(targetId,targetMimeType),capabilities(canDownload)';
const b64url = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

class DriveError extends Error {
  constructor(message, status) { super(message); this.integration = 'drive'; this.httpStatus = status || 502; }
}

/** cfg: { email, key, apiUrl, tokenUrl } (key = the service account's PEM private key) */
function createDrive(cfg) {
  let token = '', until = 0, pending = null;
  async function newToken() {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({ iss: cfg.email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const jwt = head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), cfg.key).toString('base64url');
    let r;
    try {
      r = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), signal: AbortSignal.timeout(15000) });
    } catch (e) { throw new DriveError('Google Drive could not be reached. Try again in a minute.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new DriveError('Google Drive refused the server\'s service account (' + (d.error || 'HTTP ' + r.status) + '). Check GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON and that its key is still active.', 502);
    token = d.access_token; until = Date.now() + (Number(d.expires_in) || 3600) * 1000;
  }
  async function auth(force) {
    if (force || !token || Date.now() > until - 300e3) { pending = pending || newToken().finally(() => { pending = null; }); await pending; }
    return token;
  }
  /** One Drive API call; retries an expired token once and rate limits / server errors twice. Never logs the token. */
  async function call(path, { rk, max, text } = {}) {
    for (let attempt = 0, refreshed = false; ; attempt++) {
      let r;
      try {
        r = await fetch(cfg.apiUrl + path, { headers: { Authorization: 'Bearer ' + await auth(false), ...(rk ? { 'X-Goog-Drive-Resource-Keys': rk } : {}) }, signal: AbortSignal.timeout(30000) });
      } catch (e) { if (e instanceof DriveError) throw e; if (attempt < 2) continue; throw new DriveError('Google Drive could not be reached. Try again in a minute.'); }
      if (r.ok) {
        if (max == null) return text ? r.text() : r.json();
        if (Number(r.headers.get('content-length') || 0) > max) { r.body && r.body.cancel().catch(() => {}); throw new DriveError('too large', 413); }
        const parts = []; let size = 0;
        for await (const c of r.body || []) { size += c.length; if (size > max) { throw new DriveError('too large', 413); } parts.push(Buffer.from(c)); }
        return Buffer.concat(parts);
      }
      const e = await r.json().catch(() => ({})), err = (e && e.error) || {}, reason = ((err.errors || [])[0] || {}).reason || '';
      if (r.status === 401 && !refreshed) { refreshed = true; await auth(true); continue; }
      if ((r.status === 429 || r.status >= 500 || /rateLimitExceeded/.test(reason)) && attempt < 2) { await new Promise((s) => setTimeout(s, 500 * 2 ** attempt)); continue; }
      if (r.status === 404) throw new DriveError(`Can't open that Drive link: it doesn't exist, or it isn't shared with the portal. Share the folder with ${cfg.email} (Viewer) and try again.`, 404);
      if (/accessNotConfigured|SERVICE_DISABLED/.test(reason + JSON.stringify(err.details || ''))) throw new DriveError('The Google Drive API is not enabled in the service account\'s Google Cloud project. Enable it (APIs & Services → Library → Google Drive API).', 502);
      if (reason === 'dailyLimitExceeded' || r.status === 429 || /rateLimitExceeded/.test(reason)) throw new DriveError('Google Drive is limiting requests right now. Try again later.', 429);
      if (reason === 'domainPolicy') throw new DriveError('Your Google Workspace admin has blocked apps from reading this Drive.', 403);
      if (r.status === 401) throw new DriveError('Google Drive refused the service account\'s credentials. Check GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.', 502);
      if (r.status === 403) throw new DriveError(`The portal can't read that file. Share it with ${cfg.email} (Viewer).`, 403);
      throw new DriveError('Google Drive returned an error (HTTP ' + r.status + ').', 502);
    }
  }
  const q = (o) => new URLSearchParams({ supportsAllDrives: 'true', ...o }).toString();
  const rkFor = (id, key) => (key ? `${id}/${key}` : '');

  /** A file or folder's details; a shortcut is followed to its target. */
  async function info(id, resourceKey) {
    const f = await call(`/files/${encodeURIComponent(id)}?${q({ fields: FILE_FIELDS })}`, { rk: rkFor(id, resourceKey) });
    if (f.mimeType === SHORTCUT && f.shortcutDetails && f.shortcutDetails.targetId) return { ...(await info(f.shortcutDetails.targetId)), name: f.name };
    return f;
  }
  /** The files in a folder and its subfolders (2 levels), at most `limit`; folders themselves are not listed. */
  async function walk(folderId, { resourceKey, limit = 150, depth = 2 } = {}) {
    const out = [], queue = [[folderId, 0, resourceKey]];
    while (queue.length && out.length < limit) {
      const [id, level, rk] = queue.shift();
      let pageToken = '';
      do {
        const d = await call(`/files?${q({ q: `'${id.replace(/'/g, '')}' in parents and trashed=false`, fields: `nextPageToken,files(${FILE_FIELDS})`, pageSize: '1000',
          includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })}`, { rk: rkFor(id, rk) });
        for (const f of d.files || []) {
          const real = f.mimeType === SHORTCUT && f.shortcutDetails ? { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType } : f;
          if (real.mimeType === FOLDER) { if (level + 1 < depth) queue.push([real.id, level + 1, '']); } else if (out.length < limit) out.push(real);
        }
        pageToken = d.nextPageToken || '';
      } while (pageToken && out.length < limit);
    }
    return out;
  }
  /** A file's content, at most `max` bytes (bigger: DriveError 413). */
  const download = (id, max) => call(`/files/${encodeURIComponent(id)}?${q({ alt: 'media' })}`, { max });
  /** A Google Docs / Sheets / Slides file as text (Drive's export limit is 10 MB). */
  const exportText = async (id, mimeType) => (await call(`/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType })}`, { max: 10 * 1024 * 1024 })).toString('utf8');
  return { info, walk, download, exportText, email: cfg.email, FOLDER };
}

module.exports = { createDrive, DriveError, SCOPE };
