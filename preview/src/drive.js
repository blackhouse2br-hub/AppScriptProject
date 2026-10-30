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

/**
 * cfg: { email, key, apiUrl, tokenUrl } (key = the service account's PEM private key). The writer (LOI signed copies,
 * deal files) is a separate service account and client: cfg.scope = WRITE_SCOPE and cfg.uploadUrl.
 * My Drive storage (src/driveStore.js): cfg.tokenSource() → { token, expiresIn } replaces the service account (a
 * connected Google account's refresh token), cfg.scope = FILE_SCOPE and cfg.email is that account.
 */
function createDrive(cfg) {
  let token = '', until = 0, pending = null;
  const scope = cfg.scope || SCOPE, oauth = !!cfg.tokenSource;
  async function newToken() {
    if (oauth) { const t = await cfg.tokenSource(); token = t.token; until = Date.now() + (Number(t.expiresIn) || 3600) * 1000; return; }
    const now = Math.floor(Date.now() / 1000);
    const head = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({ iss: cfg.email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
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
      if (r.status === 404 && oauth) throw new DriveError(`That file is no longer in the portal's Google Drive (${cfg.email}): it was deleted or moved out of the portal's folder.`, 404);
      // a rate limit comes as 403 too: not a reason to reconnect
      if (r.status === 403 && oauth && !/rateLimitExceeded|quotaExceeded$/.test(reason)) throw new DriveError(`Google Drive refused access for ${cfg.email}. A Manager should reconnect Google Drive in Settings.`, 403);
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
  const out = { info, walk, download, exportText, email: cfg.email, FOLDER };
  if (scope !== WRITE_SCOPE && scope !== FILE_SCOPE) return out;

  // ---- writer only: upload into a folder shared with the service account, export a PDF, delete a temporary file ----
  // (My Drive storage: into the folders the portal created in the connected account's Drive)
  const msg = oauth ? {
    gone: 'The portal\'s Google Drive folder is gone (deleted or in the Trash). A Manager can reconnect Google Drive in Settings to make it again.',
    full: `Google Drive refused the file: the Drive of ${cfg.email} is full. Free up space there and try again.`,
    denied: `Google Drive refused the file for ${cfg.email}. A Manager should reconnect Google Drive in Settings.`,
  } : {
    gone: `The Drive folder doesn't exist or isn't shared with ${cfg.email}. Share it (Content manager / Editor) and try again.`,
    full: 'Google Drive refused the file: the service account has no storage. Use a folder in a Shared Drive and add the service account to it.',
    denied: `The portal can't write to that Drive folder. Share it with ${cfg.email} as Content manager / Editor.`,
  };
  async function write(method, url, body, headers) {
    for (let attempt = 0, refreshed = false; ; attempt++) {
      let r;
      try { r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await auth(false), ...(headers || {}) }, body, signal: AbortSignal.timeout(60000) }); }
      catch (e) { if (e instanceof DriveError) throw e; throw new DriveError('Google Drive could not be reached. The file was not saved; try again.'); }
      if (r.ok) return r;
      const e = await r.json().catch(() => ({})), reason = (((e.error || {}).errors || [])[0] || {}).reason || '';
      if (r.status === 401 && !refreshed) { refreshed = true; await auth(true); continue; }
      if ((r.status === 429 || r.status >= 500) && attempt < 1 && method !== 'POST') { await new Promise((s) => setTimeout(s, 800)); continue; }
      if (r.status === 404) throw new DriveError(msg.gone, 409);
      // rate limits come as 403 too: not a permission or storage problem
      if (/rateLimitExceeded|quotaExceeded$/.test(reason) && reason !== 'storageQuotaExceeded') throw new DriveError('Google Drive is limiting requests right now. The file was not saved; try again in a minute.', 429);
      if (reason === 'storageQuotaExceeded') throw new DriveError(msg.full, 409);
      if (/accessNotConfigured|SERVICE_DISABLED/.test(reason + JSON.stringify((e.error || {}).details || ''))) throw new DriveError('The Google Drive API is not enabled in the Google Cloud project. Enable it (APIs & Services → Library → Google Drive API).', 502);
      if (r.status === 403) throw new DriveError(msg.denied, 409);
      throw new DriveError('Google Drive returned an error (HTTP ' + r.status + '). The file was not saved.', 502);
    }
  }
  /** A folder (in `parent`, or the Drive's top level) tagged with appProperties so the portal can find it again. */
  async function createFolder(name, { parent, tag } = {}) {
    const r = await write('POST', `${cfg.apiUrl}/files?${q({ fields: 'id,name' })}`, JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}), ...(tag ? { appProperties: { bhPortal: tag } } : {}) }), { 'Content-Type': 'application/json' });
    return r.json();
  }
  /** The file the portal uploaded with this tag (not in the Trash), or null: { id, name, webViewLink }. */
  async function findFile(tag) {
    const d = await call(`/files?${q({ q: `appProperties has { key='bhKey' and value='${tagValue(tag)}' } and trashed=false`, fields: 'files(id,name,webViewLink)', pageSize: '5',
      includeItemsFromAllDrives: 'true', ...(oauth ? {} : { corpora: 'allDrives' }) })}`);
    return (d.files || [])[0] || null;
  }
  /** The portal's own folder with this tag (not in the Trash), or null. */
  async function findFolder(tag) {
    const d = await call(`/files?${q({ q: `appProperties has { key='bhPortal' and value='${String(tag).replace(/[^\w-]/g, '')}' } and mimeType='${FOLDER}' and trashed=false`, fields: 'files(id,name)', pageSize: '5' })}`);
    return (d.files || [])[0] || null;
  }
  /** Uploads one file into a folder → { id, name, webViewLink }. asGoogleDoc: converts a .docx to a Google Doc. */
  /** tag: a key stored on the file (appProperties bhKey), so a retry can find it instead of uploading it again. */
  async function upload(buf, { name, mimeType, parent, asGoogleDoc, tag }) {
    const boundary = 'bh' + crypto.randomBytes(12).toString('hex');
    const meta = { name, parents: [parent], ...(asGoogleDoc ? { mimeType: 'application/vnd.google-apps.document' } : {}), ...(tag ? { appProperties: { bhKey: tagValue(tag) } } : {}) };
    // over 5 MB (deal files go up to 15 MB): Google's resumable upload, a session first, then the file in one PUT
    if (buf.length > 5 * 1024 * 1024) {
      const s = await write('POST', `${cfg.uploadUrl}/files?${q({ uploadType: 'resumable', fields: 'id,name,webViewLink' })}`, JSON.stringify(meta),
        { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(buf.length) });
      const at = s.headers.get('location');
      if (!at || !at.startsWith(cfg.uploadUrl + '/')) throw new DriveError('Google Drive did not start the upload. The file was not saved; try again.', 502);
      const r = await write('PUT', at, buf, { 'Content-Type': mimeType });
      return r.json();
    }
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--`)]);
    const r = await write('POST', `${cfg.uploadUrl}/files?${q({ uploadType: 'multipart', fields: 'id,name,webViewLink' })}`, body, { 'Content-Type': `multipart/related; boundary=${boundary}` });
    return r.json();
  }
  /** A Google Doc exported as PDF (Drive's own converter, as the Apps Script's getAs('application/pdf')). */
  async function exportPdf(id) {
    const r = await write('GET', `${cfg.apiUrl}/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: 'application/pdf' })}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.subarray(0, 5).toString() !== '%PDF-') throw new DriveError('Google Drive did not return a PDF.', 502);
    return b;
  }
  const remove = async (id) => { await write('DELETE', `${cfg.apiUrl}/files/${encodeURIComponent(id)}?${q({})}`); };
  return { ...out, upload, exportPdf, remove, createFolder, findFolder, findFile };
}
// appProperties values: letters, digits, - and _ only (they go into a Drive search query), at most 100 characters
const tagValue = (t) => String(t).replace(/[^\w-]/g, '').slice(0, 100);
const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
// My Drive storage: only the files and folders this app created (Google's "recommended", non-sensitive Drive scope)
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

module.exports = { createDrive, DriveError, SCOPE, WRITE_SCOPE, FILE_SCOPE };
