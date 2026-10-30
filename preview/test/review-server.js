'use strict';
// A local portal for reviewing by hand, with TEST DATA ONLY: an in-memory MongoDB (lost when it stops), the fake Monday
// board, a fake respond.io (sends are recorded here and go nowhere), a fake Google Drive and a fake AI service.
// Nothing real is contacted: no Monday, respond.io, Google, Anthropic or production database.
//   node test/review-server.js [port]             (default 4180)
//   node test/review-server.js [port] --mydrive   signed LOIs and deal files in a fake My Drive (GOOGLE_DRIVE_OAUTH=on):
//     a Manager connects it in Settings → Files; the fake Google approves at once (Project Pages' Drive is off here)
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');
const { fakeServiceAccount, createFakeGoogle, createFakeAi, demoDrive } = require('./fixtures/fake-google-ai');
const { createFakeGoogleOAuth } = require('./fixtures/fake-google-oauth');

const MYDRIVE = process.argv.includes('--mydrive');
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 4180, PW = 'local-review-only-pw', TODAY = SH.manilaDay();
const ACCOUNTS = [
  ['toby.reviewer@example.com', 'Toby (test reviewer)', 'Broker', '', { upsell: 'view' }],
  ['jonjo.reviewer@example.com', 'Jonjo (test reviewer)', 'Manager', '', {}],
  ['blackhouse2br@gmail.com', 'blackhouse (test copy)', 'Manager', '', {}],
  ['lara.va@example.com', 'Lara', 'VA', 'Lara', { leads: 'view' }],
  ['ana.va@example.com', 'Ana (test VA)', 'VA', 'Ana', { leads: 'view', pages: 'view', upsell: 'edit' }],
];

// fictional extras on the fake boards: Lara's clients (KPI Review), VA label spellings (VA filter), upsell clients
const L = fx.BOARDS['1111111'];
L.columns.find((c) => c.id === 'va1').settings_str = JSON.stringify({ labels: { 0: 'Ana', 1: 'Bea', 2: 'Cora Fake', 3: 'Dev Fake', 4: 'Lara' } });
L.items.push({ id: '9101', name: 'BH-L1', group: 'ALL CLIENTS', v: { cn: 'Lara Client One', va1: 'Lara', inq: 'Rent', cs: 'Qualified', dq: TODAY, rid: '555101' } },
  { id: '9102', name: 'BH-L2', group: 'ALL CLIENTS', v: { cn: 'Lara Client Two', va1: 'Lara', inq: 'Rent', cs: 'Failed', dq: TODAY } },
  { id: '9201', name: 'BH-V1', group: 'ALL CLIENTS', v: { cn: 'Lower Case Ana Client', va1: 'ana', inq: 'Rent', dq: '2026-10-20' } },
  { id: '9203', name: 'BH-V3', group: 'ALL CLIENTS', v: { cn: 'Nobody Assigned', inq: 'Rent', dq: '2026-10-22' } },
  { id: '9302', name: 'BH-U2', group: 'ALL CLIENTS', v: { cn: 'Window Wendy', va1: 'Bea', inq: 'Rent', cs: 'Qualified', city: 'Taguig', rid: '555302' } },
  // Service Requests: a client who replied to a movers offer (fake chat 555007, with made-up personal details)
  { id: '9401', name: 'BH-S1', group: 'ALL CLIENTS', v: { cn: 'Sofia Reyes', va1: 'Ana', inq: 'Rent', cs: 'Qualified', city: 'Makati', rid: '555007', ph: '+63 917 555 0199' } });
// a made-up LOI template (never the team's real ones)
const P = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`, ROW = (a) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc><w:p/></w:tc></w:tr>`;
const TEMPLATE = require('../src/docx').zip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>') },
  { name: 'word/document.xml', data: Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${P('Date: _______________')}${P('To:      _______________________________')}${P('RE:     LETTER OF INTENT TO LEASE (MADE-UP TEMPLATE)')}${P('Dear _______________:')}`
    + `<w:tbl>${ROW('Lessor')}${ROW('Lessee')}${ROW('Property')}${ROW('Lease Term')}${ROW('Monthly Rental')}${ROW('Advance Rental')}${ROW('Security Deposit')}</w:tbl>${P('_______________________________')}${P('Print Name &amp; Signature')}${P('_______________________________')}${P('LESSOR')}<w:sectPr/></w:body></w:document>`) }]);
fx.BOARDS['3333333'].items.push({ id: '6101', name: 'Viewing L', group: 'Viewings', created: TODAY, v: { fs: TODAY, cl: { linked: ['9101'] }, b: 'Fake Tower', c: 'Makati', tm: '10:00', sp: 'Ely Santos', st: 'Done' } });

(async () => {
  const fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = `http://127.0.0.1:${fake.address().port}`, sends = [];
  // fake respond.io sends: recorded and answered here (never forwarded anywhere); one client's 24 h window is closed
  const front = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.method === 'POST' && req.url.startsWith('/respond/')) {
        sends.push({ at: new Date().toISOString(), path: req.url.slice(8) });
        console.log(`[fake respond.io] ${req.method} ${req.url.slice(8)} (not sent anywhere)`);
        if (/id:555302\/message/.test(req.url)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'Outside of the 24 hour messaging window' })); }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"messageId":1}');
      }
      const r = await fetch(fakeBase + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r)); const f = `http://127.0.0.1:${front.address().port}`;
  // the fake Drive also has the LOI and deal folders (signed copies, PDFs and deal files go there, in memory)
  const sa = fakeServiceAccount(), g = createFakeGoogle(sa, { ...demoDrive(), LoiFolderAAAAAAAAAAA: { name: 'Blackhouse LOIs (fake)', mimeType: 'application/vnd.google-apps.folder' },
    DealsFolderAAAAAAAAA: { name: 'Deal files (fake)', mimeType: 'application/vnd.google-apps.folder' } }), ai = createFakeAi();
  await new Promise((r) => g.listen(0, '127.0.0.1', r)); await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const gb = `http://127.0.0.1:${g.address().port}`;
  // --mydrive: a fake Google account's My Drive, connected through the fake OAuth consent (fictional client and key)
  const OAUTH_CLIENT = 'fake-review-client.apps.googleusercontent.com', OAUTH_SECRET = 'fake-review-secret';
  const go = MYDRIVE ? createFakeGoogleOAuth({ clientId: OAUTH_CLIENT, clientSecret: OAUTH_SECRET, email: 'blackhouse.files.fake@example.com' }) : null;
  if (go) await new Promise((r) => go.listen(0, '127.0.0.1', r));
  const gob = go ? `http://127.0.0.1:${go.address().port}` : '';
  const driveEnv = MYDRIVE ? { GOOGLE_DRIVE_OAUTH: 'on', GOOGLE_CLIENT_ID: OAUTH_CLIENT, GOOGLE_CLIENT_SECRET: OAUTH_SECRET, GOOGLE_DRIVE_TOKEN_KEY: require('crypto').randomBytes(32).toString('base64'),
    GOOGLE_AUTH_URL: gob + '/auth', GOOGLE_TOKEN_URL: gob + '/token', GOOGLE_JWKS_URL: gob + '/certs', GOOGLE_REVOKE_URL: gob + '/revoke',
    GOOGLE_DRIVE_API_URL: gob + '/drive/v3', GOOGLE_DRIVE_UPLOAD_URL: gob + '/upload/drive/v3', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive' }
    : { GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json, GOOGLE_DRIVE_TOKEN_URL: gb + '/token', GOOGLE_DRIVE_API_URL: gb + '/drive/v3',
      // LOI signing and deal files against the fake Drive (writer account = the same fake key; nothing leaves this computer)
      GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON: sa.json, GOOGLE_DRIVE_UPLOAD_URL: gb + '/upload/drive/v3',
      GOOGLE_DRIVE_LOI_FOLDER_ID: 'LoiFolderAAAAAAAAAAA', GOOGLE_DRIVE_DEALS_FOLDER_ID: 'DealsFolderAAAAAAAAA', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive' };
  const mem = await MongoMemoryServer.create();
  await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_review'), PORT: String(PORT), HOST: '127.0.0.1',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: f + '/monday',
    // RESPOND_SENDS stays off here as on the live server (Upselling / supplier send buttons show "switched off")
    RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond', RESPOND_SPACE_ID: '424242',   // a made-up space: Message Lead opens app.respond.io/space/424242/…
    KPI_REVIEWER_TOBY_EMAIL: ACCOUNTS[0][0], KPI_REVIEWER_JONJO_EMAIL: ACCOUNTS[1][0],
    ...driveEnv,
    // the fake AI service (local): never the real key in preview/.env
    ANTHROPIC_API_KEY: 'sk-ant-fake-local', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.address().port}` }, ['node', 'server.js']);
  const passwordHash = await hashPassword(PW);
  await User.create(ACCOUNTS.map(([email, name, role, vaLabel, modules]) => ({ email, name, role, vaLabel, modules, passwordHash })));
  // synthetic records to review the new features with: the made-up LOI template, a movers offer to Sofia (so
  // "Check replies" finds her reply), and an Asking for Availability unit for Test Client One
  const { LoiTemplate, RenewalLog, AvailabilityRequest } = require('../src/models');
  await LoiTemplate.create({ slot: 'lease', name: 'Made-up lease LOI.docx', size: TEMPLATE.length, data: TEMPLATE, uploadedBy: { userId: (await User.findOne({ email: ACCOUNTS[1][0] }))._id, name: 'Jonjo (test reviewer)' } });
  await RenewalLog.create({ source: 'monday', leadId: '9401', kind: 'movers', by: { name: 'Ana (test VA)' } });
  await AvailabilityRequest.create({ source: 'monday', leadId: '9001', listingId: '7001', listingName: 'Fake Tower', createdBy: { name: 'Ana (test VA)' }, updatedBy: { name: 'Ana (test VA)' } });
  console.log(`\nLocal review portal (TEST DATA ONLY): http://127.0.0.1:${PORT}/`);
  console.log(`Password for every fictional account: ${PW}`);
  ACCOUNTS.forEach(([e, n, role]) => console.log(`  ${e.padEnd(30)} ${n} · ${role}`));
  console.log('Fake Monday board, fake respond.io (sends are only logged here), fake Google Drive folder link:');
  console.log('  https://drive.google.com/drive/folders/DemoFolderAAAAAAAA   (fictional; shared with ' + sa.email + ')');
  if (MYDRIVE) console.log('My Drive storage (fake): sign in as a Manager → Settings → Files → Connect Google Drive (the fake Google approves at once).');
  console.log('In-memory database: everything is lost when this stops. Ctrl+C to stop.\n');
})().catch((e) => { console.error(e); process.exit(1); });
