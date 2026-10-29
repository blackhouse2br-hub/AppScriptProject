'use strict';
// KPI Review end to end: a throwaway in-memory MongoDB and the local fake Monday.com (no real service is contacted).
// Private-access rule: only Toby's and Jonjo's configured accounts can read or write anything in KPI Review; the shared
// Blackhouse account (a Manager) and every other signed-in member are refused by the API and see no private data.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { reviewerSlot, labelKey } = require('../src/kpiReview');
const http = require('http');
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { User, KpiSnapshot, KpiAck, KpiFeedback, Session } = require('../src/models');
const { hashPassword, sha256 } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');
const { createFakeServer } = fx;

const PW = 'correct-horse-battery';
const ARGV = ['node', 'server.js'];
const SECRET_C = 'Coaching-secret-for-Lara-1234', SECRET_F = 'Feedback-secret-from-Jonjo-5678';
const PERIOD = SH.manilaMonth(), TODAY = SH.manilaDay();
const prevPeriod = () => { const [y, m] = PERIOD.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
const fake = createFakeServer();
let mem, server, base, ids = {};

async function call(method, url, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text, cacheControl: res.headers.get('cache-control') };
}
const cookies = {};
async function login(who) {
  if (cookies[who]) return cookies[who];
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAILS[who], password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who);
  return (cookies[who] = r.headers.get('set-cookie').split(';')[0]);
}
const EMAILS = { blackhouse: 'blackhouse2br@gmail.com', manager: 'other.manager@example.com', toby: 'toby.reviewer@example.com', jonjo: 'jonjo.reviewer@example.com',
  lara: 'lara.va@example.com', ana: 'ana.va@example.com', broker: 'broker@example.com' };
const reviewUrl = (who, p = PERIOD) => `/api/kpi-review/review/${ids[who]}/${p}`;
const noSecrets = (r, what) => { assert.ok(!r.text.includes(SECRET_C) && !r.text.includes(SECRET_F), what + ' must not contain private coaching or feedback'); };

test.before(async () => {
  // Lara: her own VA label and clients on the (fake) Direct Clients board, assigned this month, plus one viewing
  const b = fx.BOARDS, leads = b['1111111'], cal = b['3333333'];
  const va = leads.columns.find((c) => c.id === 'va1'); va.settings_str = JSON.stringify({ labels: { 0: 'Ana', 1: 'Bea', 2: 'Cora Fake', 3: 'Dev Fake', 4: 'Lara' } });
  leads.items.push({ id: '9101', name: 'BH-L1', group: 'ALL CLIENTS', v: { cn: 'Lara Client One', va1: 'Lara', inq: 'Rent', cs: 'Qualified', dq: TODAY } },
    { id: '9102', name: 'BH-L2', group: 'ALL CLIENTS', v: { cn: 'Lara Client Two', va1: 'Lara', inq: 'Rent', cs: 'Failed', dq: TODAY } });
  cal.items.push({ id: '6101', name: 'Viewing L', group: 'Viewings', created: TODAY, v: { fs: TODAY, cl: { linked: ['9101'] }, b: 'Fake Tower', c: 'Makati', tm: '10:00', sp: 'Ely Santos', st: 'Done' } });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  mem = await MongoMemoryServer.create();
  ({ server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_kpi'), PORT: '0',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: fakeBase + '/monday',
    KPI_REVIEWER_TOBY_EMAIL: EMAILS.toby, KPI_REVIEWER_JONJO_EMAIL: EMAILS.jonjo.toUpperCase() }, ARGV));
  base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  const made = await User.create([
    { email: EMAILS.blackhouse, name: 'blackhouse', role: 'Manager', passwordHash },
    { email: EMAILS.manager, name: 'Other Manager', role: 'Manager', passwordHash },
    { email: EMAILS.toby, name: 'Toby', role: 'Broker', passwordHash },                // reviewer rights come from the setting, not the role
    { email: EMAILS.jonjo, name: 'Jonjo', role: 'Manager', passwordHash },
    { email: EMAILS.lara, name: 'Lara', role: 'VA', vaLabel: 'Lara', modules: { leads: 'view' }, passwordHash },
    { email: EMAILS.ana, name: 'Ana VA', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: EMAILS.broker, name: 'Some Broker', role: 'Broker', passwordHash },
  ]);
  made.forEach((u) => { ids[Object.keys(EMAILS).find((k) => EMAILS[k] === u.email)] = String(u._id); });
});
test.after(async () => { server.close(); fake.close(); await mongoose.disconnect(); await mem.stop(); });

test('settings: reviewer emails are validated; the shared Blackhouse account can never be a reviewer', () => {
  const env = { APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1/x' };
  assert.deepStrictEqual(loadConfig(env, ARGV).kpiReview.reviewers.map((r) => r.email), ['', '']);   // unset: nobody yet
  assert.throws(() => loadConfig({ ...env, KPI_REVIEWER_TOBY_EMAIL: 'Blackhouse2br@gmail.com' }, ARGV), /shared Blackhouse account/);
  assert.throws(() => loadConfig({ ...env, KPI_REVIEWER_TOBY_EMAIL: 'a@x.com', KPI_REVIEWER_JONJO_EMAIL: 'A@x.com' }, ARGV), /different people/);
  assert.throws(() => loadConfig({ ...env, KPI_REVIEWER_JONJO_EMAIL: 'toby, jonjo' }, ARGV), /one email address/);
});

test('reviewer identity: exact configured email, active member, and on Google servers a session of the linked Google account', async () => {
  const reviewers = [{ key: 'toby', label: 'Toby', email: 'toby.reviewer@example.com' }, { key: 'jonjo', label: 'Jonjo', email: 'blackhouse2br@gmail.com' }];
  const toby = await User.findById(ids.toby), bh = await User.findById(ids.blackhouse);
  const sess = (sub) => ({ subHash: sub ? sha256(sub) : '' });
  assert.strictEqual((await reviewerSlot(toby, reviewers, { google: false })).key, 'toby');
  assert.strictEqual(await reviewerSlot(toby, reviewers, { google: true, session: sess('g-toby') }), null);   // no Google account linked yet
  await User.updateOne({ _id: ids.toby }, { $set: { googleSub: 'g-toby' } });
  assert.strictEqual((await reviewerSlot(toby, reviewers, { google: true, session: sess('g-toby') })).key, 'toby');
  assert.strictEqual(await reviewerSlot(toby, reviewers, { google: true, session: sess('') }), null);          // session not from that account
  assert.strictEqual(await reviewerSlot(toby, reviewers, { google: true, session: sess('g-someone-else') }), null);
  await User.updateOne({ _id: ids.toby }, { $unset: { googleSub: 1 } });
  assert.strictEqual(await reviewerSlot({ ...toby.toObject(), active: false }, reviewers, { google: false }), null);
  assert.strictEqual(await reviewerSlot(bh, reviewers, { google: false }), null);             // even if it were configured
  assert.strictEqual(await reviewerSlot({ ...bh.toObject(), name: 'Toby' }, reviewers, { google: false }), null);   // a display name means nothing
});

test('Toby and Jonjo open KPI Review; Lara is her own employee, with the VA Management KPIs', async () => {
  for (const who of ['toby', 'jonjo']) {
    const me = (await call('GET', '/api/kpi-review/me', { cookie: await login(who) })).data;
    assert.strictEqual(me.canView, true); assert.strictEqual(me.reviewer.key, who); assert.strictEqual(me.currentPeriod, PERIOD);
  }
  const cookie = await login('toby');
  const emps = (await call('GET', '/api/kpi-review/employees', { cookie })).data.employees;
  const lara = emps.filter((e) => e.vaLabel === 'Lara');
  assert.strictEqual(lara.length, 1, 'one Lara entry');
  assert.deepStrictEqual([lara[0].employeeId, lara[0].name, lara[0].linked], [ids.lara, 'Lara', true]);
  assert.ok(emps.some((e) => e.employeeId === ids.ana), 'Ana is a separate employee');
  // a board VA label with no Team & Access member is listed on its own, without an employee ID
  const bea = emps.find((e) => e.vaLabel === 'Bea');
  assert.deepStrictEqual([bea.linked, bea.employeeId, bea.key], [false, null, labelKey('Bea')]);
  assert.ok(!emps.some((e) => e.employeeId === ids.toby || e.employeeId === ids.blackhouse), 'reviewers and Managers are not employees');

  const r = (await call('GET', reviewUrl('lara'), { cookie })).data;
  assert.strictEqual(r.employee.name, 'Lara'); assert.strictEqual(r.source, 'monday');
  const month = Object.fromEntries(r.kpis.month.map((k) => [k.key, k.value]));
  assert.deepStrictEqual(month, { clients: 2, toViewing: 50, toSale: 0, lost: 50 });
  // the same numbers VA Management shows: the shared calculation over the leads a Manager sees on the Monday screens
  const boot = (await call('GET', '/api/monday/bootstrap', { cookie: await login('blackhouse') })).data;
  const w = SH.vaWorkload(boot.leads, boot.viewings, 'Lara');
  assert.deepStrictEqual(Object.fromEntries(r.kpis.current.map((k) => [k.key, k.value])), w);
  assert.strictEqual(r.kpis.current.find((k) => k.key === 'leads').label, 'Leads');
  // a VA label with no member yet: reviewable too (kept under the label); a label not on the board is not
  const b = (await call('GET', `/api/kpi-review/review/${labelKey('Bea')}/${PERIOD}`, { cookie })).data;
  assert.strictEqual(b.employee.linked, false); assert.strictEqual(b.can.write, true);
  assert.strictEqual((await call('GET', `/api/kpi-review/review/${labelKey('Nobody Such')}/${PERIOD}`, { cookie })).status, 404);
  assert.strictEqual((await call('PUT', `/api/kpi-review/review/${labelKey('Nobody Such')}/${PERIOD}/feedback`, { cookie, body: { coaching: 'x', feedback: '', version: 0 } })).status, 404);
});

test('Toby and Jonjo save independently, each only their own column; edits are concurrency-safe and persist', async () => {
  const toby = await login('toby'), jonjo = await login('jonjo');
  const t1 = await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: SECRET_C, feedback: 'Toby feedback', version: 0 } });
  assert.strictEqual(t1.status, 200, JSON.stringify(t1.data));
  assert.deepStrictEqual([t1.data.review.reviewerKey, t1.data.review.author.name, t1.data.review.version], ['toby', 'Toby', 1]);
  const j1 = await call('PUT', reviewUrl('lara') + '/feedback', { cookie: jonjo, body: { coaching: '', feedback: SECRET_F, version: 0 } });
  assert.strictEqual(j1.status, 200);
  // after a "refresh", both columns are there, unchanged by each other; both reviewers can read both
  for (const c of [toby, jonjo]) {
    const r = (await call('GET', reviewUrl('lara'), { cookie: c })).data;
    assert.strictEqual(r.reviews.toby.coaching, SECRET_C); assert.strictEqual(r.reviews.toby.feedback, 'Toby feedback');
    assert.strictEqual(r.reviews.jonjo.feedback, SECRET_F); assert.strictEqual(r.reviews.jonjo.author.name, 'Jonjo');
  }
  // the column comes from the session: a request can't name another reviewer, author or role
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: jonjo, body: { coaching: 'x', feedback: 'y', version: 1, reviewerKey: 'toby' } })).status, 400);
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: jonjo, body: { coaching: 'x', feedback: 'y', version: 1, author: 'Toby' } })).status, 400);
  // a stale version (another tab saved first) is refused and nothing is overwritten
  const t2 = await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: SECRET_C, feedback: 'Toby feedback v2', version: 1 } });
  assert.strictEqual(t2.status, 200); assert.strictEqual(t2.data.review.version, 2);
  const stale = await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: 'old tab', feedback: 'old tab', version: 1 } });
  assert.strictEqual(stale.status, 409); assert.strictEqual(stale.data.review.feedback, 'Toby feedback v2');
  // two first saves at the same moment: one is saved, the other is told to reload
  const both = await Promise.all([0, 1].map((i) => call('PUT', reviewUrl('ana') + '/feedback', { cookie: toby, body: { coaching: 'c' + i, feedback: '', version: 0 } })));
  assert.deepStrictEqual(both.map((x) => x.status).sort(), [200, 409]);
  // validation
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: 'x'.repeat(4001), feedback: '', version: 2 } })).status, 400);
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: { $set: 1 }, feedback: '', version: 2 } })).status, 400);
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: '', feedback: '  ', version: 2 } })).status, 400);
  assert.strictEqual((await call('GET', reviewUrl('lara', '2026-13'), { cookie: toby })).status, 400);
  const [y, m] = PERIOD.split('-').map(Number), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  assert.strictEqual((await call('GET', reviewUrl('lara', next), { cookie: toby })).status, 400);   // a future month
  assert.strictEqual((await call('GET', `/api/kpi-review/review/${ids.broker}/${PERIOD}`, { cookie: toby })).status, 404);   // not a VA
});

test('PRIVATE: the Blackhouse account, other Managers and every other member get no KPI Review data from any route', async () => {
  const routes = [['GET', '/api/kpi-review/employees'], ['GET', reviewUrl('lara')], ['GET', `/api/kpi-review/review/${labelKey('Bea')}/${PERIOD}`],
    ['PUT', reviewUrl('lara') + '/feedback', { coaching: 'x', feedback: 'y', version: 0 }], ['POST', reviewUrl('lara') + '/discussed', {}],
    ['GET', '/api/kpi-review/snapshots'], ['GET', '/api/kpi-review/snapshots/' + PERIOD], ['POST', '/api/kpi-review/snapshots', { period: PERIOD }]];
  for (const who of ['blackhouse', 'manager', 'broker', 'ana', 'lara']) {
    const cookie = await login(who);
    const me = await call('GET', '/api/kpi-review/me', { cookie });
    assert.strictEqual(me.data.canView, false, who + ' must not open KPI Review');
    assert.deepStrictEqual(Object.keys(me.data).sort(), ['canAck', 'canView'].concat(me.data.canAck ? ['timezone'] : []).sort(), who + ': /me says only "no"');
    for (const [method, url, body] of routes) {
      const r = await call(method, url, { cookie, body });
      assert.strictEqual(r.status, 403, `${who} ${method} ${url} → ${r.status}`);
      noSecrets(r, `${who} ${method} ${url}`);
      assert.match(r.data.error, /private to Toby's and Jonjo's/);
    }
  }
  // signed out: nothing at all
  for (const [method, url, body] of routes) assert.strictEqual((await call(method, url, { body })).status, 401);
  // the Blackhouse account keeps its existing permissions everywhere else
  const bh = await login('blackhouse');
  assert.strictEqual((await call('GET', '/api/bootstrap', { cookie: bh })).status, 200);
  assert.strictEqual((await call('GET', '/api/team', { cookie: bh })).status, 200);
  noSecrets(await call('GET', '/api/bootstrap', { cookie: bh }), 'bootstrap');
  noSecrets(await call('GET', '/api/team', { cookie: bh }), 'team');
  // and nothing private is cacheable
  assert.strictEqual((await call('GET', reviewUrl('lara'), { cookie: await login('toby') })).cacheControl, 'no-store');
});

test('discussion: the reviewer\'s record is separate; only Lara, signed in as herself, can acknowledge, without seeing the review', async () => {
  const toby = await login('toby'), lara = await login('lara');
  const d = await call('POST', reviewUrl('lara') + '/discussed', { cookie: toby, body: {} });
  assert.strictEqual(d.status, 200); assert.ok(d.data.review.discussedAt); assert.strictEqual(d.data.review.discussedBy.name, 'Toby');
  assert.strictEqual((await call('GET', reviewUrl('lara'), { cookie: toby })).data.ack, null, 'a reviewer record is not the employee\'s acknowledgment');

  // the reviewers (and Managers) can't acknowledge for her; another VA can't either
  for (const who of ['toby', 'jonjo', 'blackhouse']) assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${PERIOD}`, { cookie: await login(who), body: { confirm: true } })).status, 403, who);
  assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${PERIOD}`, { cookie: await login('ana'), body: { confirm: true } })).status, 201, 'Ana acknowledges only her own month');   // Toby wrote for Ana above
  assert.strictEqual((await call('GET', reviewUrl('lara'), { cookie: toby })).data.ack, null);

  // Lara sees only that a review exists for the month: no text, KPIs or reviewer discussion records
  const mine = await call('GET', '/api/kpi-review/my-acknowledgments', { cookie: lara });
  assert.deepStrictEqual(mine.data, { months: [{ period: PERIOD, acknowledged: false, at: null }] });
  noSecrets(mine, 'Lara\'s acknowledgment list');
  assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${PERIOD}`, { cookie: lara, body: {} })).status, 400);
  assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${prevPeriod()}`, { cookie: lara, body: { confirm: true } })).status, 409);   // nothing to acknowledge
  const a = await call('POST', `/api/kpi-review/my-acknowledgments/${PERIOD}`, { cookie: lara, body: { confirm: true } });
  assert.strictEqual(a.status, 201); noSecrets(a, 'acknowledgment reply');
  assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${PERIOD}`, { cookie: lara, body: { confirm: true } })).status, 409);
  const rv = (await call('GET', reviewUrl('lara'), { cookie: toby })).data;
  assert.strictEqual(rv.ack.by.name, 'Lara'); assert.strictEqual(rv.ack.by.userId, ids.lara); assert.ok(rv.ack.at);
  assert.ok(rv.reviews.toby.discussedAt, 'both records shown, separately');
  await assert.rejects(KpiAck.updateOne({ employeeId: ids.lara }, { $set: { 'by.name': 'Someone else' } }), /read-only/);
});

test('snapshots: reviewers only, one per month even when requested at once, read-only, unchanged by later edits', async () => {
  const toby = await login('toby'), jonjo = await login('jonjo'), boss = await login('blackhouse');
  const s = await call('POST', '/api/kpi-review/snapshots', { cookie: toby, body: { period: PERIOD } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.data));
  const lara = s.data.snapshot.employees.find((e) => e.employeeId === ids.lara);
  assert.strictEqual(lara.name, 'Lara'); assert.strictEqual(lara.vaLabel, 'Lara');
  assert.strictEqual(lara.kpis.month.find((k) => k.key === 'lost').value, 50);
  assert.deepStrictEqual(lara.reviews.map((r) => [r.reviewerKey, r.reviewer.name, r.reviewer.email]).sort(), [['jonjo', 'Jonjo', EMAILS.jonjo], ['toby', 'Toby', EMAILS.toby]]);
  assert.strictEqual(lara.reviews.find((r) => r.reviewerKey === 'toby').feedback, 'Toby feedback v2');
  assert.deepStrictEqual([lara.ack.status, lara.ack.by.name], ['acknowledged', 'Lara']);
  assert.strictEqual(s.data.snapshot.employees.find((e) => e.vaLabel === 'Bea').ack.status, 'not_available');
  assert.strictEqual(s.data.snapshot.createdBy.as, 'reviewer:toby');
  // never replaced
  const dup = await call('POST', '/api/kpi-review/snapshots', { cookie: jonjo, body: { period: PERIOD } });
  assert.strictEqual(dup.status, 409); assert.match(dup.data.error, /already exists/);
  // concurrent requests for another month: exactly one snapshot
  const many = await Promise.all([toby, jonjo, toby, jonjo, toby].map((c) => call('POST', '/api/kpi-review/snapshots', { cookie: c, body: { period: prevPeriod() } })));
  assert.deepStrictEqual(many.map((x) => x.status).sort(), [201, 409, 409, 409, 409]);
  assert.strictEqual(await KpiSnapshot.countDocuments({ period: prevPeriod() }), 1);

  // live changes after the snapshot: a new name, new comments, a KPI change (portal Failed override on a Lara client)
  await User.updateOne({ _id: ids.lara }, { $set: { name: 'Lara Renamed' } });
  const cur = (await call('GET', reviewUrl('lara'), { cookie: toby })).data.reviews.toby.version;
  assert.strictEqual((await call('PUT', reviewUrl('lara') + '/feedback', { cookie: toby, body: { coaching: 'changed', feedback: 'changed', version: cur } })).status, 200);
  assert.strictEqual((await call('PUT', '/api/leads/monday/9101/override', { cookie: boss, body: { reason: 'Test: not responsive' } })).status, 200);
  const live = (await call('GET', reviewUrl('lara'), { cookie: toby })).data;
  assert.strictEqual(live.employee.name, 'Lara Renamed'); assert.strictEqual(live.kpis.month.find((k) => k.key === 'lost').value, 100);
  const kept = (await call('GET', '/api/kpi-review/snapshots/' + PERIOD, { cookie: jonjo })).data.snapshot.employees.find((e) => e.employeeId === ids.lara);
  assert.strictEqual(kept.name, 'Lara');
  assert.strictEqual(kept.kpis.month.find((k) => k.key === 'lost').value, 50);
  assert.strictEqual(kept.reviews.find((r) => r.reviewerKey === 'toby').feedback, 'Toby feedback v2');
  assert.strictEqual(kept.ack.status, 'acknowledged');
  assert.deepStrictEqual((await call('GET', '/api/kpi-review/snapshots', { cookie: jonjo })).data.snapshots.map((x) => x.period), [PERIOD, prevPeriod()]);
  // read-only at the model level too
  const doc = await KpiSnapshot.findOne({ period: PERIOD });
  await assert.rejects(KpiSnapshot.updateOne({ _id: doc._id }, { $set: { 'employees.0.name': 'x' } }), /read-only/);
  doc.employees[0].name = 'x'; await assert.rejects(doc.save(), /read-only/);
  await assert.rejects(KpiSnapshot.deleteOne({ _id: doc._id }), /read-only/);
  assert.strictEqual((await call('POST', '/api/kpi-review/snapshots', { cookie: toby, body: { period: '2020-01' } })).status, 400);
  assert.strictEqual((await call('GET', '/api/kpi-review/snapshots/' + '2025-01', { cookie: toby })).status, 404);
});

test('versions: discussion records and acknowledgments name the text they covered; both reviewers can save at once', async () => {
  const toby = await login('toby'), jonjo = await login('jonjo'), p = prevPeriod();
  const both = await Promise.all([toby, jonjo].map((cookie, i) => call('PUT', reviewUrl('lara', p) + '/feedback', { cookie, body: { coaching: 'c' + i, feedback: '', version: 0 } })));
  assert.deepStrictEqual(both.map((x) => x.status), [200, 200]);
  assert.deepStrictEqual((await KpiFeedback.find({ employeeId: ids.lara, period: p })).map((f) => f.reviewerKey).sort(), ['jonjo', 'toby']);
  const r = (await call('GET', reviewUrl('lara'), { cookie: toby })).data;
  assert.strictEqual(r.reviews.toby.discussedVersion, 2, 'the discussion record names the version discussed');
  assert.ok(r.reviews.toby.version > r.reviews.toby.discussedVersion, 'later edits show as made after it');
  assert.deepStrictEqual(r.ack.reviewVersions, { toby: 2, jonjo: 1 });
  assert.strictEqual(r.ack.by.email, EMAILS.lara);
  // write-once also against bulk writes, and the unique index alone stops a second snapshot
  await assert.rejects(KpiAck.bulkWrite([{ updateOne: { filter: { employeeId: ids.lara }, update: { $set: { 'by.name': 'x' } } } }]), /read-only/);
  const twice = await Promise.allSettled([0, 1].map(() => KpiSnapshot.create({ period: '2025-01', scope: SH.KPI_REVIEW.scope, timezone: 'Asia/Manila', source: 'mongo', createdBy: { name: 't' }, employees: [] })));
  assert.deepStrictEqual(twice.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
  assert.strictEqual(twice.find((x) => x.status === 'rejected').reason.code, 11000);
});

test('Google server: a Manager can\'t turn a kept session into a reviewer by swapping emails in Team & Access', async () => {
  // a local fake Google (token endpoint + signing keys); no real Google service is contacted
  const signer = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), CID = '123-kpi.apps.googleusercontent.com';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  let claimsFor = () => ({});
  const g = http.createServer((req, res) => {
    if (req.url === '/certs') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ keys: [{ ...signer.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] })); }
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { const head = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64(claimsFor()); res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id_token: head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), signer.privateKey).toString('base64url') })); });
  });
  await new Promise((r) => g.listen(0, '127.0.0.1', r));
  const gb = `http://127.0.0.1:${g.address().port}`;
  const app = createApp(loadConfig({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_kpi'), PORT: '0', AUTH_PROVIDER: 'google', GOOGLE_CLIENT_ID: CID, GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_AUTH_URL: gb + '/auth', GOOGLE_TOKEN_URL: gb + '/token', GOOGLE_JWKS_URL: gb + '/certs', KPI_REVIEWER_TOBY_EMAIL: 'toby.g@example.com', KPI_REVIEWER_JONJO_EMAIL: EMAILS.jonjo }, ARGV));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const gbase = `http://127.0.0.1:${srv.address().port}`;
  const req = async (method, url, cookie, body) => { const r = await fetch(gbase + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (e) { /* none */ } return { status: r.status, data }; };
  const signIn = async (sub, email) => {
    const s = await fetch(gbase + '/api/auth/google/start', { redirect: 'manual' }), q = Object.fromEntries(new URL(s.headers.get('location')).searchParams);
    claimsFor = () => ({ iss: 'https://accounts.google.com', aud: CID, exp: Math.floor(Date.now() / 1000) + 600, nonce: q.nonce, email_verified: true, sub, email });
    const browser = s.headers.getSetCookie().find((x) => x.startsWith('bh_oauth=')).split(';')[0];
    const cb = await fetch(`${gbase}/api/auth/google/callback?code=c&state=${encodeURIComponent(q.state)}`, { redirect: 'manual', headers: { cookie: browser } });
    const sid = (cb.headers.getSetCookie().find((x) => x.startsWith('bh_sid=')) || '').split(';')[0];
    assert.ok(sid, `Google sign-in for ${email} returned to ${cb.headers.get('location')}`);
    return sid;
  };
  try {
    const gToby = await User.create({ email: 'toby.g@example.com', name: 'Toby G', role: 'Broker' });
    const tobyCookie = await signIn('g-toby', 'toby.g@example.com');
    assert.strictEqual((await req('GET', '/api/kpi-review/me', tobyCookie)).data.canView, true, 'Toby\'s own Google sign-in opens KPI Review');
    assert.strictEqual((await req('GET', '/api/kpi-review/employees', tobyCookie)).status, 200);
    // a session not started by Toby's linked Google account (e.g. created another way) is not a reviewer session
    const token = crypto.randomBytes(32).toString('base64url');
    await Session.create({ tokenHash: sha256(token), userId: gToby._id, expiresAt: new Date(Date.now() + 3600e3) });
    assert.strictEqual((await req('GET', '/api/kpi-review/employees', 'bh_sid=' + token)).status, 403);

    // the takeover attempt: the Blackhouse Manager moves Toby to another address and takes Toby's address themselves
    const bhCookie = await signIn('g-blackhouse', EMAILS.blackhouse);
    assert.strictEqual((await req('GET', '/api/kpi-review/employees', bhCookie)).status, 403);
    assert.strictEqual((await req('PATCH', '/api/team/' + gToby.id, bhCookie, { name: 'Toby G', email: 'toby.old@example.com', role: 'Broker' })).status, 200);
    assert.strictEqual((await req('PATCH', '/api/team/' + ids.blackhouse, bhCookie, { name: 'Toby', email: 'toby.g@example.com', role: 'Manager' })).status, 200);
    const me = await req('GET', '/api/kpi-review/me', bhCookie);
    assert.strictEqual(me.status, 200, 'their own session is kept (existing Team & Access behaviour)');
    assert.strictEqual(me.data.canView, false, 'but it is not a reviewer session');
    assert.strictEqual((await req('GET', '/api/kpi-review/employees', bhCookie)).status, 403);
    // the real Toby then signs in: his Google account is linked to that record, and every older session on it ends
    const toby2 = await signIn('g-toby', 'toby.g@example.com');
    assert.strictEqual((await req('GET', '/api/session', bhCookie)).status, 401, 'the Manager\'s kept session ended');
    assert.strictEqual((await req('GET', '/api/kpi-review/me', toby2)).data.canView, true);
  } finally {
    srv.close(); g.close();
    await User.updateOne({ _id: ids.blackhouse }, { $set: { email: EMAILS.blackhouse, name: 'blackhouse' }, $unset: { googleSub: 1 } });
  }
});

test('Toby and Jonjo each save their own Coaching and Feedback for every VA and month; both read both; nobody overwrites the other', async () => {
  const toby = await login('toby'), jonjo = await login('jonjo');
  const [y, m] = PERIOD.split('-').map(Number), back = (n) => new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
  const months = [back(2), back(3)], vas = [['Lara (member)', ids.lara], ['Ana (member)', ids.ana], ['Bea (VA label only)', labelKey('Bea')], ['Cora (VA label only)', labelKey('Cora Fake')]];
  for (const [name, key] of vas) for (const p of months) {
    const url = `/api/kpi-review/review/${key}/${p}/feedback`;
    const t = await call('PUT', url, { cookie: toby, body: { coaching: `Toby coaching ${name} ${p}`, feedback: `Toby feedback ${name} ${p}`, version: 0 } });
    const j = await call('PUT', url, { cookie: jonjo, body: { coaching: `Jonjo coaching ${name} ${p}`, feedback: `Jonjo feedback ${name} ${p}`, version: 0 } });
    assert.deepStrictEqual([t.status, j.status], [200, 200], `${name} ${p}: ${JSON.stringify([t.data, j.data])}`);
  }
  // both reviewers read both sections, each with its author and time
  for (const c of [toby, jonjo]) for (const [name, key] of vas) for (const p of months) {
    const r = (await call('GET', `/api/kpi-review/review/${key}/${p}`, { cookie: c })).data;
    assert.strictEqual(r.reviews.toby.coaching, `Toby coaching ${name} ${p}`); assert.strictEqual(r.reviews.toby.author.name, 'Toby'); assert.ok(r.reviews.toby.updatedAt);
    assert.strictEqual(r.reviews.jonjo.feedback, `Jonjo feedback ${name} ${p}`); assert.strictEqual(r.reviews.jonjo.author.name, 'Jonjo');
  }
  // a reviewer's save only ever reaches their own section: Jonjo's update leaves Toby's text as it was
  const bea = `/api/kpi-review/review/${labelKey('Bea')}/${months[0]}`;
  const jv = (await call('GET', bea, { cookie: jonjo })).data.reviews.jonjo.version;
  assert.strictEqual((await call('PUT', bea + '/feedback', { cookie: jonjo, body: { coaching: 'Jonjo v2', feedback: 'Jonjo v2', version: jv } })).status, 200);
  const after = (await call('GET', bea, { cookie: toby })).data;
  assert.deepStrictEqual([after.reviews.toby.coaching, after.reviews.jonjo.coaching], [`Toby coaching Bea (VA label only) ${months[0]}`, 'Jonjo v2']);
  assert.strictEqual((await call('PUT', bea + '/feedback', { cookie: jonjo, body: { coaching: 'x', feedback: 'y', version: 1, reviewerKey: 'toby' } })).status, 400);
  // the reviewers' discussion record works for a VA label too
  assert.strictEqual((await call('POST', bea + '/discussed', { cookie: toby, body: {} })).status, 200);
  // nobody else can read or change any of it (the Blackhouse account signs in afresh: the Google test above ended its sessions)
  delete cookies.blackhouse;
  for (const who of ['blackhouse', 'manager', 'ana', 'lara', 'broker']) {
    const c = await login(who);
    assert.strictEqual((await call('GET', bea, { cookie: c })).status, 403, who);
    assert.strictEqual((await call('PUT', bea + '/feedback', { cookie: c, body: { coaching: 'x', feedback: 'y', version: 0 } })).status, 403, who);
  }
  assert.strictEqual((await call('GET', bea)).status, 401);
  // when Bea is added in Team & Access, the reviews written under her label move to her record; she can then acknowledge
  const beaUser = await User.create({ email: 'bea.va@example.com', name: 'Bea VA', role: 'VA', vaLabel: 'Bea', passwordHash: await hashPassword(PW) });
  EMAILS.bea = 'bea.va@example.com';
  const moved = (await call('GET', `/api/kpi-review/review/${beaUser.id}/${months[0]}`, { cookie: toby })).data;
  assert.deepStrictEqual([moved.reviews.toby.coaching, moved.reviews.jonjo.coaching, !!moved.reviews.toby.discussedAt], [`Toby coaching Bea (VA label only) ${months[0]}`, 'Jonjo v2', true]);
  assert.strictEqual((await call('GET', bea, { cookie: toby })).status, 404, 'the label now belongs to a member');
  const beaCookie = await login('bea');
  assert.deepStrictEqual((await call('GET', '/api/kpi-review/my-acknowledgments', { cookie: beaCookie })).data.months.map((x) => x.period).sort(), months.slice().sort());
  assert.strictEqual((await call('POST', `/api/kpi-review/my-acknowledgments/${months[0]}`, { cookie: beaCookie, body: { confirm: true } })).status, 201);
  // a snapshot keeps label-only VAs' reviews too
  const s = await call('POST', '/api/kpi-review/snapshots', { cookie: jonjo, body: { period: months[1] } });
  assert.strictEqual(s.status, 201, JSON.stringify(s.data));
  const cora = s.data.snapshot.employees.find((e) => e.vaLabel === 'Cora Fake');
  assert.deepStrictEqual(cora.reviews.map((r) => r.reviewerKey).sort(), ['jonjo', 'toby']);
});

test('label edge cases: a shared label moves nothing; a blocked move stays visible; label variants', async () => {
  const toby = await login('toby'), jonjo = await login('jonjo');
  const [y, m] = PERIOD.split('-').map(Number), p = new Date(Date.UTC(y, m - 5, 1)).toISOString().slice(0, 7);
  // Cora Fake: written under the label, then a member is added who already has a review for that month (blocked move)
  const coraKey = labelKey('Cora Fake');
  assert.strictEqual((await call('PUT', `/api/kpi-review/review/${coraKey}/${p}/feedback`, { cookie: toby, body: { coaching: 'Under the label', feedback: '', version: 0 } })).status, 200);
  const cora = await User.create({ email: 'cora.va@example.com', name: 'Cora VA', role: 'VA', vaLabel: 'Cora Fake', passwordHash: await hashPassword(PW) });
  await KpiFeedback.create({ employeeId: cora._id, period: p, reviewerKey: 'toby', coaching: 'Already on the member', author: { userId: ids.toby, name: 'Toby' }, createdBy: { userId: ids.toby, name: 'Toby' } });
  const r = (await call('GET', `/api/kpi-review/review/${cora.id}/${p}`, { cookie: jonjo })).data;
  assert.strictEqual(r.reviews.toby.coaching, 'Already on the member', 'never overwritten');
  assert.deepStrictEqual(r.unmoved.map((x) => x.coaching), ['Under the label'], 'the blocked one is shown, not lost');
  // two members with one label: reviews under it stay put
  const dev1 = await User.create({ email: 'dev1@example.com', name: 'Dev One', role: 'VA', vaLabel: 'Dev Fake', passwordHash: await hashPassword(PW) });
  await User.create({ email: 'dev2@example.com', name: 'Dev Two', role: 'VA', vaLabel: 'dev fake', passwordHash: await hashPassword(PW) });
  const subject = new mongoose.Types.ObjectId(require('crypto').createHash('sha256').update('kpi-va-label:' + SH.vaKey('Dev Fake')).digest('hex').slice(0, 24));
  await KpiFeedback.create({ employeeId: subject, period: p, reviewerKey: 'jonjo', coaching: 'Shared label review', author: { userId: ids.jonjo, name: 'Jonjo' }, createdBy: { userId: ids.jonjo, name: 'Jonjo' } });
  await call('GET', `/api/kpi-review/review/${dev1.id}/${p}`, { cookie: toby });
  assert.strictEqual(await KpiFeedback.countDocuments({ employeeId: subject }), 1, 'not moved to either member');
});
