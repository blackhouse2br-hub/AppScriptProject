'use strict';
// A local fake of Google's OAuth 2.0 (consent, token, keys, revoke) and of Drive v3 as seen with the drive.file scope
// (only files this app created), for "My Drive storage" (src/driveStore.js) in tests and the local review server.
// Fictional accounts and files; never contacts Google.
const http = require('http');
const crypto = require('crypto');

const FOLDER = 'application/vnd.google-apps.folder';
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * opts: { clientId, clientSecret, email }. The consent screen approves at once (server.decision: 'allow' | 'deny');
 * server.grantScope sets the scopes Google reports as granted (to test an unticked Drive box).
 */
function createFakeGoogleOAuth({ clientId, clientSecret, email = 'blackhouse.files@example.com' } = {}) {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), kid = 'fake-kid-1';
  const codes = new Map(), refresh = new Map(), access = new Map(), files = {}, issued = new Set();
  const calls = [];
  let n = 0;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (claims) => { const h = b64({ alg: 'RS256', typ: 'JWT', kid }) + '.' + b64(claims); return h + '.' + crypto.sign('RSA-SHA256', Buffer.from(h), keys.privateKey).toString('base64url'); };

  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks), body = raw.toString('utf8'), u = new URL(req.url, 'http://x');
      const send = (code, obj, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(Buffer.isBuffer(obj) || typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      calls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || '', body: /\/(token|revoke)$/.test(u.pathname) ? Object.fromEntries(new URLSearchParams(body)) : null });

      // ---- OAuth ----
      if (u.pathname === '/auth') {
        const q = u.searchParams, back = new URL(q.get('redirect_uri'));
        back.searchParams.set('state', q.get('state') || '');
        if (server.decision === 'deny') back.searchParams.set('error', 'access_denied');
        else { const code = 'fake-code-' + (++n); codes.set(code, { q: Object.fromEntries(q), at: Date.now() }); back.searchParams.set('code', code); }
        res.writeHead(302, { location: back.href }); return res.end();
      }
      if (u.pathname === '/certs') return send(200, { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] });
      if (u.pathname === '/token' && req.method === 'POST') {
        const p = Object.fromEntries(new URLSearchParams(body));
        if (p.client_id !== clientId || p.client_secret !== clientSecret) return send(401, { error: 'invalid_client' });
        if (p.grant_type === 'authorization_code') {
          const c = codes.get(p.code); codes.delete(p.code);
          if (!c || c.q.redirect_uri !== p.redirect_uri || c.q.client_id !== p.client_id) return send(400, { error: 'invalid_grant' });
          if (crypto.createHash('sha256').update(p.code_verifier || '').digest('base64url') !== c.q.code_challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
          const rt = 'fake-refresh-' + crypto.randomBytes(12).toString('hex'), at = 'fake-access-' + (++n);
          const who = server.email || email; refresh.set(rt, { email: who }); issued.add(rt); access.set(at, { rt, until: Date.now() + 3600e3 });
          const scope = server.grantScope || ['openid', 'https://www.googleapis.com/auth/userinfo.email', FILE_SCOPE].join(' ');
          const now = Math.floor(Date.now() / 1000);
          return send(200, { access_token: at, expires_in: 3599, scope, token_type: 'Bearer', ...(server.noRefresh ? {} : { refresh_token: rt }),
            id_token: idToken({ iss: 'https://accounts.google.com', aud: clientId, sub: 'fake-sub-' + who, email: who, email_verified: true, nonce: c.q.nonce, iat: now, exp: now + 3600 }) });
        }
        if (p.grant_type === 'refresh_token') {
          if (!refresh.has(p.refresh_token)) return send(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const at = 'fake-access-' + (++n); access.set(at, { rt: p.refresh_token, until: Date.now() + 3600e3 });
          return send(200, { access_token: at, expires_in: 3599, scope: FILE_SCOPE, token_type: 'Bearer' });
        }
        return send(400, { error: 'unsupported_grant_type' });
      }
      if (u.pathname === '/revoke' && req.method === 'POST') { const t = new URLSearchParams(body).get('token'); refresh.delete(t); for (const [k, v] of access) if (v.rt === t) access.delete(k); return send(200, {}); }

      // ---- Drive (drive.file: only this app's files) ----
      const tok = (req.headers.authorization || '').replace(/^Bearer /, ''), a = access.get(tok);
      if (!a || a.until < Date.now() || !refresh.has(a.rt)) return send(401, { error: { code: 401, errors: [{ reason: 'authError' }] } });
      if (u.pathname === '/drive/v3/files' && req.method === 'POST') {   // a folder (JSON metadata only)
        const meta = JSON.parse(body || '{}'), id = 'Fo' + crypto.randomBytes(8).toString('hex');
        if (meta.parents && !files[meta.parents[0]]) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
        files[id] = { name: meta.name, mimeType: meta.mimeType, parent: (meta.parents || [])[0] || 'root', appProperties: meta.appProperties || {} };
        return send(200, { id, name: meta.name });
      }
      if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
        const q = u.searchParams.get('q') || '', m = q.match(/key='(\w+)' and value='([\w-]+)'/);
        const list = Object.entries(files).filter(([, f]) => !f.trashed && (!m || (f.appProperties || {})[m[1]] === m[2]) && (!/mimeType='/.test(q) || f.mimeType === FOLDER));
        return send(200, { files: list.map(([id, f]) => ({ id, name: f.name, webViewLink: `https://drive.example.invalid/file/d/${id}/view` })) });
      }
      // resumable upload (files over 5 MB): a session, then the file in one PUT
      if (u.pathname === '/upload/drive/v3/files' && req.method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
        const meta = JSON.parse(body || '{}'), parent = (meta.parents || [])[0];
        if (!files[parent] || files[parent].mimeType !== FOLDER || files[parent].trashed) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
        const sid = 'sess' + crypto.randomBytes(6).toString('hex'); server.sessions[sid] = { meta, parent, type: req.headers['x-upload-content-type'] };
        res.writeHead(200, { location: `http://${req.headers.host}/upload/drive/v3/files?uploadType=resumable&upload_id=${sid}` }); return res.end();
      }
      if (u.pathname === '/upload/drive/v3/files' && req.method === 'PUT') {
        const sess = server.sessions[u.searchParams.get('upload_id')]; if (!sess) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
        const id = 'Up' + crypto.randomBytes(9).toString('hex');
        files[id] = { name: sess.meta.name, mimeType: sess.type, parent: sess.parent, body: raw, appProperties: sess.meta.appProperties || {} };
        server.uploads.push({ id, name: sess.meta.name, mimeType: sess.type, parent: sess.parent, size: raw.length, resumable: true });
        return send(200, { id, name: sess.meta.name, webViewLink: `https://drive.example.invalid/file/d/${id}/view` });
      }      if (u.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        const bnd = '--' + (req.headers['content-type'].match(/boundary=(\S+)/) || [])[1];
        const heads = [], parts = raw.toString('latin1').split(bnd).slice(1, -1).map((p) => { const i = p.indexOf('\r\n\r\n'); heads.push(p.slice(0, i)); return Buffer.from(p.slice(i + 4, -2), 'latin1'); });
        const meta = JSON.parse(parts[0].toString('utf8')), parent = (meta.parents || [])[0];
        if (!files[parent] || files[parent].mimeType !== FOLDER || files[parent].trashed) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
        const id = 'Up' + crypto.randomBytes(9).toString('hex');
        files[id] = { name: meta.name, mimeType: meta.mimeType || (heads[1].match(/Content-Type: ([^\r\n]+)/) || [, 'application/octet-stream'])[1], parent, body: parts[1], appProperties: meta.appProperties || {} };
        server.uploads.push({ id, name: meta.name, mimeType: files[id].mimeType, parent, size: parts[1].length });
        return send(200, { id, name: meta.name, webViewLink: `https://drive.example.invalid/file/d/${id}/view` });
      }
      const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/), f = m && files[m[1]];
      if (!f) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
      if (m[2]) return send(200, Buffer.from('%PDF-1.4\n% fake PDF of ' + f.name + '\n%%EOF'), 'application/pdf');
      if (req.method === 'DELETE') { delete files[m[1]]; return send(204, ''); }
      if (u.searchParams.get('alt') === 'media') return send(200, f.body || Buffer.alloc(0), 'application/octet-stream');
      return send(200, { id: m[1], name: f.name, mimeType: f.mimeType });
    });
  });
  Object.assign(server, { calls, files, uploads: [], sessions: {}, decision: 'allow', grantScope: '', noRefresh: false, email: '',   // email: the account chosen next
    /** Every access token expires now (the next Drive call must renew it with the refresh token). */
    expireAccess() { for (const v of access.values()) v.until = 0; },
    /** The account owner removes the app's access in their Google account. */
    revokeAll() { refresh.clear(); access.clear(); },
    refreshCount: () => calls.filter((c) => c.path === '/token' && c.body && c.body.grant_type === 'refresh_token').length,
    issuedRefreshTokens: () => [...issued],
  });
  return server;
}

module.exports = { createFakeGoogleOAuth, FILE_SCOPE };
