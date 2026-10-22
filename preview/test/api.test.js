'use strict';
// MongoDB mode end to end against a throwaway in-memory MongoDB (mongodb-memory-server).
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { seed } = require('../scripts/seed-demo');
const { User, Lead, Viewing } = require('../src/models');
const { hashPassword } = require('../src/auth');

const PW = 'correct-horse-battery';
let mem, server, base;

async function call(method, url, { body, cookie, origin, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') || '' };
}
async function login(email, password = PW) {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, `login ${email}: ${JSON.stringify(r.data)}`);
  return r.setCookie.split(';')[0];
}

test.before(async () => {
  mem = await MongoMemoryServer.create();
  ({ server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_test'), PORT: '0' }, ['node', 'server.js']));
  base = `http://127.0.0.1:${server.address().port}`;
  await seed();
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Test', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', calendar: 'edit' }, passwordHash },
    { email: 'nolabel@example.com', name: 'No Label', role: 'VA', vaLabel: '', modules: { leads: 'edit' }, passwordHash },
    { email: 'ely@example.com', name: 'Ely Santos', role: 'Broker', modules: { leads: 'view', calendar: 'edit' }, passwordHash },
    { email: 'throttle@example.com', name: 'Throttle', role: 'VA', vaLabel: 'Bea', modules: { leads: 'view' }, passwordHash },
  ]);
});
test.after(async () => { server.close(); await mongoose.disconnect(); await mem.stop(); });

test('config.js reports mongo mode and the CSP allows same-origin API only', async () => {
  const r = await fetch(base + '/config.js');
  assert.match(await r.text(), /"mode":"mongo"/);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'self'/);
});

test('authentication: sign-in required, cookie flags, wrong password, throttling, logout', async () => {
  assert.strictEqual((await call('GET', '/api/bootstrap')).status, 401);
  assert.strictEqual((await call('GET', '/api/session')).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: 'boss@example.com', password: 'wrong-password-123' } })).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: PW } })).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: { $gt: '' }, password: PW } })).status, 400);

  const r = await call('POST', '/api/auth/login', { body: { email: 'BOSS@example.com', password: PW } });
  assert.strictEqual(r.status, 200);
  assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Strict/); assert.doesNotMatch(r.setCookie, /Secure/);
  assert.strictEqual(r.data.user.passwordHash, undefined);
  const cookie = r.setCookie.split(';')[0];
  assert.strictEqual((await call('GET', '/api/session', { cookie })).data.user.email, 'boss@example.com');
  assert.strictEqual((await call('POST', '/api/auth/logout', { cookie })).status, 200);
  assert.strictEqual((await call('GET', '/api/bootstrap', { cookie })).status, 401);

  for (let i = 0; i < 8; i++) await call('POST', '/api/auth/login', { body: { email: 'throttle@example.com', password: 'wrong-password-123' } });
  assert.strictEqual((await call('POST', '/api/auth/login', { body: { email: 'throttle@example.com', password: PW } })).status, 429);
});

test('Manager sees everything; passwords are never returned', async () => {
  const cookie = await login('boss@example.com');
  const b = (await call('GET', '/api/bootstrap', { cookie })).data;
  assert.strictEqual(b.leads.length, await Lead.countDocuments());
  assert.ok(b.listings.length > 30 && b.viewings.length > 10 && b.templates.length === 3);
  assert.ok(b.users.length >= 5);
  for (const u of b.users) assert.strictEqual(u.passwordHash, undefined);
});

test('VA: only assigned leads; edits validated; other VAs\' leads and Settings blocked', async () => {
  const cookie = await login('ana@example.com');
  const b = (await call('GET', '/api/bootstrap', { cookie })).data;
  assert.ok(b.leads.length > 0);
  assert.ok(b.leads.every((l) => l.va === 'Ana'));
  assert.deepStrictEqual(b.users, []);
  const own = b.leads[0], other = await Lead.findOne({ va: { $ne: 'Ana' } });

  assert.strictEqual((await call('PATCH', '/api/leads/' + other.id, { cookie, body: { name: 'Hacked' } })).status, 404);
  assert.strictEqual((await call('GET', `/api/leads/${other.id}/notes`, { cookie })).status, 404);
  assert.strictEqual((await call('PATCH', '/api/leads/' + own.id, { cookie, body: { email: 'not-an-email' } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/leads/' + own.id, { cookie, body: { ai: 'Active' } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/leads/' + own.id, { cookie, body: { name: { $set: 'x' } } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/leads/not-an-id', { cookie, body: { name: 'x' } })).status, 404);
  assert.strictEqual((await call('PATCH', '/api/leads/' + own.id, { cookie, body: '{bad json', raw: true })).status, 400);

  const ok = await call('PATCH', '/api/leads/' + own.id, { cookie, body: { budget: '250000', email: 'New@Example.com' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.lead.budget, 250000);
  assert.strictEqual(ok.data.lead.email, 'new@example.com');
  assert.match(ok.data.note.text, /Updated: .*Budget/);
  const notes = (await call('GET', `/api/leads/${own.id}/notes`, { cookie })).data.notes;
  assert.ok(notes.some((n) => n.by === 'Ana Test'));

  assert.strictEqual((await call('GET', '/api/team', { cookie })).status, 403);
  assert.strictEqual((await call('POST', '/api/templates', { cookie, body: { name: 'x', language: 'en', body: 'y' } })).status, 403);
  assert.strictEqual((await call('PATCH', '/api/listings/' + b.listings[0].id, { cookie, body: { availability: 'Reserved' } })).status, 403);
});

test('VA without a VA label sees no leads', async () => {
  const cookie = await login('nolabel@example.com');
  assert.deepStrictEqual((await call('GET', '/api/bootstrap', { cookie })).data.leads, []);
});

test('Broker: own leads/viewings only, leads are view-only', async () => {
  const cookie = await login('ely@example.com');
  const b = (await call('GET', '/api/bootstrap', { cookie })).data;
  const viaViewing = new Set((await Viewing.find({ broker: 'Ely Santos' })).map((v) => String(v.leadId)));
  assert.ok(b.leads.length > 0);
  assert.ok(b.leads.every((l) => l.salesperson === 'Ely Santos' || viaViewing.has(l.id)));
  assert.ok(b.viewings.every((v) => v.broker === 'Ely Santos'));
  assert.strictEqual((await call('PATCH', '/api/leads/' + b.leads[0].id, { cookie, body: { name: 'X' } })).status, 403);
});

test('booking a viewing: validation, stage change, note, status update', async () => {
  const cookie = await login('ana@example.com');
  const lead = await Lead.findOneAndUpdate({ va: 'Ana' }, { $set: { ai: 'Property Matching', status: 'Qualified' } }, { returnDocument: 'after' });
  const listing = (await call('GET', '/api/bootstrap', { cookie })).data.listings[0];
  const bad = await call('POST', '/api/viewings', { cookie, body: { leadId: lead.id, listingId: listing.id, date: '2026-11-02', time: '23:30', broker: 'Ely Santos' } });
  assert.strictEqual(bad.status, 400);
  const r = await call('POST', '/api/viewings', { cookie, body: { leadId: lead.id, listingId: listing.id, date: '2026-11-02', time: '10:00', broker: 'Ely Santos' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.lead.ai, 'Scheduling');
  assert.strictEqual(r.data.viewing.status, 'Proposed');
  assert.match(r.data.note.text, /Viewing proposed/);
  const p = await call('PATCH', '/api/viewings/' + r.data.viewing.id, { cookie, body: { status: 'Confirmed' } });
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.data.viewing.status, 'Confirmed');
  assert.strictEqual((await call('PATCH', '/api/viewings/' + r.data.viewing.id, { cookie, body: { status: 'Teleported' } })).status, 400);
});

test('team management: passwords, uniqueness, last Manager, self-removal, cross-site', async () => {
  const cookie = await login('boss@example.com');
  const base1 = { name: 'New VA', email: 'newva@example.com', role: 'VA', vaLabel: 'Carlo', modules: { leads: 'edit' } };
  assert.strictEqual((await call('POST', '/api/team', { cookie, body: base1 })).status, 400);                         // no password
  assert.strictEqual((await call('POST', '/api/team', { cookie, body: { ...base1, password: 'short' } })).status, 400);
  const created = await call('POST', '/api/team', { cookie, body: { ...base1, password: 'a-long-temporary-pw' } });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.user.passwordHash, undefined);
  assert.strictEqual((await call('POST', '/api/team', { cookie, body: { ...base1, password: 'a-long-temporary-pw' } })).status, 409);
  await login('newva@example.com', 'a-long-temporary-pw');

  const boss = await User.findOne({ email: 'boss@example.com' });
  assert.strictEqual((await call('PATCH', '/api/team/' + boss.id, { cookie, body: { name: 'Boss', email: 'boss@example.com', role: 'VA', vaLabel: 'Ana' } })).status, 400);
  assert.strictEqual((await call('DELETE', '/api/team/' + boss.id, { cookie })).status, 400);
  assert.strictEqual((await call('POST', '/api/team', { cookie, origin: 'https://evil.example', body: { ...base1, email: 'x@example.com', password: 'a-long-temporary-pw' } })).status, 403);

  const vaCookie = await login('newva@example.com', 'a-long-temporary-pw');
  assert.strictEqual((await call('DELETE', '/api/team/' + created.data.user.id, { cookie })).status, 200);
  assert.strictEqual((await call('GET', '/api/session', { cookie: vaCookie })).status, 401);   // removed member is signed out

  const t = await call('POST', '/api/templates', { cookie, body: { name: 'hello_test', language: 'en', body: 'Hi {{1}}' } });
  assert.strictEqual(t.status, 201);
  assert.strictEqual((await call('POST', '/api/templates', { cookie, body: { name: 'hello_test', language: 'en', body: 'dup' } })).status, 409);
});

test('if MongoDB goes away the API returns 503 (never demo data)', async () => {
  const cookie = await login('boss@example.com');
  await mongoose.disconnect();
  const r = await call('GET', '/api/bootstrap', { cookie });
  assert.strictEqual(r.status, 503);
  assert.match(r.data.error, /will not switch to demo data/);
  assert.strictEqual((await fetch(base + '/healthz')).status, 503);
});
