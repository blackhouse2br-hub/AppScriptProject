'use strict';
// Project Pages end to end: an in-memory MongoDB, a fake Google (service-account token + Drive API) and a fake Anthropic
// API. No real Google, Drive, Anthropic or Monday service is contacted; every fake Drive request is recorded, so the
// tests also prove that ordinary editing makes no Drive requests and that Drive is only ever read.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, Project } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const PNG = (extra = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64 + extra, 1)]);
const PDF = Buffer.from('%PDF-1.4\nfake brochure\n%%EOF');
const sa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA_EMAIL = 'portal-test@blackhouse-test.iam.gserviceaccount.com';
const SA_JSON = JSON.stringify({ type: 'service_account', client_email: SA_EMAIL, private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }) });

// ---------- fake Google: token endpoint (checks the service-account JWT) + Drive v3 (read only) ----------
const FOLDER = 'application/vnd.google-apps.folder';
const DRIVE = {
  'FolderAAAAAAAAAAAA': { name: 'Azure Tower', mimeType: FOLDER },
  'Cover1AAAAAAAAAAAA': { name: 'Azure exterior.jpg', mimeType: 'image/png', parent: 'FolderAAAAAAAAAAAA', body: PNG() },
  'Plan2BRAAAAAAAAAAA': { name: '2BR floor plan.png', mimeType: 'image/png', parent: 'FolderAAAAAAAAAAAA', body: PNG(1) },
  'BrochAAAAAAAAAAAAA': { name: 'Azure brochure.pdf', mimeType: 'application/pdf', parent: 'FolderAAAAAAAAAAAA', body: PDF },
  'DocAAAAAAAAAAAAAAA': { name: 'Fact sheet', mimeType: 'application/vnd.google-apps.document', parent: 'FolderAAAAAAAAAAAA', text: 'Azure Tower by Found Developer. RFO. Amenities: pool, gym. 2BR 80 sqm from PHP 20M.' },
  'WordAAAAAAAAAAAAAA': { name: 'Old notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parent: 'FolderAAAAAAAAAAAA', body: Buffer.from('PK') },
  'FakeImgAAAAAAAAAAA': { name: 'not really.png', mimeType: 'image/png', parent: 'FolderAAAAAAAAAAAA', body: Buffer.from('<svg onload=alert(1)>') },
};
const driveCalls = [];
let tokenOk = true, apiDisabled = false;
const fakeGoogle = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), send = (code, obj, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(Buffer.isBuffer(obj) || typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    driveCalls.push({ method: req.method, path: u.pathname });
    if (u.pathname === '/token') {
      const p = new URLSearchParams(body), [h, c, s] = String(p.get('assertion')).split('.');
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      const ok = p.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), sa.publicKey, Buffer.from(s, 'base64url'))
        && claims.iss === SA_EMAIL && claims.scope === 'https://www.googleapis.com/auth/drive.readonly' && claims.exp - claims.iat <= 3600;
      return ok ? send(200, { access_token: tokenOk ? 'drive-token' : 'stale-token', expires_in: 3600, token_type: 'Bearer' }) : send(400, { error: 'invalid_grant' });
    }
    if (req.method !== 'GET') return send(405, { error: { code: 405, message: 'read only fake' } });
    if (req.headers.authorization !== 'Bearer drive-token') { tokenOk = true; return send(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }); }
    if (apiDisabled) return send(403, { error: { code: 403, message: 'Drive API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits' }] } });
    const notFound = () => send(404, { error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } });
    if (u.pathname === '/drive/v3/files') {
      const parent = (u.searchParams.get('q').match(/'([^']+)' in parents/) || [])[1];
      return send(200, { files: Object.entries(DRIVE).filter(([, f]) => f.parent === parent).map(([id, f]) => ({ id, name: f.name, mimeType: f.mimeType, size: String((f.body || '').length || 0), capabilities: { canDownload: true } })) });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/), f = m && DRIVE[m[1]];
    if (!f) return notFound();
    if (m[2]) return f.text ? send(200, f.text, 'text/plain') : send(400, { error: { code: 400, message: 'export only for Google Docs' } });
    if (u.searchParams.get('alt') === 'media') return f.body ? send(200, f.body, 'application/octet-stream') : send(403, { error: { code: 403, message: 'cannot download', errors: [{ reason: 'fileNotDownloadable' }] } });
    send(200, { id: m[1], name: f.name, mimeType: f.mimeType, size: String((f.body || '').length || 0), capabilities: { canDownload: true } });
  });
});
// ---------- fake Anthropic Messages API ----------
const aiCalls = [];
const fakeAi = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const b = JSON.parse(body || '{}'); aiCalls.push({ path: req.url, key: req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, ''), body: b });
    const found = { developer: 'Found Developer', tagline: 'Found tagline', description: 'Found description.', status: 'RFO', turnover: '', priceFrom: 'PHP 20M', location: 'Taguig', map: 'unknown',
      highlights: ['Bay views'], amenities: ['Pool', 'Gym'], units: [{ type: '2BR', bedrooms: '2', sizeSqm: '80', priceFrom: 'PHP 20M', notes: '' }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(found) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
  });
});

let mem, server, base, plain, plainServer;
const cookies = {};
async function call(b, method, url, { body, cookie, file, name } = {}) {
  const headers = {}; if (cookie) headers.cookie = cookie;
  if (file) { headers['content-type'] = 'application/octet-stream'; headers['x-file-name'] = encodeURIComponent(name || 'file'); } else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(b + url, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text: buf.toString(), buf, headers: res.headers };
}
async function login(who) {
  if (cookies[who]) return cookies[who];
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who);
  return (cookies[who] = r.headers.get('set-cookie').split(';')[0]);
}

test.before(async () => {
  await new Promise((r) => fakeGoogle.listen(0, '127.0.0.1', r)); await new Promise((r) => fakeAi.listen(0, '127.0.0.1', r));
  const g = `http://127.0.0.1:${fakeGoogle.address().port}`;
  mem = await MongoMemoryServer.create();
  const env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_pp'), PORT: '0' };
  ({ server } = await start({ ...env, GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: Buffer.from(SA_JSON).toString('base64'), GOOGLE_DRIVE_TOKEN_URL: g + '/token', GOOGLE_DRIVE_API_URL: g + '/drive/v3',
    ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeAi.address().port}` }, ARGV));
  base = `http://127.0.0.1:${server.address().port}`;
  // the same database without Drive or AI settings (the default for Railway today)
  const app2 = createApp(loadConfig(env, ARGV)); const s2 = await new Promise((r) => { const s = app2.listen(0, '127.0.0.1', () => r(s)); });
  plain = `http://127.0.0.1:${s2.address().port}`; plainServer = s2;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Boss', role: 'Manager', passwordHash },
    { email: 'viewer@example.com', name: 'Viewer VA', role: 'VA', vaLabel: 'Ana', modules: { pages: 'view' }, passwordHash },
    { email: 'editor@example.com', name: 'Editor VA', role: 'VA', vaLabel: 'Bea', modules: { pages: 'edit' }, passwordHash },
    { email: 'nopages@example.com', name: 'No Pages', role: 'Broker', modules: { leads: 'view' }, passwordHash }]);
});
test.after(async () => { server.close(); plainServer.close(); fakeGoogle.close(); fakeAi.close(); await mongoose.disconnect(); await mem.stop(); });

let pid;
test('permissions: Project Pages module view reads, edit changes, no access none; signed out nothing', async () => {
  assert.strictEqual((await call(base, 'GET', '/api/projects')).status, 401);
  const none = await login('nopages'), viewer = await login('viewer'), editor = await login('editor');
  assert.strictEqual((await call(base, 'GET', '/api/projects', { cookie: none })).status, 403);
  assert.strictEqual((await call(base, 'GET', '/api/projects', { cookie: viewer })).status, 200);
  assert.strictEqual((await call(base, 'POST', '/api/projects', { cookie: viewer, body: { name: 'X', developer: 'Y' } })).status, 403);
  assert.strictEqual((await call(base, 'POST', '/api/projects', { cookie: editor, body: { name: 'Only name' } })).status, 400, 'developer required');
  const c = await call(base, 'POST', '/api/projects', { cookie: editor, body: { name: 'Azure Tower', developer: '', location: 'Taguig' } });
  assert.strictEqual(c.status, 400);
  const ok = await call(base, 'POST', '/api/projects', { cookie: editor, body: { name: 'Azure Tower', developer: 'Megaworld', location: 'Taguig' } });
  assert.strictEqual(ok.status, 201); pid = ok.data.project.id;
  assert.strictEqual(ok.data.project.slug, 'azure-tower'); assert.strictEqual(ok.data.project.status, 'Pre-selling');
  const dup = await call(base, 'POST', '/api/projects', { cookie: editor, body: { name: 'Azure Tower', developer: 'Other' } });
  assert.match(dup.data.project.slug, /^azure-tower-[a-f0-9]{4}$/, 'a second page address');
  for (const [m, u, b] of [['PUT', '/api/projects/' + pid, { name: 'x', version: 1 }], ['DELETE', '/api/projects/' + pid], ['PUT', '/api/projects/' + pid + '/publish', { published: true }], ['PUT', '/api/project-settings', { inquiryHook: '' }]]) {
    assert.strictEqual((await call(base, m, u, { cookie: viewer, body: b })).status, 403, `viewer ${m} ${u}`);
  }
  assert.strictEqual((await call(base, 'POST', `/api/projects/${pid}/media`, { cookie: viewer, file: PNG(), name: 'a.png' })).status, 403);
});

test('details, units and lists save and reload; validation; a stale save is refused', async () => {
  const cookie = await login('boss');
  const full = { name: 'Azure Tower', developer: 'Megaworld', location: 'Taguig', status: 'RFO', turnover: '2027', priceFrom: 'PHP 12M', tagline: '<script>alert(1)</script> Bay living',
    description: 'First paragraph.\n\nSecond paragraph.', highlights: 'Bay views\nNear BGC\nBay views', amenities: ['Pool', ' Gym '], map: 'Azure Tower, Taguig', video: 'https://youtu.be/dQw4w9WgXcQ',
    pageUrl: 'https://blackhouse.ph/azure', driveLink: 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA', units: [{ type: '2BR', bedrooms: '2', sizeSqm: '80', priceFrom: 'PHP 20M', availability: '', notes: 'Corner' }], version: 1 };
  const s = await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: full });
  assert.strictEqual(s.status, 200, JSON.stringify(s.data));
  const p = (await call(base, 'GET', '/api/projects/' + pid, { cookie })).data.project;
  assert.deepStrictEqual([p.status, p.turnover, p.highlights, p.amenities, p.units[0].availability, p.units[0].notes, p.version], ['RFO', '2027', ['Bay views', 'Near BGC'], ['Pool', 'Gym'], 'Available', 'Corner', 2]);
  assert.strictEqual(p.description, 'First paragraph.\n\nSecond paragraph.');
  assert.strictEqual((await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { ...full, tagline: 'old tab' } })).status, 409, 'version 1 is stale');
  for (const [k, v] of [['video', 'https://vimeo.com/1'], ['pageUrl', 'javascript:alert(1)'], ['driveLink', 'https://evil.example/drive/folders/abcdefghijkl'], ['name', ''], ['units', [{ type: 'x', media: 'aaaaaaaaaaaaaaaaaaaaaaaa' }]], ['status', { $ne: 1 }], ['owner', 'me'], ['highlights', Array(31).fill('x').map((x, i) => x + i)]]) {
    assert.strictEqual((await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { ...full, [k]: v, version: 2 } })).status, 400, k);
  }
  const list = (await call(base, 'GET', '/api/projects', { cookie })).data;
  assert.ok(list.projects.some((x) => x.id === pid && x.developer === 'Megaworld' && x.units === 1));
  assert.strictEqual(list.drive.email, SA_EMAIL); assert.strictEqual(list.ai, true);
});

let photoId, planId, brochureId;
test('uploads: real type checked, stored in MongoDB (survive a restart), served safely; unsafe files refused', async () => {
  const cookie = await login('boss');
  const before = driveCalls.length;
  const up = async (buf, name) => call(base, 'POST', `/api/projects/${pid}/media`, { cookie, file: buf, name });
  const a = await up(PNG(), 'Lobby view.png'); assert.strictEqual(a.status, 201, JSON.stringify(a.data));
  assert.deepStrictEqual([a.data.media.type, a.data.media.kind, a.data.media.caption], ['image', 'photo', 'Lobby view']); photoId = a.data.media.id;
  const b = await up(PNG(2), 'Floor_plan_2BR.png'); assert.deepStrictEqual([b.data.media.kind, b.data.media.caption], ['floorplan', 'Floor plan — Floor plan 2BR']); planId = b.data.media.id;
  const c = await up(PDF, 'Azure e-brochure.pdf'); assert.deepStrictEqual([c.data.media.type, c.data.media.kind], ['pdf', 'brochure']); brochureId = c.data.media.id;
  for (const [buf, name] of [[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.png'], [Buffer.from('<html><script>alert(1)</script>'), 'page.html'], [Buffer.from('MZ\x90'), 'a.exe'], [Buffer.alloc(0), 'empty.png']]) {
    assert.strictEqual((await up(buf, name)).status, 400, name);
  }
  assert.strictEqual((await up(PNG(10 * 1024 * 1024), 'huge.png')).status, 400, 'images over 10 MB');
  const huge = await up(Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]), 'huge.pdf');
  assert.strictEqual(huge.status, 413, 'uploads over 25 MB stop at the body limit'); assert.match(huge.data.error, /too large/);
  // the file comes back with its checked type and safe headers
  const g = await call(base, 'GET', `/api/projects/${pid}/media/${photoId}`, { cookie });
  assert.strictEqual(g.status, 200); assert.strictEqual(g.headers.get('content-type'), 'image/png'); assert.ok(g.buf.equals(PNG()));
  assert.strictEqual(g.headers.get('x-content-type-options'), 'nosniff'); assert.match(g.headers.get('content-security-policy'), /sandbox/);
  assert.strictEqual((await call(base, 'GET', `/api/projects/${pid}/media/${photoId}`, { cookie: await login('nopages') })).status, 403);
  // a second server on the same database (a restart / redeploy) still has the files: nothing is kept on local disk
  assert.ok((await call(plain, 'GET', `/api/projects/${pid}/media/${planId}`, { cookie })).buf.equals(PNG(2)));
  assert.strictEqual(driveCalls.length, before, 'uploading makes no Google Drive requests');
});

test('a save from before a file change is refused (no stale file references); units and cover point at images; deleting a file clears them', async () => {
  const cookie = await login('boss');
  const p = (await call(base, 'GET', '/api/projects/' + pid, { cookie })).data.project;
  const late = await call(base, 'POST', `/api/projects/${pid}/media`, { cookie, file: PNG(3), name: 'Pool.png' });   // after the page loaded (e.g. another tab)
  const body = { cover: photoId, units: [{ ...p.units[0], media: planId }], media: [{ id: photoId, caption: 'Lobby', use: true }, { id: brochureId, kind: 'brochure', caption: 'E-brochure' }] };
  assert.strictEqual((await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { ...body, version: p.version } })).status, 409, 'the files changed since it was opened');
  const fresh = (await call(base, 'GET', '/api/projects/' + pid, { cookie })).data.project;
  const s = await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { ...body, version: fresh.version } });
  assert.strictEqual(s.status, 200, JSON.stringify(s.data));
  assert.ok(s.data.project.media.some((m) => m.id === late.data.media.id), 'the upload made meanwhile is kept');
  assert.strictEqual(s.data.project.media.find((m) => m.id === photoId).caption, 'Lobby');
  assert.strictEqual((await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { version: s.data.project.version, cover: brochureId } })).status, 400, 'a PDF can\'t be the cover');
  assert.strictEqual((await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { version: s.data.project.version, media: [{ id: '0123456789abcdef01234567', caption: 'x' }] } })).status, 400, 'only this project\'s files');
  const d = await call(base, 'DELETE', `/api/projects/${pid}/media/${late.data.media.id}`, { cookie });
  assert.strictEqual(d.status, 200);
  assert.strictEqual((await call(base, 'GET', `/api/projects/${pid}/media/${late.data.media.id}`, { cookie })).status, 404);
});

test('preview, form endpoint, publish: public page only when published, escaped, safe CSP; WordPress HTML', async () => {
  const cookie = await login('boss'), viewer = await login('viewer');
  const pv = await call(base, 'GET', `/api/projects/${pid}/preview`, { cookie: viewer });
  assert.strictEqual(pv.status, 200); assert.match(pv.headers.get('content-type'), /text\/html/);
  assert.ok(!pv.text.includes('<script>alert(1)</script>') && pv.text.includes('&lt;script&gt;alert(1)&lt;/script&gt; Bay living'), 'record text is escaped');
  assert.match(pv.text, /not published/); assert.match(pv.text, /inquiries for this project aren't open yet/); assert.ok(!/<form/.test(pv.text), 'no form without an endpoint');
  assert.match(pv.headers.get('content-security-policy'), /script-src 'self';/); assert.match(pv.headers.get('content-security-policy'), /connect-src 'self' https:\/\/script\.google\.com/);
  assert.ok(pv.text.includes(`/api/projects/${pid}/media/${photoId}`) && pv.text.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  // the form endpoint: only an Apps Script /exec link (the existing path to Website Inquiries)
  for (const v of ['https://evil.example/exec', 'https://script.google.com/macros/s/abc/edit', 'http://script.google.com/macros/s/AKfycbxTESTTEST/exec']) assert.strictEqual((await call(base, 'PUT', '/api/project-settings', { cookie, body: { inquiryHook: v } })).status, 400, v);
  const HOOK = 'https://script.google.com/macros/s/AKfycbxTESTTESTTEST/exec';
  assert.strictEqual((await call(base, 'PUT', '/api/project-settings', { cookie, body: { inquiryHook: HOOK } })).status, 200);
  const slug = (await Project.findById(pid)).slug;
  assert.strictEqual((await call(base, 'GET', '/p/' + slug)).status, 404, 'not published yet');
  assert.strictEqual((await call(base, 'GET', `/p/${slug}/media/${photoId}`)).status, 404);
  const emb = await call(base, 'GET', `/api/projects/${pid}/embed`, { cookie });
  assert.ok(emb.data.warnings.some((w) => /isn't published/.test(w))); assert.match(emb.data.html, /<script>/); assert.ok(emb.data.html.includes(`${base.replace('127.0.0.1', '127.0.0.1')}/p/${slug}/media/${photoId}`) || emb.data.html.includes(`/p/${slug}/media/${photoId}`));
  assert.strictEqual((await call(base, 'PUT', `/api/projects/${pid}/publish`, { cookie, body: { published: true } })).status, 200);
  const pub = await call(base, 'GET', '/p/' + slug);
  assert.strictEqual(pub.status, 200); assert.ok(pub.text.includes(`data-hook="${HOOK}"`) && /<form/.test(pub.text) && pub.text.includes('name="website"'), 'form with honeypot');
  assert.match(pub.text, /<script src="\/project-page\.js">/); assert.ok(!/<script>/.test(pub.text), 'no inline script on the hosted page');
  assert.strictEqual((await call(base, 'GET', `/p/${slug}/media/${photoId}`)).status, 200);
  // a file the page doesn't show (a PDF that isn't a brochure) isn't public, even on a published project
  const other = await call(base, 'POST', `/api/projects/${pid}/media`, { cookie, file: PDF, name: 'internal notes.pdf' });
  assert.strictEqual(other.data.media.kind, 'other');
  assert.strictEqual((await call(base, 'GET', `/p/${slug}/media/${other.data.media.id}`)).status, 404);
  // a file left off the page, or another project's file, isn't served publicly
  const p = (await call(base, 'GET', '/api/projects/' + pid, { cookie })).data.project;
  await call(base, 'PUT', '/api/projects/' + pid, { cookie, body: { version: p.version, media: [{ id: planId, use: false }] } });
  assert.strictEqual((await call(base, 'GET', `/p/${slug}/media/${planId}`)).status, 404);
  assert.strictEqual((await call(base, 'GET', '/p/no-such-project')).status, 404);
  assert.strictEqual((await call(base, 'GET', '/p/..%2Fapi')).status, 404);
  await call(base, 'PUT', `/api/projects/${pid}/publish`, { cookie, body: { published: false } });
  assert.strictEqual((await call(base, 'GET', '/p/' + slug)).status, 404, 'unpublished again');
  await call(base, 'PUT', `/api/projects/${pid}/publish`, { cookie, body: { published: true } });
});

test('without Drive settings: Drive actions say it isn\'t connected; everything else works and makes no Drive requests', async () => {
  const cookie = await login('boss'), before = driveCalls.length;
  const r = await call(plain, 'POST', '/api/projects/drive/files', { cookie, body: { link: 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA' } });
  assert.strictEqual(r.status, 409); assert.ok(r.data.driveOff);
  assert.strictEqual((await call(plain, 'POST', `/api/projects/${pid}/drive/build`, { cookie, body: { link: 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA' } })).status, 409);
  const list = (await call(plain, 'GET', '/api/projects', { cookie })).data;
  assert.strictEqual(list.drive, null); assert.strictEqual(list.ai, false);
  const c = await call(plain, 'POST', '/api/projects', { cookie, body: { name: 'No Drive Residences', developer: 'Ayala Land', driveLink: 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA' } });
  assert.strictEqual(c.status, 201, 'a Drive link can be kept without Drive access');
  assert.strictEqual((await call(plain, 'POST', `/api/projects/${c.data.project.id}/media`, { cookie, file: PNG(), name: 'a.png' })).status, 201);
  assert.strictEqual((await call(plain, 'GET', `/api/projects/${c.data.project.id}/preview`, { cookie })).status, 200);
  assert.strictEqual(driveCalls.length, before, 'no Google Drive requests at all');
});

test('Add from Drive: link checks, listing, import of chosen files (checked like uploads), clear errors', async () => {
  const cookie = await login('boss'), editor = await login('editor');
  const c = await call(base, 'POST', '/api/projects', { cookie, body: { name: 'Drive Add Test', developer: 'Megaworld' } }), id = c.data.project.id;
  for (const link of ['not a link', 'https://drive.evil.com/drive/folders/FolderAAAAAAAAAAAA', 'http://drive.google.com/drive/folders/FolderAAAAAAAAAAAA', 'https://drive.google.com/drive/my-drive']) {
    const r = await call(base, 'POST', '/api/projects/drive/files', { cookie, body: { link } });
    assert.strictEqual(r.status, 400, link); assert.match(r.data.error, /doesn't look like a Google Drive link/);
  }
  const missing = await call(base, 'POST', '/api/projects/drive/files', { cookie, body: { link: 'https://drive.google.com/drive/folders/NotSharedAAAAAAAAA' } });
  assert.strictEqual(missing.status, 404); assert.ok(missing.data.error.includes(SA_EMAIL), 'says whom to share it with');
  const ls = await call(base, 'POST', '/api/projects/drive/files', { cookie: editor, body: { link: 'https://drive.google.com/drive/u/0/folders/FolderAAAAAAAAAAAA?usp=sharing' } });
  assert.strictEqual(ls.status, 200);
  assert.deepStrictEqual(ls.data.files.filter((f) => f.importable).map((f) => f.name).sort(), ['2BR floor plan.png', 'Azure brochure.pdf', 'Azure exterior.jpg', 'not really.png']);
  const im = await call(base, 'POST', `/api/projects/${id}/drive/import`, { cookie, body: { ids: ['Cover1AAAAAAAAAAAA', 'FakeImgAAAAAAAAAAA', 'DocAAAAAAAAAAAAAAA'] } });
  assert.strictEqual(im.status, 200, JSON.stringify(im.data));
  assert.deepStrictEqual(im.data.added.map((m) => [m.name, m.from, m.driveId]), [['Azure exterior.jpg', 'drive', 'Cover1AAAAAAAAAAAA']]);
  assert.deepStrictEqual(im.data.skipped.map((s) => s.name).sort(), ['Fact sheet', 'not really.png'], 'a fake image and a Google Doc are not imported');
  const again = await call(base, 'POST', `/api/projects/${id}/drive/import`, { cookie, body: { ids: ['Cover1AAAAAAAAAAAA'] } });
  assert.deepStrictEqual(again.data.skipped, [{ name: 'Azure exterior.jpg', why: 'already added' }]);
  assert.strictEqual((await call(base, 'POST', `/api/projects/${id}/drive/import`, { cookie, body: { ids: ['../../etc'] } })).status, 400);
  // an expired token is renewed once; a disabled Drive API is explained
  tokenOk = false;
  assert.strictEqual((await call(base, 'POST', '/api/projects/drive/files', { cookie, body: { link: 'FolderAAAAAAAAAAAA' } })).status, 200);
  apiDisabled = true;
  const off = await call(base, 'POST', '/api/projects/drive/files', { cookie, body: { link: 'FolderAAAAAAAAAAAA' } });
  apiDisabled = false;
  assert.strictEqual(off.status, 502); assert.match(off.data.error, /Google Drive API is not enabled/);
  assert.ok(driveCalls.every((x) => x.method === 'GET' || x.path === '/token'), 'Drive is only ever read');
});

test('Build from Google Drive: media added, documents read, only empty fields proposed, nothing overwritten or saved', async () => {
  const cookie = await login('boss');
  const c = await call(base, 'POST', '/api/projects', { cookie, body: { name: 'Azure North', developer: 'Megaworld', location: '' } }), id = c.data.project.id;
  // fields typed by hand before the build
  await call(base, 'PUT', '/api/projects/' + id, { cookie, body: { version: 1, tagline: 'Manual tagline', status: 'Pre-selling' } });
  const nAi = aiCalls.length;
  const r = await call(base, 'POST', `/api/projects/${id}/drive/build`, { cookie, body: { link: 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.deepStrictEqual(r.data.added.map((m) => m.kind).sort(), ['brochure', 'floorplan', 'photo']);
  const pc = r.data.proposal.find((x) => x.field === 'cover');
  assert.deepStrictEqual([pc.value, pc.apply], [r.data.added.find((m) => m.name === 'Azure exterior.jpg').id, true], 'cover proposed (it was empty), not the floor plan');
  assert.strictEqual(r.data.project.cover, '', 'not saved by the build');
  assert.ok(r.data.skipped.some((s) => s.name === 'Old notes.docx' && /Word/.test(s.why)));
  assert.strictEqual(r.data.docsRead, 2, 'the Google Doc and the PDF');
  const sent = aiCalls[nAi].body;
  assert.strictEqual(aiCalls.length, nAi + 1); assert.strictEqual(sent.model, 'claude-opus-5-5'); assert.strictEqual(aiCalls[nAi].key, 'sk-ant-test');
  assert.strictEqual(sent.output_config.format.type, 'json_schema');
  assert.ok(sent.messages[0].content.some((b) => b.type === 'document' && b.source.media_type === 'application/pdf'));
  assert.ok(sent.messages[0].content.some((b) => b.type === 'text' && /Found Developer/.test(b.text)));
  const prop = Object.fromEntries(r.data.proposal.map((x) => [x.field, x]));
  assert.deepStrictEqual([prop.description.apply, prop.location.apply, prop.priceFrom.apply], [true, true, true], 'empty fields are proposed');
  assert.deepStrictEqual([prop.tagline.apply, prop.tagline.current, prop.status.apply], [false, 'Manual tagline', false], 'typed fields are only offered, not ticked');
  assert.deepStrictEqual([prop.developer.apply, prop.developer.current], [false, 'Megaworld'], 'a different developer is only offered, never ticked');
  assert.ok(!prop.turnover && !prop.map, 'blank or "unknown" values are never proposed');
  assert.strictEqual(prop.units.value[0].media, r.data.added.find((m) => m.kind === 'floorplan').id, 'the 2BR unit gets the 2BR floor plan');
  const saved = (await call(base, 'GET', '/api/projects/' + id, { cookie })).data.project;
  assert.deepStrictEqual([saved.tagline, saved.description, saved.units.length], ['Manual tagline', '', 0], 'nothing is saved until the person saves');
  assert.strictEqual(saved.driveLink, '', 'the Drive link is proposed, not saved');
  assert.strictEqual(prop.driveLink.value, 'https://drive.google.com/drive/folders/FolderAAAAAAAAAAAA');
});

test('shared rules: Drive links, YouTube links, form endpoint, the proposal merge', () => {
  assert.deepStrictEqual(SH.parseDriveLink('https://drive.google.com/file/d/1AbCdEfGhIjK/view?resourcekey=0-xyz'), { id: '1AbCdEfGhIjK', resourceKey: '0-xyz' });
  assert.strictEqual(SH.parseDriveLink('https://docs.google.com/document/d/1AbCdEfGhIjKlm/edit').id, '1AbCdEfGhIjKlm');
  assert.strictEqual(SH.parseDriveLink('https://drive.google.com/open?id=1AbCdEfGhIjK').id, '1AbCdEfGhIjK');
  assert.strictEqual(SH.parseDriveLink('https://drive.google.com.evil.com/file/d/1AbCdEfGhIjK'), null);
  assert.strictEqual(SH.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'dQw4w9WgXcQ'); assert.strictEqual(SH.youtubeId('https://youtube.com.evil.com/watch?v=x'), '');
  assert.ok(SH.validHook('') && !SH.validHook('https://script.google.com/macros/s/x/exec?evil=1'));
  const pr = SH.driveProposal({ tagline: 'Mine', highlights: ['Kept'], units: [] }, { tagline: 'Theirs', description: '  ', highlights: ['New'], status: 'N/A', units: [{ type: 'Studio' }] });
  assert.deepStrictEqual(pr.map((x) => [x.field, x.apply]), [['tagline', false], ['highlights', false], ['units', true]]);
});

test('pre-deploy fixes: PDFs download, the preview form is never connected, test-only overrides refused on a public host', async () => {
  const cookie = await login('boss');
  const pdf = await call(base, 'GET', `/api/projects/${pid}/media/${brochureId}`, { cookie });
  assert.strictEqual(pdf.status, 200); assert.match(pdf.headers.get('content-disposition'), /^attachment;/);
  assert.match((await call(base, 'GET', `/api/projects/${pid}/media/${photoId}`, { cookie })).headers.get('content-disposition'), /^inline;/);
  const pv = await call(base, 'GET', `/api/projects/${pid}/preview`, { cookie });
  assert.match(pv.text, /<form/); assert.ok(!/data-hook=/.test(pv.text), 'no endpoint on the preview'); assert.match(pv.text, /type="submit" disabled/);
  const env = { APP_MODE: 'mongo', MONGODB_URI: 'mongodb+srv://u:p@x/db', HOST: '0.0.0.0', PUBLIC_API_URL: 'https://example.up.railway.app', AUTH_PROVIDER: 'google', GOOGLE_CLIENT_ID: '1-x.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 's' };
  assert.doesNotThrow(() => loadConfig(env, ARGV));
  for (const k of ['ANTHROPIC_BASE_URL', 'GOOGLE_DRIVE_API_URL', 'GOOGLE_DRIVE_TOKEN_URL']) assert.throws(() => loadConfig({ ...env, [k]: 'http://127.0.0.1:9' }, ARGV), /local tests only/, k);
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production' }, ARGV), /Production start is still blocked/);
});
