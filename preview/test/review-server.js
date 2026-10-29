'use strict';
// A local portal for reviewing by hand, with TEST DATA ONLY: an in-memory MongoDB (lost when it stops), the fake Monday
// board, a fake respond.io (sends are recorded here and go nowhere), a fake Google Drive and a fake AI service.
// Nothing real is contacted: no Monday, respond.io, Google, Anthropic or production database.
//   node test/review-server.js [port]        (default 4180)
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');
const { fakeServiceAccount, createFakeGoogle, createFakeAi } = require('./fixtures/fake-google-ai');

const PORT = Number(process.argv[2]) || 4180, PW = 'local-review-only-pw', TODAY = SH.manilaDay();
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
  { id: '9302', name: 'BH-U2', group: 'ALL CLIENTS', v: { cn: 'Window Wendy', va1: 'Bea', inq: 'Rent', cs: 'Qualified', city: 'Taguig', rid: '555302' } });
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
  const sa = fakeServiceAccount(), g = createFakeGoogle(sa), ai = createFakeAi();
  await new Promise((r) => g.listen(0, '127.0.0.1', r)); await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const gb = `http://127.0.0.1:${g.address().port}`;
  const mem = await MongoMemoryServer.create();
  await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_review'), PORT: String(PORT), HOST: '127.0.0.1',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: f + '/monday',
    RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond', RESPOND_SENDS: 'on',
    KPI_REVIEWER_TOBY_EMAIL: ACCOUNTS[0][0], KPI_REVIEWER_JONJO_EMAIL: ACCOUNTS[1][0],
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json, GOOGLE_DRIVE_TOKEN_URL: gb + '/token', GOOGLE_DRIVE_API_URL: gb + '/drive/v3',
    ANTHROPIC_API_KEY: 'sk-ant-fake-local', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.address().port}` }, ['node', 'server.js']);
  const passwordHash = await hashPassword(PW);
  await User.create(ACCOUNTS.map(([email, name, role, vaLabel, modules]) => ({ email, name, role, vaLabel, modules, passwordHash })));
  console.log(`\nLocal review portal (TEST DATA ONLY): http://127.0.0.1:${PORT}/`);
  console.log(`Password for every fictional account: ${PW}`);
  ACCOUNTS.forEach(([e, n, role]) => console.log(`  ${e.padEnd(30)} ${n} · ${role}`));
  console.log('Fake Monday board, fake respond.io (sends are only logged here), fake Google Drive folder link:');
  console.log('  https://drive.google.com/drive/folders/DemoFolderAAAAAAAA   (fictional; shared with ' + sa.email + ')');
  console.log('In-memory database: everything is lost when this stops. Ctrl+C to stop.\n');
})().catch((e) => { console.error(e); process.exit(1); });
