'use strict';
// Apps Script parity, portal side: Calendar-board deals (read only, scoped), the Renewals message log, Daily Report lines
// and P&L cells — against the local FAKE Monday / respond.io only. Proves: who may see and change what; deals carry no
// client names; the log keeps no message text; nothing is sent to respond.io and nothing is written to Monday.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, RenewalLog, DailyNote, PlCell } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const DAY = 864e5;
const ymd = (n) => { const d = new Date(Date.now() + n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// fictional Calendar board for this file: the real board's deal / lease columns (titles and kinds)
const C = fx.BOARDS['3333333'];
const col = (id, title, type, labels) => ({ id, title, type, settings_str: labels ? JSON.stringify({ labels: Object.fromEntries(labels.map((l, i) => [String(i), l])) }) : '{}' });
C.columns.push(col('ccd', 'Contract Date', 'date'), col('rr', 'Rental Rate', 'mirror'), col('mcp', 'Monthly Contract Price', 'numbers'), col('bc', 'Blackhouse Commission', 'numbers'),
  col('dd', 'Deductions', 'numbers'), col('dop', 'Date of Payment', 'date'), col('cold', 'Collection Date', 'date'), col('ced', 'Contract Expiration Date', 'date'),
  col('rd', 'Renewal Date', 'date'), col('rs', 'Renewal Status', 'status', ['Upcoming Renewal', 'Renewal Discussion', 'Closed', 'Non-renewed']),
  col('typt', 'Type', 'text'), col('typ', 'Type', 'dropdown', ['Property Sale', 'Property Rental', 'Property Renewal']));
C.items.push(
  { id: '6301', name: 'Deal 1', group: 'Closed', v: { fs: ymd(-45), cl: { linked: ['9001'] }, b: 'Lease Tower', c: 'Makati', sp: 'Ely Santos', st: 'Closed', ccd: ymd(-40), mcp: '90000', bc: '90000', tp: '90000', dop: ymd(-10), ced: ymd(20), typ: 'Property Rental', typt: 'ignore me' } },
  { id: '6302', name: 'Deal 2', group: 'Closed', v: { fs: ymd(-35), cl: { linked: ['9003'] }, b: 'Sale Tower', c: 'Pasig', sp: 'Gia Cruz', st: 'Closed', ccd: ymd(-30), mcp: '25000000', bc: '750000', tp: '700000', dd: '50000', dop: ymd(-5), typ: 'Property Sale' } },
  { id: '6303', name: 'Deal 3', group: 'Viewings', v: { cl: { linked: ['9006'] }, b: 'Pending Tower', c: 'Makati', sp: 'Ely Santos', st: 'Waiting for Payment', ccd: ymd(-20), bc: '45000', rr: '45,000', ced: ymd(70), rs: 'Renewal Discussion', typ: 'Property Rental' } });

let mem, srv, fake, base, ck = {};
async function call(method, url, cookie, body) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}
const mutations = () => fx.calls.monday.filter((c) => /^\s*mutation\b/.test(c.body.query));

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  ({ server: srv } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_parity'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_WRITES: 'on',
    MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: `http://127.0.0.1:${fake.address().port}/monday`,
    RESPOND_TOKEN: 'rtest', RESPOND_API_URL: `http://127.0.0.1:${fake.address().port}/respond` }, ARGV));
  base =`http://127.0.0.1:${srv.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Demo Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view', renewals: 'edit', daily: 'edit', ldash: 'view', pl: 'view' }, passwordHash },
    { email: 'view@example.com', name: 'View Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view', renewals: 'view', daily: 'view', pl: 'view' }, passwordHash },
    { email: 'none@example.com', name: 'None Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: 'broker@example.com', name: 'Ely Santos', role: 'Broker', salesLabel: 'Gia Cruz', modules: { brokers: 'view' }, passwordHash },
  ]);
  for (const k of ['boss', 'ana', 'view', 'none', 'broker']) {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: k + '@example.com', password: PW }) });
    ck[k] = r.headers.get('set-cookie').split(';')[0];
  }
});

test.after(async () => { srv.close(); fake.close(); await mongoose.disconnect(); await mem.stop(); });

test('deals: the Calendar board\'s deal / lease columns, read only; amounts and dates, no client names', async () => {
  const r = await call('GET', '/api/monday/deals', ck.boss);
  assert.strictEqual(r.status, 200, r.text);
  const d1 = r.data.deals.find((d) => d.id === '6301'), d2 = r.data.deals.find((d) => d.id === '6302'), d3 = r.data.deals.find((d) => d.id === '6303');
  assert.deepStrictEqual([d1.leadId, d1.status, d1.type, d1.contract, d1.pay, d1.exp, d1.paid, d1.comm, d1.price, d1.sp, d1.building],
    ['9001', 'Closed', 'Property Rental', ymd(-40), ymd(-10), ymd(20), 90000, 90000, 90000, 'Ely Santos', 'Lease Tower'], '"Type" is the dropdown, not the text column');
  assert.deepStrictEqual([d2.type, d2.comm, d2.paid, d2.ded], ['Property Sale', 750000, 700000, 50000]);
  assert.deepStrictEqual([d3.fin, d3.rate, d3.rst, d3.exp], ['', 45000, 'Renewal Discussion', ymd(70)], 'items without a Final Schedule are deals too; Rental Rate is a mirror');
  assert.ok(!/Test Client|\+63|@/.test(r.text), 'no client names, numbers or emails');
  // the Calendar viewings (and their pending-feedback logic) are unchanged: 6303 has no Final Schedule, so it is no viewing
  assert.ok(!(await call('GET', '/api/monday/bootstrap', ck.boss)).data.viewings.some((v) => v.id === '6303'));
});

test('deals: scoped like the rest of Monday (VA: her clients; broker: own label); needs a report screen', async () => {
  const ana = (await call('GET', '/api/monday/deals', ck.ana)).data.deals.map((d) => d.id);
  assert.ok(ana.includes('6301') && ana.includes('6303') && !ana.includes('6302'), 'Ana sees 9001 / 9006, not Bea\'s 9003');
  const b = (await call('GET', '/api/monday/deals', ck.broker)).data.deals;
  assert.ok(b.length && b.every((d) => d.sp === 'Gia Cruz' || d.leadId === '9003'), 'a broker: their own Salesperson label only');
  assert.strictEqual((await call('GET', '/api/monday/deals', ck.none)).status, 403);
  assert.strictEqual((await call('GET', '/api/monday/deals', undefined)).status, 401);
});

test('renewals log: "I sent it from respond.io" records template and time only; edit access and a visible client needed', async () => {
  const n = mutations().length, rn = fx.calls.respond.length;
  assert.strictEqual((await call('POST', '/api/leads/monday/9001/renewal-log', ck.view, { kind: 'renew30' })).status, 403, 'view access');
  assert.strictEqual((await call('POST', '/api/leads/monday/9001/renewal-log', ck.none, { kind: 'renew30' })).status, 403, 'no access');
  assert.strictEqual((await call('POST', '/api/leads/monday/9003/renewal-log', ck.ana, { kind: 'renew30' })).status, 404, 'not her client');
  for (const bad of [{ kind: 'nope' }, { kind: 'renew30', text: 'Hi there' }, {}]) assert.strictEqual((await call('POST', '/api/leads/monday/9001/renewal-log', ck.ana, bad)).status, 400, JSON.stringify(bad));
  const r = await call('POST', '/api/leads/monday/9001/renewal-log', ck.ana, { kind: 'renew30' });
  assert.strictEqual(r.status, 201, r.text);
  await call('POST', '/api/leads/monday/9001/renewal-log', ck.boss, { kind: 'movers' });
  const log = (await call('GET', '/api/renewals/log?source=monday', ck.ana)).data.log;
  assert.deepStrictEqual(log['9001'].map((e) => [e.kind, e.by]), [['movers', 'Demo Manager'], ['renew30', 'Ana Demo']], 'newest first');
  assert.ok(!(await call('GET', '/api/renewals/log?source=monday', ck.view)).data.log['9003'], 'only clients this user can see');
  assert.strictEqual((await call('GET', '/api/renewals/log?source=monday', ck.none)).status, 403);
  const stored = JSON.stringify(await RenewalLog.find({}).lean());
  assert.ok(!/Hi |Test Client|\+63/.test(stored), 'no message text or client details stored');
  assert.strictEqual(mutations().length, n, 'nothing written to Monday');
  assert.ok(fx.calls.respond.slice(rn).every((c) => c.method === 'GET'), 'nothing sent to respond.io');
});

test('daily report lines and P&L cells: kept in the portal; edit vs view vs no access; values checked', async () => {
  assert.deepStrictEqual((await call('GET', '/api/daily/notes', ck.view)).data.notes, { call: '', extra: '' });
  assert.strictEqual((await call('PUT', '/api/daily/notes', ck.view, { call: 'x' })).status, 403);
  assert.strictEqual((await call('GET', '/api/daily/notes', ck.none)).status, 403);
  assert.strictEqual((await call('PUT', '/api/daily/notes', ck.ana, { call: 'x', other: 1 })).status, 400);
  assert.strictEqual((await call('PUT', '/api/daily/notes', ck.ana, { call: 'Call the two new rent leads first' })).status, 200);
  assert.deepStrictEqual((await call('GET', '/api/daily/notes', ck.view)).data.notes, { call: 'Call the two new rent leads first', extra: '' });
  assert.strictEqual(await DailyNote.countDocuments({}), 1);
  // P&L: known lines and months only; blank clears; view-only can't change
  assert.strictEqual((await call('PUT', '/api/pl/cells', ck.ana, { line: 'cos', month: '2026-10', value: '1000' })).status, 403, 'pl view only');
  for (const bad of [{ line: 'bogus', month: '2026-10', value: 1 }, { line: 'cos', month: '2026-13', value: 1 }, { line: 'cos', month: '2026-10', value: 'abc' }, { line: 'cos', month: '2026-10', value: 1, x: 1 }]) {
    assert.strictEqual((await call('PUT', '/api/pl/cells', ck.boss, bad)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await call('PUT', '/api/pl/cells', ck.boss, { line: 'salaries', month: '2026-10', value: '₱120,000.50' })).status, 200);
  assert.deepStrictEqual((await call('GET', '/api/pl/cells', ck.ana)).data.cells, { salaries: { '2026-10': 120000.5 } });
  assert.strictEqual((await call('PUT', '/api/pl/cells', ck.boss, { line: 'salaries', month: '2026-10', value: '' })).status, 200);
  assert.strictEqual(await PlCell.countDocuments({}), 0, 'blank clears the cell');
  assert.strictEqual((await call('GET', '/api/pl/cells', ck.none)).status, 403);
});

test('shared rules: renewal templates as in the Apps Script; P&L cell validation', () => {
  assert.deepStrictEqual(SH.RENEWAL_TEMPLATES.map((t) => t.k), ['renew90', 'renew60', 'renew30', 'renewDone', 'movers', 'cleaners', 'aircon', 'repairs', 'interiors', 'furniture', 'legal']);
  assert.ok(SH.RENEWAL_TEMPLATES.every((t) => /\{firstName\}/.test(t.text)));
  assert.deepStrictEqual(SH.validatePlCell({ line: 'cos', month: '2026-01', value: null }).value, { line: 'cos', month: '2026-01', value: null });
  assert.strictEqual(SH.validatePlCell({ line: 'cos', month: '2026-01', value: 12.345 }).value.value, 12.35);
});
