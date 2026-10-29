'use strict';
// Local fake Google (service-account token + Drive v3, read only) and a fake Anthropic Messages API, with fictional
// files, for browser checks and the local review server. Never contacts a real service.
const http = require('http');
const crypto = require('crypto');

const zlib = require('zlib');
/** A real (decodable) 160×120 PNG in one colour; n picks the colour, so each fake photo looks different. */
function PNG(n = 0) {
  const w = 160, h = 120, hues = [[47, 129, 247], [184, 137, 59], [63, 185, 80], [130, 80, 223], [227, 98, 9], [210, 153, 34]], [r, g, b] = hues[n % hues.length];
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((x, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

/** A service account key pair and its JSON key (fictional). */
function fakeServiceAccount(email = 'portal-review@blackhouse-demo.iam.gserviceaccount.com') {
  const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { email, publicKey: k.publicKey, json: JSON.stringify({ type: 'service_account', client_email: email, private_key: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
}

/** Drive files: a demo folder with photos, a floor plan, a brochure and a fact sheet. */
function demoDrive() {
  const F = 'application/vnd.google-apps.folder';
  return {
    DemoFolderAAAAAAAA: { name: 'Demo Bay Residences', mimeType: F },
    DemoCoverAAAAAAAAA: { name: 'Exterior.png', mimeType: 'image/png', parent: 'DemoFolderAAAAAAAA', body: PNG(1) },
    DemoLobbyAAAAAAAAA: { name: 'Lobby.png', mimeType: 'image/png', parent: 'DemoFolderAAAAAAAA', body: PNG(2) },
    DemoPlan1BRAAAAAAA: { name: '1BR floor plan.png', mimeType: 'image/png', parent: 'DemoFolderAAAAAAAA', body: PNG(3) },
    DemoBrochAAAAAAAAA: { name: 'Demo brochure.pdf', mimeType: 'application/pdf', parent: 'DemoFolderAAAAAAAA', body: PDF },
    DemoFactsAAAAAAAAA: { name: 'Fact sheet', mimeType: 'application/vnd.google-apps.document', parent: 'DemoFolderAAAAAAAA', text: 'Demo Bay Residences (fictional). RFO. 1BR 45 sqm from PHP 9M. Amenities: pool, gym.' },
  };
}

function createFakeGoogle(sa, files = demoDrive()) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (code, obj, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(Buffer.isBuffer(obj) || typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      calls.push({ method: req.method, path: u.pathname });
      if (u.pathname === '/token') {
        const [h, c, s] = String(new URLSearchParams(body).get('assertion')).split('.');
        return crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), sa.publicKey, Buffer.from(s, 'base64url')) ? send(200, { access_token: 'fake-drive-token', expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
      }
      if (req.method !== 'GET' || req.headers.authorization !== 'Bearer fake-drive-token') return send(401, { error: { code: 401, errors: [{ reason: 'authError' }] } });
      if (u.pathname === '/drive/v3/files') {
        const parent = (u.searchParams.get('q').match(/'([^']+)' in parents/) || [])[1];
        return send(200, { files: Object.entries(files).filter(([, f]) => f.parent === parent).map(([id, f]) => ({ id, name: f.name, mimeType: f.mimeType, size: String((f.body || '').length), capabilities: { canDownload: true } })) });
      }
      const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/), f = m && files[m[1]];
      if (!f) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
      if (m[2]) return send(200, f.text || '', 'text/plain');
      if (u.searchParams.get('alt') === 'media') return send(200, f.body || Buffer.alloc(0), 'application/octet-stream');
      send(200, { id: m[1], name: f.name, mimeType: f.mimeType, size: String((f.body || '').length), capabilities: { canDownload: true } });
    });
  });
  server.calls = calls;
  return server;
}

/** Answers every Messages request with fixed, fictional project facts as JSON text. */
function createFakeAi(found) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ path: req.url });
      const out = found || { developer: 'Demo Developer Inc.', tagline: 'Fictional bay-side living', description: 'Demo Bay Residences is a fictional project used for local review.\n\nAll facts here are made up.',
        status: 'RFO', turnover: '', priceFrom: 'PHP 9M', location: 'Pasay', map: 'Demo Bay Residences, Pasay', highlights: ['Bay views', 'Near the airport'], amenities: ['Pool', 'Gym'],
        units: [{ type: '1BR', bedrooms: '1', sizeSqm: '45', priceFrom: 'PHP 9M', notes: '' }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  server.calls = calls;
  return server;
}

module.exports = { fakeServiceAccount, createFakeGoogle, createFakeAi, demoDrive, PNG, PDF };
