'use strict';
// Listing photos through the server: valid photos, listings without photos, expired / failed / deleted file links,
// non-image files and files over 10 MB. Fictional data only: a throwaway MongoDB and the local fake Monday.com
// (read-only; the fake file host stands in for Monday's S3 links).
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery';
const fake = fx.createFakeServer();
let mem, main, base, boss;

// one fictional listing whose files cover every failure case, and one with no files at all
fx.BOARDS['2222222'].items.push(
  { id: '7006', name: 'Owner F', group: 'Available Units', v: { bn: 'Edge Case Tower', loc: 'Makati', lt: 'For Rent', bed: '1 BR', pr: '80000', av: 'Available' },
    assets: [['30020', 'jpg'], ['30021', 'jpg'], ['30022', 'jpg'], ['30023', 'png'], ['30024', 'png'], ['30025', 'webp'], ['30026', 'jpeg'], ['30027', 'heic'], ['30028', 'mp4']] },
  { id: '7007', name: 'Owner G', group: 'Available Units', v: { bn: 'No Photo Tower', loc: 'Makati', lt: 'For Rent', bed: '1 BR', pr: '85000', av: 'Available' } });

const photo = (id, cookie = boss) => fetch(`${base}/api/monday/photo/${id}?thumb=1`, { headers: cookie ? { cookie } : {} });
const filesSince = (n) => fx.calls.files.slice(n);

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  mem = await MongoMemoryServer.create();
  ({ server: main } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_photos'), PORT: '0',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: fakeBase + '/monday' }, ['node', 'server.js']));
  base = `http://127.0.0.1:${main.address().port}`;
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash: await hashPassword(PW) },
    { email: 'nolist@example.com', name: 'No Listings', role: 'VA', vaLabel: 'Ana', modules: { leads: 'none', invdash: 'none', calendar: 'none', daily: 'view' }, passwordHash: await hashPassword(PW) }]);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss@example.com', password: PW }) });
  boss = res.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await fetch(base + '/api/monday/bootstrap', { headers: { cookie: boss } })).status, 200);
});
test.after(async () => { main.close(); fake.close(); await mongoose.disconnect(); await mem.stop(); });

test('listing photo IDs: image files only; a listing without photos has an empty list (the page shows "No photo")', async () => {
  const listings = (await (await fetch(base + '/api/monday/bootstrap', { headers: { cookie: boss } })).json()).listings;
  const by = Object.fromEntries(listings.map((x) => [x.id, x]));
  assert.deepStrictEqual(by['7006'].photos, ['30020', '30021', '30022', '30023', '30024', '30025', '30026']);   // HEIC and MP4 are not offered
  assert.deepStrictEqual(by['7007'].photos, []);
  assert.ok(!JSON.stringify(listings).includes('/files/'), 'file links never reach the browser');
  assert.ok(!JSON.stringify(listings).includes('renewed'), 'nor renewed ones');
});

test('a valid photo is served as an image, fetched without the Monday token', async () => {
  const n = fx.calls.files.length;
  const r = await photo('30001');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
  assert.deepStrictEqual(filesSince(n).map((c) => c.auth), ['']);
});

test('an expired file link is renewed once with a read query, then the photo loads', async () => {
  const m = fx.calls.monday.length, n = fx.calls.files.length;
  const r = await photo('30020');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  const files = filesSince(n);
  assert.strictEqual(files.length, 2, 'the expired link, then the renewed one');
  assert.ok(!/renewed/.test(files[0].path) && /renewed=1/.test(files[1].path));
  const q = fx.calls.monday.slice(m).map((c) => c.body.query);
  assert.strictEqual(q.length, 1); assert.match(q[0], /^query .*assets\(ids/);
  assert.ok(files.every((c) => c.auth === ''));
  // the renewed link is kept: the next request goes straight to it
  const n2 = fx.calls.files.length;
  assert.strictEqual((await photo('30020')).status, 200);
  assert.deepStrictEqual(filesSince(n2).map((c) => /renewed=1/.test(c.path)), [true]);
});

test('a file deleted on Monday (expired link, no new link) is 404; a failing file host is 502; neither is retried forever', async () => {
  const n = fx.calls.files.length;
  const del = await photo('30026');
  assert.strictEqual(del.status, 404);
  assert.match((await del.json()).error, /no longer on Monday/);
  assert.strictEqual(filesSince(n).length, 1);
  const n2 = fx.calls.files.length;
  const bad = await photo('30021');
  assert.strictEqual(bad.status, 502);
  assert.strictEqual(filesSince(n2).length, 1, 'a server error is not retried');
});

test('non-image files are refused (a PDF labelled image/jpeg, an HTML page, an SVG)', async () => {
  for (const id of ['30022', '30025', '30009']) {
    const r = await photo(id);
    assert.strictEqual(r.status, 415, id);
    assert.match(r.headers.get('content-type'), /json/, id + ' is never passed on as the file');
  }
});

test('files over 10 MB are refused, with or without a Content-Length', async () => {
  for (const id of ['30023', '30024']) {
    const r = await photo(id);
    assert.strictEqual(r.status, 413, id);
    assert.match((await r.json()).error, /too large/);
  }
  // the server is still fine afterwards
  assert.strictEqual((await photo('30001')).status, 200);
});

test('no open proxy: only asset IDs of the configured Listings board; sign-in and listing access required', async () => {
  const n = fx.calls.files.length;
  assert.strictEqual((await photo('99999')).status, 404);                  // not a listing photo: nothing fetched
  assert.strictEqual((await fetch(`${base}/api/monday/photo/${encodeURIComponent('http://127.0.0.1/x')}`, { headers: { cookie: boss } })).status, 404);
  assert.strictEqual((await photo('30001', null)).status, 401);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nolist@example.com', password: PW }) });
  assert.strictEqual((await photo('30001', res.headers.get('set-cookie').split(';')[0])).status, 403);
  assert.strictEqual(filesSince(n).length, 0);
});
