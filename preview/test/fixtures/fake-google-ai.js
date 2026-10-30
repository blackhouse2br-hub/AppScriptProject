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
    let body = ''; const chunks = []; req.on('data', (c) => { body += c; chunks.push(c); });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (code, obj, type) => { res.writeHead(code, { 'content-type': type || 'application/json' }); res.end(Buffer.isBuffer(obj) || typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      calls.push({ method: req.method, path: u.pathname });
      if (u.pathname === '/token') {
        const [h, c, s] = String(new URLSearchParams(body).get('assertion')).split('.');
        const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
        // the writer's token (scope drive) can write; the reader's (drive.readonly) can't
        return crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), sa.publicKey, Buffer.from(s, 'base64url')) ? send(200, { access_token: /drive\.readonly/.test(claims.scope) ? 'fake-drive-token' : 'fake-drive-write-token', expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
      }
      const auth = req.headers.authorization;
      if (auth === 'Bearer fake-drive-write-token' && req.method !== 'GET' || auth === 'Bearer fake-drive-write-token' && /\/export$/.test(u.pathname)) {
        // uploads (multipart: JSON metadata, then the file) into an existing folder; export of a converted Doc as PDF; delete
        if (req.method === 'POST' && u.pathname === '/upload/drive/v3/files') {
          const raw = Buffer.concat(chunks), bnd = '--' + (req.headers['content-type'].match(/boundary=(\S+)/) || [])[1];
          const heads = [], parts = raw.toString('latin1').split(bnd).slice(1, -1).map((p) => { const i = p.indexOf('\r\n\r\n'); heads.push(p.slice(0, i)); return Buffer.from(p.slice(i + 4, -2), 'latin1'); });
          const meta = JSON.parse(parts[0].toString('utf8')), parent = (meta.parents || [])[0];
          if (!files[parent] || files[parent].mimeType !== 'application/vnd.google-apps.folder') return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
          const id = 'Up' + crypto.randomBytes(9).toString('hex');
          files[id] = { name: meta.name, mimeType: meta.mimeType || (heads[1].match(/Content-Type: ([^\r\n]+)/) || [, 'application/octet-stream'])[1], parent, body: parts[1] };
          server.uploads.push({ id, name: meta.name, mimeType: files[id].mimeType, parent, size: parts[1].length });
          return send(200, { id, name: meta.name, webViewLink: `https://drive.example.invalid/file/d/${id}/view` });
        }
        const m2 = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/), f2 = m2 && files[m2[1]];
        if (!f2) return send(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
        if (m2[2]) return send(200, Buffer.from('%PDF-1.4\n% fake PDF of ' + f2.name + ' (' + f2.body.length + ' bytes of .docx)\n%%EOF'), 'application/pdf');
        if (req.method === 'DELETE') { delete files[m2[1]]; return send(204, ''); }
        return send(405, {});
      }
      if (req.method !== 'GET' || (auth !== 'Bearer fake-drive-token' && auth !== 'Bearer fake-drive-write-token')) return send(401, { error: { code: 401, errors: [{ reason: 'authError' }] } });
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
  server.calls = calls; server.uploads = []; server.files = files;
  return server;
}

/**
 * Answers every Messages request with fixed, fictional project facts as JSON text — or, for a Service Requests
 * classification (its JSON schema has "services"), with server.serviceAnswer(body) (default: the client is interested
 * in every offered service, with a summary that includes a phone number the portal must strip). Records each request.
 */
function createFakeAi(found) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null; try { parsed = JSON.parse(body); } catch (e) { /* not JSON */ }
      calls.push({ path: req.url, body: parsed });
      const fmt = parsed && parsed.output_config && parsed.output_config.format;
      if (fmt && fmt.schema && fmt.schema.properties && fmt.schema.properties.services) {
        const offered = (String(parsed.system).match(/services \(([^)]*)\)/) || [, ''])[1].split(', ').filter(Boolean);
        const ans = server.serviceAnswer ? server.serviceAnswer(parsed) : { services: offered.map((s) => ({ service: s, interest: 'interested', summary: 'Needs ' + s + ' next week, call 0917 555 0101',
          details: { date: 'next week', area: '', from: '', to: '', unit: '', items: '', issue: '', budget: '', notes: 'email me at fake.client@example.com' } })) };
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'msg_fake_svc', type: 'message', role: 'assistant', model: parsed.model, content: [{ type: 'text', text: JSON.stringify(ans) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      }
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
