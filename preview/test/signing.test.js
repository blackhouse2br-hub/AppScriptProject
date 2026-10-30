'use strict';
// LOI e-signature and deal files end to end, with fakes only: an in-memory MongoDB, the fake Monday board, a fake Google
// Drive (writer service account; uploads, Doc → PDF export, delete), a fake SMTP server, a fake Gotenberg and the fake
// respond.io. A made-up LOI template; nothing real is sent, signed or stored.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, Loi, LoiSignLink, DealFile } = require('../src/models');
const { hashPassword } = require('../src/auth');
const docx = require('../src/docx');
const { createConverter } = require('../src/pdfConvert');
const { checkSignaturePng } = require('../src/loiSign');
const fx = require('./fixtures/fake-integrations');
const { fakeServiceAccount, createFakeGoogle, PNG } = require('./fixtures/fake-google-ai');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const FOLDER = 'application/vnd.google-apps.folder';
const P = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const ROW = (a) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc><w:p/></w:tc></w:tr>`;
const TEMPLATE = docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>') },
  { name: 'word/document.xml', data: Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${P('Date: _______________')}${P('RE: LETTER OF INTENT TO LEASE')}<w:tbl>${ROW('Lessor')}${ROW('Lessee')}${ROW('Monthly Rental')}</w:tbl>`
    + `${P('_______________________________')}${P('Print Name &amp; Signature')}${P('_______________________________')}${P('LESSOR')}<w:sectPr/></w:body></w:document>`) }]);
const FIELDS = { DATE: 'October 30, 2026', TO_1: 'Owner A', TO_2: 'Fake Tower', TO_3: 'Makati', DEAR: 'Owner A', CLIENT: 'Test Client One', BROKER_SIGN: 'Ely Santos', PROPERTY: 'Fake Tower, Makati', LEASE_TERM: 'One (1) year',
  MONTHLY_RENT: '₱180,000', ADVANCE: 'One (1) month', DEPOSIT: 'Two (2) months', CONCESSIONS: '', COMM_PCT: '3' };
const sigUrl = (n = 0) => 'data:image/png;base64,' + PNG(n).toString('base64');

// a fake SMTP server (plain, local): records each message
const mails = [];
const smtp = net.createServer((s) => {
  let data = false, buf = '', msg = '';
  s.write('220 fake-smtp ready\r\n');
  s.on('data', (d) => {
    buf += d.toString();
    if (data) { const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return; msg = buf.slice(0, i); buf = buf.slice(i + 5); data = false; mails.push(msg); s.write('250 queued\r\n'); }
    let j; while (!data && (j = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, j); buf = buf.slice(j + 2);
      if (/^EHLO/.test(line)) s.write('250-fake\r\n250 AUTH LOGIN\r\n'); else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
      else if (/^MAIL|^RCPT/.test(line)) s.write('250 ok\r\n'); else if (line === 'DATA') { data = true; s.write('354 go\r\n'); if (buf.includes('\r\n.\r\n')) s.emit('data', Buffer.alloc(0)); }
      else if (line === 'QUIT') { s.end('221 bye\r\n'); } else s.write(/^[A-Za-z0-9+/=]+$/.test(line) && !/235/.test(line) ? (s.authStep = (s.authStep || 0) + 1) === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n' : '500 ?\r\n');
    }
  });
});

let fake, google, sa, mem, server, base, offServer, offBase, nodriveServer, nodriveBase;
const cookies = {};
async function call(b, method, url, { body, cookie, file, raw } = {}) {
  const headers = { ...(cookie ? { cookie } : {}) };
  if (file) headers['content-type'] = 'application/octet-stream'; else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(b + url, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (e) { /* not JSON */ }
  return { status: res.status, data, buf, text: buf.toString(), headers: res.headers };
}
async function login(who, b = base) {
  const k = who + b; if (cookies[k]) return cookies[k];
  const r = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who); return (cookies[k] = r.headers.get('set-cookie').split(';')[0]);
}
const pathOf = (link) => new URL(link).pathname;
const nonceOf = (html) => (html.match(/data-nonce="([^"]+)"/) || [])[1];

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  sa = fakeServiceAccount('portal-writer@blackhouse-demo.iam.gserviceaccount.com');
  google = createFakeGoogle(sa, { LoiFolderAAAAAAAAAAA: { name: 'Blackhouse LOIs (fake)', mimeType: FOLDER }, DealsFolderAAAAAAAAA: { name: 'Deals (fake)', mimeType: FOLDER } });
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  const f = `http://127.0.0.1:${fake.address().port}`, g = `http://127.0.0.1:${google.address().port}`;
  const env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_sign'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond',
    GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON: sa.json, GOOGLE_DRIVE_API_URL: g + '/drive/v3', GOOGLE_DRIVE_UPLOAD_URL: g + '/upload/drive/v3', GOOGLE_DRIVE_TOKEN_URL: g + '/token',
    GOOGLE_DRIVE_LOI_FOLDER_ID: 'LoiFolderAAAAAAAAAAA', GOOGLE_DRIVE_DEALS_FOLDER_ID: 'DealsFolderAAAAAAAAA', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_SECURE: 'off', SMTP_USER: 'fake', SMTP_PASS: 'fake-pass', SMTP_FROM: 'Blackhouse <loi@example.com>' };
  ({ server } = await start(env, ARGV)); base = `http://127.0.0.1:${server.address().port}`;
  const mk = async (e) => { const a = createApp(loadConfig(e, ARGV)); const s = await new Promise((r) => { const x = a.listen(0, '127.0.0.1', () => r(x)); }); return [s, `http://127.0.0.1:${s.address().port}`]; };
  [offServer, offBase] = await mk({ ...env, LOI_SIGNING: '' });                                   // signing switched off
  [nodriveServer, nodriveBase] = await mk({ ...env, GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON: '', GOOGLE_DRIVE_DEALS_FOLDER_ID: '' });   // no Drive
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit' }, passwordHash },
    { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: 'bea@example.com', name: 'Bea Agent', role: 'VA', vaLabel: 'Bea', modules: { leads: 'edit' }, passwordHash }]);
  const boss = await login('boss');
  assert.strictEqual((await call(base, 'POST', '/api/loi/templates/lease', { cookie: boss, file: TEMPLATE })).status, 201);
});
test.after(async () => { [server, offServer, nodriveServer, fake, google, smtp].forEach((s) => { s.close(); if (s.closeAllConnections) s.closeAllConnections(); }); await mongoose.disconnect(); await mem.stop(); });

test('the signature image is checked: PNG only, real chunks, bounded size and dimensions', () => {
  assert.strictEqual(checkSignaturePng(sigUrl()).width, 160);
  for (const bad of ['', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,' + Buffer.from('not a png at all, just some text here!!!!!!!!!!!!!!!!!!!!!!!!!').toString('base64'),
    'data:image/png;base64,' + Buffer.concat([PNG().subarray(0, 40), Buffer.from('xxxx'), PNG().subarray(44)]).toString('base64')]) assert.throws(() => checkSignaturePng(bad), /could not be read/);
});

test('LOI signing: off unless set up; one-use, expiring link; client then owner; PDF; Drive; deal files; nothing real', async () => {
  const boss = await login('boss');
  const made = await call(base, 'POST', '/api/loi/monday/9001', { cookie: boss, body: { slot: 'lease', fields: FIELDS, unitKey: '6001', unitName: 'Fake Tower, Makati' } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.data));
  const id = made.data.loi.id, url = `/api/loi/monday/9001/${id}`;
  // switched off / not configured: refused, with what is needed
  const off = await call(offBase, 'POST', url + '/send', { cookie: await login('boss', offBase), body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(off.status, 409); assert.ok(off.data.needs.some((n) => /LOI_SIGNING/.test(n)));
  const nod = await call(nodriveBase, 'POST', url + '/send', { cookie: await login('boss', nodriveBase), body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(nod.status, 409); assert.ok(nod.data.needs.some((n) => /GOOGLE_DRIVE_WRITER/.test(n)));
  // checks before anything is created
  assert.strictEqual((await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'client', channel: 'link' } })).status, 400, 'confirmation needed');
  assert.strictEqual((await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'owner', channel: 'link', confirm: true } })).status, 409, 'the client signs first');
  assert.strictEqual((await call(base, 'POST', url + '/send', { cookie: await login('viewer'), body: { role: 'client', channel: 'link', confirm: true } })).status, 403);
  assert.strictEqual((await call(base, 'POST', url + '/send', { cookie: await login('bea'), body: { role: 'client', channel: 'link', confirm: true } })).status, 404, 'not Bea\'s client');
  const before = fx.calls.respond.filter((c) => c.method === 'POST').length;
  const rio = await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'client', channel: 'respond', confirm: true } });
  assert.strictEqual(rio.status, 409); assert.match(rio.data.error, /RESPOND_SENDS/);
  assert.strictEqual(fx.calls.respond.filter((c) => c.method === 'POST').length, before, 'nothing sent to respond.io');
  // a link to copy (the Apps Script's text, with the link)
  const sent = await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(sent.status, 201, JSON.stringify(sent.data));
  assert.match(sent.data.text, /^Hi Test! Here is your Letter of Intent for Fake Tower, Makati\. Please review it and sign it online here:\n/);
  const token = pathOf(sent.data.link).split('/')[2];
  assert.strictEqual(token.length, 43);
  const stored = await LoiSignLink.find().lean();
  assert.ok(stored.length === 1 && !JSON.stringify(stored).includes(token), 'only a hash of the link is stored');
  assert.ok(google.uploads.some((u) => /^\(temporary\)/.test(u.name) && u.mimeType === 'application/vnd.google-apps.document'), 'the PDF was made by Drive\'s converter');
  assert.ok(!google.files[google.uploads.find((u) => /^\(temporary\)/.test(u.name)).id], 'and the temporary Doc deleted');
  // the page: strict headers, the document text, a PDF, the page key
  const pg = await call(base, 'GET', pathOf(sent.data.link));
  assert.strictEqual(pg.status, 200);
  assert.match(pg.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
  assert.strictEqual(pg.headers.get('cache-control'), 'no-store'); assert.strictEqual(pg.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(pg.text.includes('Test Client One') && pg.text.includes('Open the PDF') && !pg.headers.get('set-cookie'));
  const pdf = await call(base, 'GET', pathOf(sent.data.link) + '/pdf');
  assert.strictEqual(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const nonce = nonceOf(pg.text);
  const post = (body) => call(base, 'POST', pathOf(sent.data.link), { body });
  assert.match((await post({ name: 'Test Client One', agree: true, signature: sigUrl(), nonce: 'wrong' + nonce.slice(5) })).data.error, /out of date/);
  assert.match((await post({ name: 'Test Client One', agree: false, signature: sigUrl(), nonce })).data.error, /Tick the box/);
  assert.match((await post({ name: 'Test Client One', agree: true, signature: 'data:image/png;base64,AAAA', nonce })).data.error, /could not be read/);
  assert.strictEqual((await LoiSignLink.findOne().lean()).failedAttempts, 3);
  const ok = await post({ name: 'Test Client One', agree: true, signature: sigUrl(), nonce });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
  // one use only: replay refused, page says signed
  assert.strictEqual((await post({ name: 'Test Client One', agree: true, signature: sigUrl(), nonce })).status, 409);
  assert.match((await call(base, 'GET', pathOf(sent.data.link))).text, /already been signed/);
  // the signed copy: signature image + the Apps Script's stamp; in Drive (.docx + .pdf) and the unit's deal files
  let x = await Loi.findById(id).lean();
  assert.strictEqual(x.status, 'clientSigned');
  const signed = Buffer.from(x.signedData.buffer), parts = docx.unzip(signed);
  assert.ok(parts.some((p) => /^word\/media\/bhsig1\.png$/.test(p.name)));
  assert.ok(docx.docText(signed).some((t) => /^Signed electronically by Test Client One on .* \(Manila time\) via the Blackhouse signing link\.$/.test(t)));
  assert.ok(/r:embed="rIdBhSig1"/.test(parts.find((p) => p.name === 'word/document.xml').data.toString()) && /rIdBhSig1/.test(parts.find((p) => p.name === 'word/_rels/document.xml.rels').data.toString()));
  assert.ok(google.uploads.some((u) => /SIGNED by client\.docx$/.test(u.name) && u.parent === 'LoiFolderAAAAAAAAAAA') && google.uploads.some((u) => /SIGNED by client\.pdf$/.test(u.name)));
  let deal = await DealFile.findOne({ leadId: '9001', unitKey: '6001' }).lean();
  assert.deepStrictEqual([deal.slots.clientLoi.src, deal.slots.clientLoi.type, deal.slots.ownerLoi], ['esign', 'application/pdf', null]);
  const dl = await call(base, 'GET', url + '/signed?fmt=pdf', { cookie: boss });
  assert.strictEqual(dl.buf.subarray(0, 5).toString(), '%PDF-');
  // the owner: emailed (fake SMTP) with the PDF; a second link replaces the first; an expired link is refused
  const first = await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'owner', channel: 'link', confirm: true } });
  const owner = await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'owner', channel: 'email', to: 'owner.a@example.com', confirm: true } });
  assert.strictEqual(owner.status, 201, JSON.stringify(owner.data));
  assert.match((await call(base, 'GET', pathOf(first.data.link))).text, /replaced by a newer one/);
  const mail = mails[mails.length - 1];
  assert.match(mail, /To: <owner\.a@example\.com>/); assert.match(mail, /Subject: =\?UTF-8\?B\?/);
  assert.match(Buffer.from((mail.split('Content-Transfer-Encoding: base64\r\n\r\n')[1] || '').split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString(), /our client has signed a Letter of Intent/);
  assert.match(mail, /Content-Type: application\/pdf; name="Letter of Intent\.pdf"/);
  const links = (await call(base, 'GET', url + '/links', { cookie: boss })).data.links;
  assert.deepStrictEqual(links.map((l) => [l.role, l.state, l.channel]).slice(0, 3), [['owner', 'open', 'email'], ['owner', 'replaced', 'link'], ['client', 'signed', 'link']]);
  const ownerPath = pathOf(owner.data.link);
  await LoiSignLink.updateOne({ role: 'owner', usedAt: null, revokedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.match((await call(base, 'GET', ownerPath)).text, /expired/);
  await LoiSignLink.updateOne({ role: 'owner', usedAt: null, revokedAt: null }, { $set: { expiresAt: new Date(Date.now() + 864e5) } });
  const opg = await call(base, 'GET', ownerPath);
  const oSign = await call(base, 'POST', ownerPath, { body: { name: 'Owner A', agree: true, signature: sigUrl(3), nonce: nonceOf(opg.text) } });
  assert.strictEqual(oSign.status, 200, JSON.stringify(oSign.data));
  x = await Loi.findById(id).lean();
  const both = Buffer.from(x.signedData.buffer);
  assert.strictEqual(x.status, 'signed');
  assert.ok(docx.unzip(both).some((p) => p.name === 'word/media/bhsig2.png'), 'owner signature added to the client-signed copy');
  assert.ok(docx.docText(both).some((t) => /^Owner signed electronically: Owner A on /.test(t)) && docx.docText(both).some((t) => /^Signed electronically by Test Client One/.test(t)));
  deal = await DealFile.findOne({ leadId: '9001', unitKey: '6001' }).lean();
  assert.strictEqual(deal.slots.ownerLoi.src, 'esign');
  assert.strictEqual((await call(base, 'POST', url + '/send', { cookie: boss, body: { role: 'owner', channel: 'link', confirm: true } })).status, 409, 'already signed');
  // a token that was never issued
  assert.strictEqual((await call(base, 'GET', '/sign/' + 'A'.repeat(43))).status, 404);
  // a used link reset by accident (e.g. a failure after signing) still can't sign twice: the LOI says it's signed
  await LoiSignLink.updateMany({ role: 'client' }, { $set: { usedAt: null } });
  assert.match((await call(base, 'GET', pathOf(sent.data.link))).text, /already been signed/);
  assert.strictEqual((await post({ name: 'Test Client One', agree: true, signature: sigUrl(), nonce })).status, 409);
  // an LOI's unit must be one of the client's own Calendar items / viewings (6002 is another client's)
  assert.match((await call(base, 'POST', '/api/loi/monday/9001', { cookie: boss, body: { slot: 'lease', fields: FIELDS, unitKey: '6002' } })).data.error, /isn't one of this client's/);
});

test('Gotenberg converter (fake): a .docx in, a PDF out; failures reported', async () => {
  const got = http.createServer((req, res) => { let n = 0; req.on('data', (c) => { n += c.length; }); req.on('end', () => {
    if (req.url !== '/forms/libreoffice/convert' || !/multipart\/form-data/.test(req.headers['content-type'])) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.7 fake (' + n + ' bytes in)'); }); });
  await new Promise((r) => got.listen(0, '127.0.0.1', r));
  const c = createConverter({ pdf: 'gotenberg', gotenbergUrl: `http://127.0.0.1:${got.address().port}` }, null);
  assert.strictEqual((await c.convert(TEMPLATE, 'x')).subarray(0, 5).toString(), '%PDF-');
  const broken = createConverter({ pdf: 'gotenberg', gotenbergUrl: `http://127.0.0.1:${got.address().port}/nope` }, null);
  await assert.rejects(() => broken.convert(TEMPLATE, 'x'), /PDF converter failed/);
  got.close();
  assert.strictEqual(createConverter({ pdf: 'none' }, null), null);
  assert.throws(() => loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1/x', LOI_PDF_CONVERTER: 'word' }, ARGV), /LOI_PDF_CONVERTER/);
  assert.throws(() => loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1/x', HOST: '0.0.0.0', PUBLIC_API_URL: 'https://example.up.railway.app', AUTH_PROVIDER: 'google', GOOGLE_CLIENT_ID: '1-x.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 's', GOOGLE_DRIVE_UPLOAD_URL: 'http://127.0.0.1:1' }, ARGV), /local tests only/);
});

test('deal files: uploads checked by content, to the unit of this client, into Drive; term, renewal, remove, download, permissions', async () => {
  const boss = await login('boss'), u = '/api/deals/monday/9001/6001';
  const pdf = Buffer.from('%PDF-1.4\n% a made-up signed contract\n%%EOF');
  // not set up: a clear setup state
  const ns = await call(nodriveBase, 'POST', u + '/contract', { cookie: await login('boss', nodriveBase), file: pdf });
  assert.strictEqual(ns.status, 503, JSON.stringify(ns.data)); assert.strictEqual(ns.data.needs.length, 2, JSON.stringify(ns.data));
  assert.deepStrictEqual((await call(nodriveBase, 'GET', '/api/deals/monday/9001', { cookie: await login('boss', nodriveBase) })).data.setup.ready, false);
  // checks
  assert.match((await call(base, 'POST', u + '/contract', { cookie: boss, file: Buffer.from('MZ fake executable ...........') })).data.error, /Only PDF, JPEG/);
  assert.strictEqual((await call(base, 'POST', u + '/contract?start=2026-11-01&months=0', { cookie: boss, file: pdf })).status, 400);
  assert.strictEqual((await call(base, 'POST', '/api/deals/monday/9001/6002/contract', { cookie: boss, file: pdf })).status, 404, 'a Calendar item of another client');
  assert.strictEqual((await call(base, 'POST', '/api/deals/monday/9003/6002/contract', { cookie: await login('ana'), file: pdf })).status, 404, 'not Ana\'s client');
  assert.strictEqual((await call(base, 'POST', u + '/contract', { cookie: await login('viewer'), file: pdf })).status, 403);
  assert.strictEqual((await call(base, 'POST', u + '/contract', { cookie: boss, file: Buffer.concat([pdf, Buffer.alloc(15 * 1024 * 1024)]) })).status, 413);
  // the contract with the lease term (Code.gs dealTerm_), the deposit slip (a PNG), then a renewal
  const c = await call(base, 'POST', u + '/contract?start=2026-11-01&months=12', { cookie: boss, file: pdf });
  assert.strictEqual(c.status, 201, JSON.stringify(c.data));
  assert.deepStrictEqual(c.data.record.term, { start: '2026-11-01', months: 12, end: '2027-10-31', renewFrom: '2027-09-01' });
  assert.match(c.data.record.slots.contract.name, /^Signed contract \(both parties\) – Test Client One – Fake Tower, Makati\.pdf$/);
  assert.ok(google.uploads.some((x) => x.parent === 'DealsFolderAAAAAAAAA' && x.mimeType === 'application/pdf'));
  assert.strictEqual((await call(base, 'POST', u + '/contract', { cookie: boss, file: pdf })).status, 409, 'remove before replacing');
  const dep = await call(base, 'POST', u + '/deposit', { cookie: boss, file: PNG(4) });
  assert.strictEqual(dep.data.record.slots.deposit.type, 'image/png');
  assert.strictEqual((await call(base, 'POST', u + '/renewal', { cookie: boss, file: pdf })).status, 400, 'a renewal needs its new term');
  const ren = await call(base, 'POST', u + '/renewal?start=2027-11-01&months=12', { cookie: boss, file: pdf });
  assert.deepStrictEqual([ren.data.record.renewals.length, ren.data.record.term.start], [1, '2027-11-01']);
  // open, remove (kept in Drive), and the stage rules
  const got = await call(base, 'GET', u + '/contract/file', { cookie: await login('viewer') });
  assert.ok(got.buf.equals(pdf)); assert.match(got.headers.get('content-disposition'), /attachment/);
  const fileId = c.data.record.slots.contract.fileId;
  const rm = await call(base, 'DELETE', u + '/contract', { cookie: boss });
  assert.strictEqual(rm.data.record.slots.contract, undefined);
  assert.ok(google.files[fileId], 'the Drive copy is kept, as the Apps Script did');
  const SH = require('../public/shared');
  assert.strictEqual(SH.dealStageOf({ slots: { clientLoi: 1, ownerLoi: 1, contract: 1, deposit: 1 }, term: { renewFrom: '2027-09-01' } }, true, '2027-09-01'), 'renewal');
  assert.strictEqual(SH.dealStageOf({ slots: { clientLoi: 1, ownerLoi: 1, contract: 1, deposit: 1 }, term: { renewFrom: '2027-09-01' } }, true, '2027-08-31'), 'active');
  assert.strictEqual(SH.dealStageOf({ slots: { clientLoi: 1, ownerLoi: 1 } }, true, '2027-01-01'), 'contract');
  // a JSON body is not an upload anywhere else
  assert.strictEqual((await call(base, 'POST', '/api/deals/monday/9001/6001/other', { cookie: boss, file: pdf })).status, 415);
});
