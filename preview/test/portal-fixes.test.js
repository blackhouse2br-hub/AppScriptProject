'use strict';
// Reply checks that settle, property filters, Monday photos, Taguig/BGC counts, Asking for Availability and the
// Failed override. Fictional data only: a throwaway MongoDB and a local fake Monday.com / respond.io (read-only).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, Lead, Listing, AvailabilityRequest, LeadOverride } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { imageType } = require('../src/integrations/monday');
const { createRespond } = require('../src/integrations/respondio');
const { createStatus } = require('../src/integrations/status');
const P = require('../src/integrations/pipeline');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery';
const ARGV = ['node', 'server.js'];
const fake = fx.createFakeServer();
let mem, main, base, boss, ana;

// a few more fictional listings on the fake Listings board: City "Taguig", no City but a BGC tower, and an owner number
const B = fx.BOARDS['2222222'];
B.columns.push({ id: 'ph', title: 'Phone', type: 'phone', settings_str: '{}' });
B.items[0].v.ph = '+63 900 555 0101';
B.items.push({ id: '7004', name: 'Owner D', group: 'Available Units', v: { bn: 'Grand Hyatt Residences', loc: '', lt: 'For Rent', bed: '2 BR', pr: '250000', av: 'Available', ph: '0900 555 0104' } },
  { id: '7005', name: 'Owner E', group: 'Available Units', v: { bn: 'Demo Taguig Tower', loc: 'Taguig', lt: 'For Rent', bed: '1 BR', pr: '90000', av: 'Available' } });

async function call(method, url, cookie, body) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}
async function login(email) {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  mem = await MongoMemoryServer.create();
  ({ server: main } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_fixes'), PORT: '0',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: fakeBase + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: fakeBase + '/respond', RESPOND_LIST_CHECKS: 'on' }, ARGV));
  base = `http://127.0.0.1:${main.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Test', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit' }, passwordHash },
    { email: 'viewer@example.com', name: 'View Only', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
  ]);
  boss = await login('boss@example.com'); ana = await login('ana@example.com');
});
test.after(async () => { main.close(); fake.close(); await mongoose.disconnect(); await mem.stop(); });

// ---------- shared rules (browser + server) ----------
test('cities: one label per listing; Taguig, BGC and BGC towers without a City are the same place', () => {
  for (const [city, bld] of [['Taguig', ''], ['BGC', ''], ['Taguig, Taguig', ''], ['Taguig City', ''], ['', 'Grand Hyatt Residences'], ['', 'Park West BGC'], ['', 'Uptown Parksuites 2'], ['', 'Shangri-La The Fort'], ['', 'Two Serendra']])
    assert.strictEqual(SH.canonCity(city, bld), 'Taguig (BGC)', city + '|' + bld);
  assert.strictEqual(SH.canonCity('Rockwell', ''), 'Makati');
  assert.strictEqual(SH.canonCity('', 'Legaspi Parkview'), 'Makati');
  assert.strictEqual(SH.canonCity('Laguna', ''), 'Laguna');
  assert.strictEqual(SH.canonCity('Parañaque', ''), 'Parañaque');
  assert.strictEqual(SH.canonCity('', 'Ayala Southvale Primera'), '', 'a building name alone never guesses a city it doesn\'t name');
  assert.strictEqual(SH.canonCity('Makati', 'Grand Hyatt Residences'), 'Makati', 'the City column wins over the building name');
  assert.strictEqual(SH.canonCity('Ayala Alabang', ''), 'Muntinlupa (Alabang)');
  for (const b of ['Trump Tower Manila', 'One Central', 'Pacific Plaza Towers']) assert.notStrictEqual(SH.canonCity('', b), 'Taguig (BGC)', b + ' (not only in BGC)');
  assert.deepStrictEqual(SH.citiesIn('BGC or Makati'), ['Taguig (BGC)', 'Makati']);
});

test('property filters: each row narrows, picks in a row widen; empty filters change nothing', () => {
  const L = [
    { id: 'a', building: 'Demo One', code: 'L-1', city: 'Taguig (BGC)', type: 'For Rent', price: 90000, bedrooms: 'Studio', furnishing: 'Fully Furnished', petFriendly: true, availability: 'Available' },
    { id: 'b', building: 'Demo Two', code: 'L-2', city: 'Makati', type: 'For Rent', price: 150000, bedrooms: '2', furnishing: 'Unfurnished', petFriendly: false, availability: 'Available' },
    { id: 'c', building: 'Demo Three', code: 'L-3', city: 'Taguig (BGC)', type: 'For Sale', price: 30e6, bedrooms: '5', furnishing: 'Semi Furnished', petFriendly: false, availability: 'Not Available' },
  ];
  const ids = (f) => SH.filterListings(L, f).map((x) => x.id).join('');
  assert.strictEqual(ids({}), 'abc');
  assert.strictEqual(ids({ cities: ['Taguig (BGC)'] }), 'ac');
  assert.strictEqual(ids({ cities: ['Taguig (BGC)', 'Makati'] }), 'abc');
  assert.strictEqual(ids({ beds: ['Studio'] }), 'a');
  assert.strictEqual(ids({ beds: ['4+', '2'] }), 'bc');
  assert.strictEqual(ids({ type: 'For Sale' }), 'c');
  assert.strictEqual(ids({ priceMin: 100000, priceMax: 200000 }), 'b');
  assert.strictEqual(ids({ furnishing: 'Fully Furnished' }), 'a');
  assert.strictEqual(ids({ pets: true }), 'a');
  assert.strictEqual(ids({ available: true }), 'ab');
  assert.strictEqual(ids({ q: 'two' }), 'b');
  assert.strictEqual(ids({ q: 'L-3', cities: ['Taguig (BGC)'] }), 'c');
});

test('owner contact links: PH numbers normalised; nothing for a missing or odd number', () => {
  assert.deepStrictEqual(SH.contactLinks('0900 555 0104'), { number: '+639005550104', call: 'tel:+639005550104', whatsapp: 'https://wa.me/639005550104', viber: 'viber://chat?number=%2B639005550104' });
  assert.strictEqual(SH.contactLinks('+63 900 555 0101').number, '+639005550101');
  assert.strictEqual(SH.contactLinks(''), null);
  assert.strictEqual(SH.contactLinks('ask the guard'), null);
});

test('validation: asking records and the Failed override', () => {
  assert.deepStrictEqual(SH.validateAsk({ listingId: '7001' }).value, { listingId: '7001' });
  assert.ok(SH.validateAsk({ listingId: '../x' }).errors.length);
  assert.ok(SH.validateAsk({ listingId: '7001', status: 'available' }).errors.length, 'unknown fields refused');
  assert.ok(SH.validateAskPatch({ status: 'sent' }).errors.length);
  assert.ok(SH.validateAskPatch({ contacted: 'sms' }).errors.length);
  assert.ok(SH.validateAskPatch({ status: 'available', contacted: 'call' }).errors.length, 'one change at a time');
  assert.ok(SH.validateFailOverride({ reason: '  ' }).errors.length);
  assert.ok(SH.validateFailOverride({ reason: 'x'.repeat(301) }).errors.length);
  const l = SH.applyOverride({ ai: 'Property Matching', aiSource: 'rules' }, { failed: { reason: 'Not responsive', by: 'Demo', at: new Date() } });
  assert.strictEqual(l.ai, 'Failed'); assert.strictEqual(l.aiSource, 'override'); assert.match(l.aiSub, /^Portal override: Not responsive/);
});

// ---------- 1. reply checks settle per lead ----------
test('pipeline: a failed chat check is its own state, with the reason (no "not checked yet")', () => {
  const lead = { contactId: '555', nextAction: '', createdAt: new Date(Date.now() - 864e5).toISOString() };
  const failed = P.computeLead(lead, null, null, Date.now(), 'respond.io returned HTTP 500.');
  assert.strictEqual(failed.replyError, 'respond.io returned HTTP 500.');
  assert.strictEqual(failed.temp, 'Unchecked'); assert.match(failed.tempWhy, /check failed.*tried again automatically/);
  const never = P.computeLead(lead, null, null, Date.now());
  assert.strictEqual(never.replyError, ''); assert.match(never.tempWhy, /not checked yet/);
  assert.strictEqual(P.computeLead({ ...lead, contactId: '' }, null, null, Date.now(), 'x').replyError, '', 'leads without a chat have no reply error');
});

test('respond.io checks: failures are remembered with back-off; a rate limit stops the round and says when to retry', async () => {
  const hits = {};
  const srv = http.createServer((req, res) => {
    const id = (req.url.match(/id:(\d+)/) || [])[1]; hits[id] = (hits[id] || 0) + 1;
    if (id === '500') { res.writeHead(500); return res.end('{}'); }
    if (id === '429') { res.writeHead(429); return res.end('{}'); }
    if (id === '401') { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ items: [{ messageId: 1, traffic: 'incoming', message: { type: 'text', text: 'Hi' }, status: [{ timestamp: Math.round(Date.now() / 1000) }] }] }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const rs = createRespond({ token: 't', apiUrl: `http://127.0.0.1:${srv.address().port}` }, createStatus(true, []));
    const r1 = await rs.replyStates(['1', '500'], { compute: P.replyState, concurrency: 1 });
    assert.strictEqual(r1.pending, 0, 'the failed contact is settled, not pending');
    assert.strictEqual(r1.retryAfterMs, 0);
    assert.match(rs.cachedState('500').error, /HTTP 500/);
    assert.ok(rs.cachedState('1').st);
    await rs.replyStates(['1', '500'], { compute: P.replyState });
    assert.strictEqual(hits['500'], 1, 'not retried on the next round (back-off)');
    const r3 = await rs.replyStates(['429', '2', '3'], { compute: P.replyState, concurrency: 1 });
    assert.strictEqual(r3.retryAfterMs, 60e3);
    assert.strictEqual(r3.checked, 0, 'contacts skipped after the stop are not counted as checked');
    assert.strictEqual(r3.pending, 3, 'the rate-limited contact and the ones after it are still pending');
    assert.strictEqual(rs.cachedState('429'), null, 'a rate limit is not blamed on that contact');
    const r4 = await rs.replyStates(['401'], { compute: P.replyState });
    assert.strictEqual(r4.retryAfterMs, 30 * 60e3, 'a rejected token: ask again much later, not every minute');
  } finally { srv.close(); }
});

test('reply-states route: every linked lead comes back with a reply state or a reason; override fields included', async () => {
  const r = await call('GET', '/api/respond/reply-states', boss);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.pending, 0);
  assert.ok('retryAfterMs' in r.data);
  const t1 = r.data.leads['9001'];
  assert.ok(t1.replyChecked || t1.replyError !== undefined);
  assert.ok(Object.values(r.data.leads).every((l) => 'replyError' in l));
});

// ---------- 3. photos ----------
test('photos: recognised by their bytes; Monday thumbnail links (login-only) are not used', async () => {
  assert.strictEqual(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.strictEqual(imageType(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'image/png');
  assert.strictEqual(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), '');
  assert.strictEqual(imageType(Buffer.from('<!doctype html><title>Log in</title>')), '');
  await call('GET', '/api/monday/bootstrap', boss);
  const before = fx.calls.files.length;
  const img = await fetch(base + '/api/monday/photo/30001?thumb=1', { headers: { cookie: boss } });
  assert.strictEqual(img.status, 200); assert.strictEqual(img.headers.get('content-type'), 'image/png');
  const got = fx.calls.files.slice(before);
  assert.deepStrictEqual(got.map((c) => [c.method, c.auth]), [['GET', '']], 'one GET of the public_url, without the Monday token');
});

// ---------- 4. Taguig / BGC ----------
test('Monday listings: one normalised city each, raw City kept; BGC tower without a City counts as Taguig (BGC)', async () => {
  const r = (await call('GET', '/api/monday/bootstrap', boss)).data;
  const by = Object.fromEntries(r.listings.map((x) => [x.id, x]));
  assert.strictEqual(by['7001'].city, 'Makati');
  assert.strictEqual(by['7004'].city, 'Taguig (BGC)'); assert.strictEqual(by['7004'].cityRaw, '');
  assert.strictEqual(by['7005'].city, 'Taguig (BGC)'); assert.strictEqual(by['7005'].cityRaw, 'Taguig');
  assert.strictEqual(by['7003'].city, 'Pasig (Ortigas)');
  const ids = r.listings.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no listing appears twice');
  assert.strictEqual(r.listings.filter((x) => x.city === 'Taguig (BGC)').length, 2);
});

// ---------- 5. Asking for Availability ----------
test('asking: one record per lead + listing, bounded per lead, contact log capped; visibility and edit access enforced', async () => {
  const add = (who, lead, listingId) => call('POST', `/api/leads/monday/${lead}/asking`, who, { listingId });
  const a = await add(ana, '9001', '7001');
  assert.strictEqual(a.status, 201); assert.strictEqual(a.data.request.status, 'asking'); assert.strictEqual(a.data.request.listingName, 'Fake Tower');
  const again = await add(ana, '9001', '7001');
  assert.strictEqual(again.status, 200); assert.strictEqual(again.data.already, true); assert.strictEqual(again.data.request.id, a.data.request.id);
  // two presses at the same moment still give one record (unique index)
  const both = await Promise.all([add(boss, '9001', '7004'), add(boss, '9001', '7004')]);
  assert.deepStrictEqual(both.map((x) => x.status).sort(), [200, 201], JSON.stringify(both.map((x) => x.data)));
  assert.strictEqual(await AvailabilityRequest.countDocuments({ source: 'monday', leadId: '9001' }), 2);
  // bound per lead
  const max = SH.ASK.maxPerLead; SH.ASK.maxPerLead = 2;
  try { const over = await add(boss, '9001', '7005'); assert.strictEqual(over.status, 400); assert.match(over.data.error, /already has 2 units/); }
  finally { SH.ASK.maxPerLead = max; }
  // unknown listing / lead, other VA's lead, view-only user
  assert.strictEqual((await add(boss, '9001', '99999')).status, 404);
  assert.strictEqual((await add(boss, '123456', '7001')).status, 404);
  assert.strictEqual((await add(ana, '9003', '7001')).status, 404, 'Ana cannot see Bea\'s lead');
  const viewer = await login('viewer@example.com');
  assert.strictEqual((await add(viewer, '9001', '7005')).status, 403);
  assert.strictEqual((await call('GET', '/api/leads/monday/9001/asking', viewer)).data.requests.length, 2);
  // contact taps are logged (newest 20); status changes; remove
  const rid = a.data.request.id;
  for (let i = 0; i < 25; i++) assert.strictEqual((await call('PATCH', '/api/asking/' + rid, ana, { contacted: ['call', 'whatsapp', 'viber'][i % 3] })).status, 200);
  const doc = await AvailabilityRequest.findById(rid);
  assert.strictEqual(doc.contacts.length, SH.ASK.logMax);
  assert.strictEqual((await call('PATCH', '/api/asking/' + rid, ana, { status: 'available' })).data.request.status, 'available');
  assert.strictEqual((await call('PATCH', '/api/asking/' + rid, ana, { status: 'sent' })).status, 400);
  assert.strictEqual((await call('DELETE', '/api/asking/' + rid, ana)).status, 200);
  assert.strictEqual(await AvailabilityRequest.countDocuments({ source: 'monday', leadId: '9001' }), 1);
});

// ---------- 6. Failed override ----------
test('Failed override: Managers only; shown as a portal override for a Monday lead, removable; MongoDB leads too', async () => {
  // a VA with edit access to Leads can't set or remove it
  const va = await call('PUT', '/api/leads/monday/9006/override', ana, { reason: 'Not responsive' });
  assert.strictEqual(va.status, 403); assert.match(va.data.error, /Only Managers/);
  assert.strictEqual(await LeadOverride.countDocuments(), 0);
  const put = await call('PUT', '/api/leads/monday/9006/override', boss, { reason: 'Not responsive · no reply after 3 follow-ups' });
  assert.strictEqual(put.status, 200);
  let l = (await call('GET', '/api/monday/bootstrap', boss)).data.leads.find((x) => x.id === '9006');
  assert.strictEqual(l.ai, 'Failed'); assert.strictEqual(l.aiSource, 'override'); assert.match(l.aiSub, /^Portal override: Not responsive/);
  assert.strictEqual(l.override.by, 'Test Manager');
  // the VA sees it (labelled), but can't remove it
  assert.strictEqual((await call('GET', '/api/monday/bootstrap', ana)).data.leads.find((x) => x.id === '9006').aiSource, 'override');
  assert.strictEqual((await call('DELETE', '/api/leads/monday/9006/override', ana)).status, 403);
  // it survives the reply-state refresh too
  assert.strictEqual((await call('GET', '/api/respond/reply-states', boss)).data.leads['9006'].ai, 'Failed');
  assert.strictEqual((await call('PUT', '/api/leads/monday/9006/override', boss, { reason: '' })).status, 400);
  assert.strictEqual((await call('PUT', '/api/leads/monday/99999/override', boss, { reason: 'x' })).status, 404, 'unknown lead');
  const del = await call('DELETE', '/api/leads/monday/9006/override', boss);
  assert.strictEqual(del.status, 200); assert.notStrictEqual(del.data.lead.ai, 'Failed'); assert.notStrictEqual(del.data.lead.aiSource, 'override');
  l = (await call('GET', '/api/monday/bootstrap', boss)).data.leads.find((x) => x.id === '9006');
  assert.notStrictEqual(l.aiSource, 'override');
  // a MongoDB lead
  const m = await Lead.create({ code: 'DEMO-OVR-1', name: 'Demo Override', va: 'Ana' });
  assert.strictEqual((await call('PUT', `/api/leads/mongo/${m.id}/override`, ana, { reason: 'Not responsive' })).status, 403);
  assert.strictEqual((await call('PUT', `/api/leads/mongo/${m.id}/override`, boss, { reason: 'Not responsive' })).status, 200);
  await Listing.create({ code: 'DEMO-L-BGC', building: 'Demo BGC Tower', city: 'BGC', type: 'For Rent' });
  const boot = (await call('GET', '/api/bootstrap', ana)).data, b = boot.leads.find((x) => x.id === m.id);
  const ml = boot.listings.find((x) => x.code === 'DEMO-L-BGC');
  assert.deepStrictEqual([ml.city, ml.cityRaw], ['Taguig (BGC)', 'BGC'], 'MongoDB listings get the same city label');
  assert.strictEqual(b.ai, 'Failed'); assert.strictEqual(b.aiSource, 'override');
  assert.strictEqual((await Lead.findById(m.id)).ai, 'Property Matching', 'the lead record itself is unchanged');
  assert.strictEqual(await LeadOverride.countDocuments(), 1);
});

test('read-only: every Monday call was a query and every respond.io call a GET; no file was changed', () => {
  assert.ok(fx.calls.monday.length > 0);
  for (const c of fx.calls.monday) assert.match(c.body.query, /^\s*query\b/);
  assert.ok(fx.calls.monday.every((c) => !/\bmutation\b/i.test(c.body.query)));
  assert.ok(fx.calls.respond.every((c) => c.method === 'GET'));
  assert.ok(fx.calls.files.every((c) => c.method === 'GET' && !c.auth));
});
