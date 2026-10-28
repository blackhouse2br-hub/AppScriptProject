'use strict';
// Viewing results and Pending Broker Feedback (src/integrations/viewingResult.js), against the local FAKE Monday API only.
// Proves: pending-list rules (both sources, 12 Oct 2026 / 60 days, visibility, de-duplication); a Monday Calendar viewing's
// result writes only its Status (+ LOI Creation Date for an LOI) on Monday after confirmation, keeps reasons / feedback /
// LOI confidence in the portal, refuses anything else before Monday is contacted, and never saves to MongoDB alone when
// Monday refuses; portal bookings keep their result in MongoDB; the feedback rules shape suggestions. Fictional data only.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, Lead, Listing, Viewing, Note, MondayWrite, ViewingResult } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { WRITE_MUTATION } = require('../src/integrations/monday');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const BOARDS = { leads: '1111111', listings: '2222222', calendar: '3333333' };
const DAY = 864e5;
const ymd = (n) => { const d = new Date(Date.now() + n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// fictional Calendar board for this file: the real board's column kinds and Status labels
const C = fx.BOARDS['3333333'];
C.columns.find((c) => c.id === 'st').settings_str = JSON.stringify({ labels: { 0: 'Viewing Scheduled', 1: 'Under Negotiations', 2: 'Failed', 3: 'Closed', 4: 'Pending', 5: 'Confirmed' } });
C.columns.push({ id: 'lcd', title: 'LOI Creation Date', type: 'date', settings_str: '{}' }, { id: 'fbk', title: 'Broker Feedback', type: 'text', settings_str: '{}' },
  // the real board's two "Remarks" columns, and two text columns sharing a title: none may receive feedback
  { id: 'remarks__1', title: 'Remarks', type: 'long_text', settings_str: '{}' }, { id: 'status_18', title: 'Remarks', type: 'status', settings_str: '{}' },
  { id: 'notes_a', title: 'Broker Notes', type: 'text', settings_str: '{}' }, { id: 'notes_b', title: 'Broker Notes', type: 'text', settings_str: '{}' });
const cal = (id, days, lead, st, extra) => C.items.push({ id, name: 'Viewing ' + id, group: 'Viewings', created: ymd(days - 3), v: { fs: ymd(days), ...(lead ? { cl: { linked: [lead] } } : {}), b: 'Tower ' + id, c: 'Makati', tm: '10:00', sp: 'Ely Santos', st, ...(extra || {}) } });
cal('6101', -3, '9001', 'Viewing Scheduled');            // pending (Ana's client)
cal('6102', -4, '9006', 'Failed');                       // result already on Monday
cal('6103', 3, '9001', 'Viewing Scheduled');             // in the future
cal('6104', -5, '9003', 'Viewing Scheduled');            // pending, Bea's client
cal('6105', -2, '9001', 'Viewing Scheduled', { dl: ymd(-1) });   // LOI already submitted
cal('6106', -75, '9001', 'Viewing Scheduled');           // older than the window
cal('6107', -3, '', 'Viewing Scheduled');                // no client linked
cal('6108', -6, '9006', 'Viewing Scheduled');            // same viewing booked in the portal (below)
cal('6109', -7, '9001', 'Viewing Scheduled');            // pending (failure / feedback-column tests)
cal('6110', -4, '9003', 'Viewing Scheduled', { sp: 'Gia Cruz' });   // another broker's viewing
cal('6111', -5, '9001', 'Viewing Scheduled');            // relinked on Monday after the page loaded
cal('6112', -2, '9001', 'Viewing Scheduled');            // rate-limit test
cal('6113', -3, '9001', 'Viewing Scheduled');            // Failed with Monday writes off
cal('6114', -4, '9001', 'Viewing Scheduled');            // Create LOI with a feedback column
cal('6115', -5, '9001', 'Viewing Scheduled');            // Create LOI with an unusable feedback column

const fake = fx.createFakeServer();
let failNextMutation = false, passBeforeFail = 0;   // passBeforeFail: let that many mutations through, then fail the next
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (failNextMutation && /"query":"\s*mutation/.test(body) && passBeforeFail > 0) { passBeforeFail--; failNextMutation = true; }
    else if (failNextMutation && /"query":"\s*mutation/.test(body)) { failNextMutation = false; fx.calls.monday.push({ method: 'POST', body: JSON.parse(body), failed: true }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ errors: [{ message: 'Internal server error' }] })); }
    const r = await fetch(`http://127.0.0.1:${fake.address().port}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
});

let mem, main, on, extra = [], ck = {}, ids = {};
const env = (over) => ({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_vr'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: BOARDS.leads,
  MONDAY_LISTINGS_BOARD_ID: BOARDS.listings, MONDAY_CALENDAR_BOARD_ID: BOARDS.calendar, MONDAY_API_URL: `http://127.0.0.1:${proxy.address().port}/monday`, ...over });
async function instance(over) {
  const app = createApp(loadConfig(env(over), ARGV));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); extra.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
async function call(base, method, url, cookie, body) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}
const mutations = () => fx.calls.monday.filter((c) => /^\s*mutation\b/.test(c.body.query));
const result = (base, who, id, body, src = 'monday') => call(base, 'POST', `/api/viewings/${src}/${id}/result`, who, body);
const pending = async (base, who) => (await call(base, 'GET', '/api/calendar/pending', who));
const keys = (rows) => rows.map((r) => r.src + ':' + r.id);

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r)); await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  ({ server: main } = await start(env({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60' }), ARGV));
  on = `http://127.0.0.1:${main.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Demo Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', calendar: 'edit' }, passwordHash },
    { email: 'viewer@example.com', name: 'View Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view', calendar: 'view' }, passwordHash },
    { email: 'nocal@example.com', name: 'Nocal Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit' }, passwordHash },
    { email: 'broker@example.com', name: 'Ely Santos', role: 'Broker', modules: { leads: 'view', calendar: 'edit' }, passwordHash },
  ]);
  for (const k of ['boss', 'ana', 'viewer', 'nocal', 'broker']) {
    const r = await fetch(on + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: k + '@example.com', password: PW }) });
    ck[k] = r.headers.get('set-cookie').split(';')[0];
  }
  // portal bookings (MongoDB); one client is the Monday lead 9006 (same viewing as Calendar item 6108)
  const [la, lb] = await Lead.create([{ code: 'PT-1', name: 'Portal Client One', mondayItemId: '9006' }, { code: 'PT-2', name: 'Portal Client Two' }]);
  const [x] = await Listing.create([{ code: 'L-1', building: 'Portal Tower', type: 'For Rent', city: 'Makati', price: 90000, sizeSqm: 40, bedrooms: '1' }]);
  const vs = await Viewing.create([
    { leadId: la._id, listingId: x._id, date: ymd(-6), time: '10:00', broker: 'Ely Santos', status: 'Confirmed' },    // pending
    { leadId: lb._id, listingId: x._id, date: ymd(-2), time: '15:00', broker: 'Ely Santos', status: 'Proposed' },     // never confirmed
    { leadId: lb._id, listingId: x._id, date: '2026-10-05', time: '10:00', broker: 'Ely Santos', status: 'Done' },     // before 12 Oct 2026
    { leadId: lb._id, listingId: x._id, date: ymd(-3), time: '11:00', broker: 'Ely Santos', status: 'Done', outcome: 'failed', feedback: 'x' },   // has a result
  ]);
  ids = { portal: String(vs[0]._id), proposed: String(vs[1]._id), old: String(vs[2]._id), withResult: String(vs[3]._id), leadA: String(la._id) };
  await call(on, 'GET', '/api/monday/bootstrap', ck.boss);   // load the fake boards into the server's memory
});
test.after(async () => { main.close(); extra.forEach((s) => s.close()); fake.close(); proxy.close(); await mongoose.disconnect(); await mem.stop(); });

test('pending: happened, no result, from 12 Oct 2026 / last 60 days, visible, not past the viewing stage, no duplicate', async () => {
  const r = await pending(on, ck.boss);
  assert.strictEqual(r.status, 200, r.text);
  const k = keys(r.data.rows);
  for (const want of ['monday:6101', 'monday:6104', 'monday:6109', 'mongo:' + ids.portal]) assert.ok(k.includes(want), want + ' listed');
  for (const not of ['monday:6102', 'monday:6103', 'monday:6105', 'monday:6106', 'monday:6107', 'monday:6108', 'mongo:' + ids.proposed, 'mongo:' + ids.old, 'mongo:' + ids.withResult]) assert.ok(!k.includes(not), not + ' not listed');
  assert.deepStrictEqual(r.data.rows.map((x) => x.when), r.data.rows.map((x) => x.when).slice().sort((a, b) => b - a), 'newest first');
  assert.ok(Date.parse(r.data.since) >= Date.parse('2026-10-12T00:00:00+08:00'));
  assert.ok(!/Test Client|Portal Client|\+63/.test(r.text), 'no client names or phone numbers in the list');
  // visibility: a VA sees only her clients' viewings; view access can read; no Calendar access can't; signed out can't
  const a = keys((await pending(on, ck.ana)).data.rows);
  assert.ok(a.includes('monday:6101') && !a.includes('monday:6104'));
  assert.strictEqual((await pending(on, ck.viewer)).status, 200);
  assert.strictEqual((await pending(on, ck.nocal)).status, 403);
  assert.strictEqual((await pending(on, undefined)).status, 401);
});

test('Monday result: refused before reaching Monday (values, fields, access, visibility, confirmation, stale page)', async () => {
  const n = mutations().length, ok = { outcome: 'loi', conf: 60, expect: 'Viewing Scheduled', confirm: true }, failed = { outcome: 'failed', tags: ['too_small'] };
  const refusals = [
    [ck.boss, '6101', { ...ok, outcome: 'closed' }, 400], [ck.boss, '6101', { ...ok, outcome: 'Under Negotiations' }, 400], [ck.boss, '6101', { ...ok, outcome: 'Failed' }, 400],
    [ck.boss, '6101', { ...ok, tags: ['nope'] }, 400], [ck.boss, '6101', { ...ok, tags: 'too_small' }, 400],
    [ck.boss, '6101', { ...ok, feedback: 'x'.repeat(1001) }, 400], [ck.boss, '6101', { ...ok, feedback: 5 }, 400],
    [ck.boss, '6101', { ...ok, conf: undefined }, 400],                                // LOI needs a confidence level
    [ck.boss, '6101', { ...ok, conf: 101 }, 400],
    [ck.boss, '6101', { ...failed, tags: [], feedback: '' }, 400],                     // Failed needs a reason or text
    [ck.boss, '6101', { ...failed, conf: 50 }, 400],                                   // confidence only for an LOI
    [ck.boss, '6101', { ...ok, status: 'Closed' }, 400], [ck.boss, '6101', { ...ok, columnId: 'st' }, 400], [ck.boss, '6101', { ...ok, board: '1111111' }, 400],
    [ck.boss, '6101', { ...ok, expect: 5 }, 400], [ck.boss, '6101', { ...ok, confirm: 'yes' }, 400],
    [ck.boss, '6101 OR 1', ok, 404], [ck.boss, '999999', ok, 404],
    [ck.ana, '6104', ok, 404],                                                        // Bea's client
    [ck.viewer, '6101', ok, 403], [ck.nocal, '6101', ok, 403], [undefined, '6101', ok, 401],
    [ck.boss, '6107', ok, 409],                                                       // no client linked
    [ck.boss, '6101', { ...ok, expect: 'Pending' }, 409],                             // the page showed another Status
    [ck.boss, '6101', { outcome: 'loi', conf: 60 }, 409],                             // replaces a Status: needs confirm
  ];
  for (const [who, id, body, want] of refusals) {
    const r = await result(on, who, id, body);
    assert.strictEqual(r.status, want, id + ' ' + JSON.stringify(body).slice(0, 80) + ' → ' + r.text);
  }
  const stale = await result(on, ck.boss, '6101', { ...ok, expect: 'Pending' });
  assert.strictEqual(stale.data.stale, true);
  assert.strictEqual((await result(on, ck.boss, '6101', { outcome: 'loi', conf: 60 })).data.needsConfirm, true);
  // the board must have the target label; it is never created
  const st = C.columns.find((c) => c.id === 'st'), saved = st.settings_str;
  st.settings_str = JSON.stringify({ labels: { 0: 'Viewing Scheduled', 1: 'Failed' } });
  const noLabel = await result(on, ck.boss, '6101', ok);
  st.settings_str = saved;
  assert.strictEqual(noLabel.status, 409); assert.match(noLabel.data.error, /no "Under Negotiations" label/);
  assert.strictEqual(mutations().length, n, 'none of these reached Monday');
  assert.strictEqual(await ViewingResult.countDocuments({}), 0, 'and nothing was saved in the portal');
  // the generic Monday write route still has no Calendar action
  assert.strictEqual((await call(on, 'POST', '/api/monday/write', ck.boss, { action: 'viewingStatus', itemId: '6101', value: 'Failed', confirm: true })).status, 400);
});

test('writes off: Create LOI is refused (409) and nothing is sent or saved; Failed (portal only) still saves', async () => {
  const off = await instance({});
  const n = mutations().length;
  const r = await result(off, ck.boss, '6101', { outcome: 'loi', conf: 60, expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(r.status, 409); assert.strictEqual(r.data.writesOff, true);
  assert.strictEqual(mutations().length, n); assert.strictEqual(await ViewingResult.countDocuments({}), 0);
  assert.strictEqual((await call(off, 'GET', '/api/integrations/status', ck.boss)).data.calendarFeedbackColumn, false);
  const f = await result(off, ck.boss, '6113', { outcome: 'failed', tags: ['layout'] });
  assert.strictEqual(f.status, 200, f.text); assert.deepStrictEqual(f.data.written, []);
  assert.strictEqual(mutations().length, n, 'Failed never writes to Monday');
  assert.strictEqual((await ViewingResult.findOne({ viewingId: '6113' }).lean()).outcome, 'failed');
});

test('Failed (as the Apps Script): nothing written on Monday; result, reasons and feedback kept in the portal; leaves the pending list', async () => {
  const n = mutations().length, audits = await MondayWrite.countDocuments({});
  const r = await result(on, ck.ana, '6101', { outcome: 'failed', tags: ['too_small', 'disliked_area'], feedback: 'Client found it cramped', expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(mutations().length, n, 'no Monday mutation for Failed');
  assert.strictEqual(await MondayWrite.countDocuments({}), audits, 'no Monday write to audit');
  assert.deepStrictEqual(r.data.written, []);
  assert.strictEqual(r.data.feedbackSavedTo, 'portal');
  assert.strictEqual(r.data.viewing.statusLabel, 'Viewing Scheduled', 'the Calendar Status on Monday is unchanged');
  assert.strictEqual(r.data.viewing.result.feedback, 'Client found it cramped');
  assert.ok(!r.text.includes('mtest'));
  const rec = await ViewingResult.findOne({ viewingId: '6101' }).lean();
  assert.deepStrictEqual([rec.leadId, rec.outcome, rec.tags, rec.feedback, rec.mondayStatus, rec.feedbackOnMonday, rec.unit.building], ['9001', 'failed', ['too_small', 'disliked_area'], 'Client found it cramped', '', false, 'Tower 6101']);
  assert.strictEqual(C.items.find((x) => x.id === '6101').v.st, 'Viewing Scheduled', 'the (fake) Monday item itself is unchanged');
  // a Failed result doesn't depend on the Status the page showed (nothing on Monday is replaced)
  assert.strictEqual((await result(on, ck.ana, '6101', { outcome: 'failed', tags: ['too_small'], feedback: 'Too small', expect: 'Pending' })).status, 200);
  assert.strictEqual((await ViewingResult.findOne({ viewingId: '6101' }).lean()).feedback, 'Too small');
  assert.strictEqual(mutations().length, n);
  // the pending list and the bootstrap show the result
  assert.ok(!keys((await pending(on, ck.ana)).data.rows).includes('monday:6101'));
  const v = (await call(on, 'GET', '/api/monday/bootstrap', ck.ana)).data.viewings.find((x) => x.id === '6101');
  assert.deepStrictEqual([v.statusLabel, v.feedback, v.result.outcome, v.result.tags], ['Viewing Scheduled', 'Too small', 'failed', ['too_small']]);
});

test('Create LOI: Status → Under Negotiations and LOI Creation Date → today (Manila); confidence kept in the portal', async () => {
  const n = mutations().length;
  const r = await result(on, ck.boss, '6104', { outcome: 'loi', conf: 70, state: 'Owner reviewing', feedback: 'Liked it', expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(r.status, 200, r.text);
  const sentFull = mutations().slice(n), sent = sentFull.map((m) => m.body.variables);
  assert.deepStrictEqual(sent, [{ b: BOARDS.calendar, i: '6104', c: 'st', v: 'Under Negotiations' }, { b: BOARDS.calendar, i: '6104', c: 'lcd', v: todayManila() }]);
  assert.ok(sentFull.every((m) => m.body.query === WRITE_MUTATION && m.auth === 'mtest'), 'the fixed mutation; token only in the server→Monday request');
  assert.ok(!sent.some((x) => /Liked it/.test(x.v)), 'broker feedback is not written to Monday');
  assert.deepStrictEqual(r.data.written, [{ column: 'Status', from: 'Viewing Scheduled', to: 'Under Negotiations' }, { column: 'LOI Creation Date', to: todayManila() }]);
  const au = await MondayWrite.find({ itemId: '6104' }).sort({ createdAt: 1 }).lean();
  assert.deepStrictEqual(au.map((a) => [a.board, a.action, a.column, a.from, a.to, a.ok, a.by.name]),
    [['calendar', 'viewingResultStatus', 'Status', 'Viewing Scheduled', 'Under Negotiations', true, 'Demo Manager'], ['calendar', 'viewingLoiDate', 'LOI Creation Date', '', '', true, 'Demo Manager']]);
  assert.ok(!/Liked it|mtest/.test(JSON.stringify(au)), 'no feedback text or token in the audit');
  const rec = await ViewingResult.findOne({ viewingId: '6104' }).lean();
  assert.deepStrictEqual([rec.outcome, rec.loiConf.pct, rec.loiConf.state, rec.feedback, rec.mondayStatus], ['loi', 70, 'Owner reviewing', 'Liked it', 'Under Negotiations']);
  assert.strictEqual(r.data.viewing.loiCreated, todayManila());
  assert.ok(!keys((await pending(on, ck.boss)).data.rows).includes('monday:6104'));
  // an LOI date already on Monday is never replaced
  const m2 = mutations().length;
  await result(on, ck.boss, '6104', { outcome: 'loi', conf: 80, expect: 'Under Negotiations', confirm: true });
  assert.strictEqual(mutations().length, m2);
});

test('a Monday failure is reported, audited and saves nothing in the portal; the viewing stays pending', async () => {
  failNextMutation = true;
  const r = await result(on, ck.boss, '6109', { outcome: 'loi', conf: 30, feedback: 'Zz-unique-feedback', expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(r.status, 502); assert.match(r.data.error, /Monday\.com/);
  assert.strictEqual(await ViewingResult.countDocuments({ viewingId: '6109' }), 0);
  const au = await MondayWrite.findOne({ itemId: '6109' }).lean();
  assert.strictEqual(au.ok, false); assert.ok(!/Zz-unique/.test(JSON.stringify(au)));
  assert.ok(keys((await pending(on, ck.boss)).data.rows).includes('monday:6109'));
});

test('feedback is copied to Monday only through one dedicated, uniquely titled text column (by id); the portal keeps it too', async () => {
  assert.throws(() => loadConfig(env({ MONDAY_CALENDAR_FEEDBACK_COLUMN: 'Bad-Id' }), ARGV), /MONDAY_CALENDAR_FEEDBACK_COLUMN/);
  const withFb = await instance({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60', MONDAY_CALENDAR_FEEDBACK_COLUMN: 'fbk' });
  assert.strictEqual((await call(withFb, 'GET', '/api/integrations/status', ck.boss)).data.calendarFeedbackColumn, true);
  const chk = (await call(withFb, 'POST', '/api/integrations/monday/test', ck.boss, {})).data.calendarFeedback;
  assert.deepStrictEqual([chk.valid, chk.title, chk.type], [true, 'Broker Feedback', 'text'], 'Managers can check the configured column (read-only)');
  const n = mutations().length;
  assert.strictEqual((await result(withFb, ck.boss, '6109', { outcome: 'failed', feedback: 'x'.repeat(201) })).status, 400, 'one line, 200 characters at most while it is copied');
  const r = await result(withFb, ck.boss, '6109', { outcome: 'failed', tags: ['too_expensive'], feedback: 'Over budget,\n\twants   cheaper' });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(mutations().slice(n).map((m) => [m.body.variables.c, m.body.variables.v]), [['fbk', 'Over budget, wants cheaper']], 'Failed: the feedback copy only, never a Status');
  assert.strictEqual(r.data.feedbackSavedTo, 'monday+portal');
  const rec = await ViewingResult.findOne({ viewingId: '6109' }).lean();
  assert.deepStrictEqual([rec.feedback, rec.feedbackOnMonday], ['Over budget,\n\twants   cheaper', true], 'the portal keeps the full text');
  const au = await MondayWrite.findOne({ itemId: '6109', action: 'viewingFeedback' }).lean();
  assert.deepStrictEqual([au.column, au.ok, au.from, au.to], ['Broker Feedback', true, '', '']); assert.ok(!/budget/i.test(JSON.stringify(au)), 'no feedback text in the audit');
  // removing the feedback later never clears Monday: it says so
  const rm = await result(withFb, ck.boss, '6109', { outcome: 'failed', tags: ['too_expensive'] });
  assert.match(rm.data.warnings.join(' '), /earlier feedback stays in Monday's "Broker Feedback" column/);
  // Create LOI with the column: Status, LOI Creation Date and the feedback copy
  const n2 = mutations().length;
  const loi = await result(withFb, ck.boss, '6114', { outcome: 'loi', conf: 65, feedback: 'Wants the unit', expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(loi.status, 200, loi.text);
  assert.deepStrictEqual(mutations().slice(n2).map((m) => [m.body.variables.c, m.body.variables.v]), [['st', 'Under Negotiations'], ['lcd', todayManila()], ['fbk', 'Wants the unit']]);
});

test('an unusable feedback column (duplicated "Remarks", non-text, shared title, already read, missing) is never written; feedback stays in the portal', async () => {
  const cases = [['remarks__1', /a long_text column, not a text column/], ['status_18', /a status column, not a text column/], ['notes_a', /more than one Calendar column has that title/],
    ['tm', /already reads/], ['nope_col', /is not a column of the Calendar board/]];
  for (const [id, why] of cases) {
    const base = await instance({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60', MONDAY_CALENDAR_FEEDBACK_COLUMN: id });
    const chk = (await call(base, 'POST', '/api/integrations/monday/test', ck.boss, {})).data.calendarFeedback;
    assert.strictEqual(chk.valid, false, id); assert.match(chk.problem, why, id);
    const n = mutations().length;
    const r = await result(base, ck.boss, '6109', { outcome: 'failed', tags: ['layout'], feedback: 'Zz-kept-in-portal ' + id });
    assert.strictEqual(r.status, 200, id + ': ' + r.text);
    assert.strictEqual(mutations().length, n, id + ': nothing written to Monday');
    assert.strictEqual(r.data.feedbackSavedTo, 'portal'); assert.match(r.data.warnings.join(' '), /kept in the portal only/);
    assert.strictEqual((await ViewingResult.findOne({ viewingId: '6109' }).lean()).feedback, 'Zz-kept-in-portal ' + id);
  }
  // Create LOI still writes its two fields; only the feedback copy is skipped
  const bad = await instance({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60', MONDAY_CALENDAR_FEEDBACK_COLUMN: 'remarks__1' });
  const n = mutations().length;
  const loi = await result(bad, ck.boss, '6115', { outcome: 'loi', conf: 50, feedback: 'Zz-not-on-monday', expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(loi.status, 200, loi.text);
  assert.deepStrictEqual(mutations().slice(n).map((m) => m.body.variables.c), ['st', 'lcd']);
  assert.ok(!mutations().some((m) => /Zz-not-on-monday|Zz-kept-in-portal/.test(m.body.variables.v)), 'feedback never sent');
  // Monday writes off with a valid column: Failed saves in the portal (1000 characters), nothing is copied
  const off = await instance({ MONDAY_CALENDAR_FEEDBACK_COLUMN: 'fbk' });
  const n3 = mutations().length;
  const f = await result(off, ck.boss, '6109', { outcome: 'failed', feedback: 'y'.repeat(300) });
  assert.strictEqual(f.status, 200, f.text); assert.strictEqual(mutations().length, n3);
  assert.match(f.data.warnings.join(' '), /switched off, so the feedback was not copied/);
});

test('portal booking: the result stays in MongoDB (viewing Done, note on the lead) and leaves the pending list', async () => {
  const n = mutations().length;
  assert.strictEqual((await result(on, ck.boss, 'nope', { outcome: 'failed', tags: ['layout'] }, 'mongo')).status, 404);
  assert.strictEqual((await result(on, ck.boss, ids.portal, { outcome: 'failed', tags: ['layout'], expect: 'x' }, 'mongo')).status, 400);
  const r = await result(on, ck.boss, ids.portal, { outcome: 'failed', tags: ['layout'], feedback: 'Odd layout' }, 'mongo');
  assert.strictEqual(r.status, 200, r.text);
  const v = await Viewing.findById(ids.portal).lean();
  assert.deepStrictEqual([v.status, v.outcome, v.feedbackTags, v.feedback, v.outcomeBy], ['Done', 'failed', ['layout'], 'Odd layout', 'Demo Manager']);
  assert.match((await Note.findOne({ leadId: ids.leadA }).sort({ at: -1 }).lean()).text, /Viewing result — L-1: FAILED · Layout · "Odd layout"/);
  assert.strictEqual(mutations().length, n, 'nothing sent to Monday');
  assert.ok(!keys((await pending(on, ck.boss)).data.rows).includes('mongo:' + ids.portal));
  assert.strictEqual((await result(on, ck.nocal, ids.portal, { outcome: 'failed', tags: ['layout'] }, 'mongo')).status, 403);
});

test('safeguards: other broker, columns no longer unambiguous, client relinked on Monday — refused before any write', async () => {
  const n = mutations().length, ok = { outcome: 'loi', conf: 50, expect: 'Viewing Scheduled', confirm: true };
  // a Broker sees (and can record) only the viewings where they are the Salesperson
  assert.strictEqual((await result(on, ck.broker, '6110', ok)).status, 404);
  assert.strictEqual((await result(on, ck.broker, '6110', { outcome: 'failed', tags: ['layout'] })).status, 404);
  assert.ok(!keys((await pending(on, ck.broker)).data.rows).includes('monday:6110'));
  // two columns titled "Status": nothing is written until there is one
  C.columns.push({ id: 'st2', title: 'Status', type: 'status', settings_str: '{}' });
  const dup = await result(on, ck.boss, '6111', ok);
  C.columns.pop();
  assert.strictEqual(dup.status, 409); assert.match(dup.data.error, /more than one "Status"/);
  // the Calendar item now links another client on Monday (the server's copy is older): refused, and the copy is refreshed
  const it = C.items.find((x) => x.id === '6111'); it.v.cl = { linked: ['9003'] };
  const moved = await result(on, ck.boss, '6111', ok);
  assert.strictEqual(moved.status, 409); assert.strictEqual(moved.data.stale, true); assert.match(moved.data.error, /client or broker has changed/);
  assert.strictEqual(mutations().length, n, 'nothing reached Monday');
  assert.strictEqual(await ViewingResult.countDocuments({ viewingId: { $in: ['6110', '6111'] } }), 0);
});

test('a later Monday change failing is reported as a warning; the Status change and the portal record stand', async () => {
  failNextMutation = true; passBeforeFail = 1;   // Status goes through, LOI Creation Date is refused
  const r = await result(on, ck.boss, '6112', { outcome: 'loi', conf: 40, expect: 'Viewing Scheduled', confirm: true });
  failNextMutation = false; passBeforeFail = 0;
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(r.data.written, [{ column: 'Status', from: 'Viewing Scheduled', to: 'Under Negotiations' }]);
  assert.strictEqual(r.data.warnings.length, 1); assert.match(r.data.warnings[0], /LOI Creation Date was not updated on Monday/);
  assert.strictEqual((await ViewingResult.findOne({ viewingId: '6112' }).lean()).loiConf.pct, 40);
  const au = await MondayWrite.find({ itemId: '6112' }).sort({ createdAt: 1 }).lean();
  assert.deepStrictEqual(au.map((a) => [a.action, a.ok]), [['viewingResultStatus', true], ['viewingLoiDate', false]]);
});

test('rate limit: every Monday change counts; over the limit the request is refused before Monday is contacted', async () => {
  const lim = await instance({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '1' });
  await call(lim, 'GET', '/api/monday/bootstrap', ck.boss);
  const n = mutations().length;
  // 6109 (Failed earlier, which left its Status alone): Under Negotiations + LOI date are two changes, the limit allows one
  const r = await result(lim, ck.boss, '6109', { outcome: 'loi', conf: 55, expect: 'Viewing Scheduled', confirm: true });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(mutations().length, n + 1); assert.match(r.data.warnings.join(' '), /LOI Creation Date was not updated: too many/);
  const calls = fx.calls.monday.length;
  const again = await result(lim, ck.boss, '6109', { outcome: 'loi', conf: 55, expect: 'Under Negotiations', confirm: true });
  assert.strictEqual(again.status, 429); assert.ok(again.data.retryAfter >= 1);
  assert.strictEqual(fx.calls.monday.length, calls, 'no Monday call at all');
});

test('broker identity: only an admin-set exact Salesperson label; missing or shared → no Monday viewings, with a setup notice', async () => {
  const me = await User.findOne({ email: 'broker@example.com' });
  // no label yet (the portal name "Ely Santos" alone gives nothing): denied, with a notice saying what to set
  let b = (await call(on, 'GET', '/api/monday/bootstrap', ck.broker)).data;
  assert.deepStrictEqual([b.viewings.length, b.leads.length], [0, 0]); assert.match(b.scopeNotice, /no Monday Salesperson label/);
  let p = (await pending(on, ck.broker)).data;
  assert.ok(!p.rows.some((r) => r.src === 'monday')); assert.match(p.scopeNotice, /Team & Access/);
  assert.strictEqual((await result(on, ck.broker, '6105', { outcome: 'failed', tags: ['layout'] })).status, 404);
  // the label must be an exact board label: no first names, no case-insensitive or partial matches
  const patch = (who, id, body) => call(on, 'PATCH', '/api/team/' + id, who, body);
  const base = { name: 'Ely Santos', email: 'broker@example.com', role: 'Broker', modules: { leads: 'view', calendar: 'edit' } };
  for (const bad of ['Ely', 'ely santos', 'Santos', 'Nobody Fake']) assert.strictEqual((await patch(ck.boss, me.id, { ...base, salesLabel: bad })).status, 400, bad);
  assert.strictEqual((await patch(ck.broker, me.id, { ...base, salesLabel: 'Ely Santos' })).status, 403, 'only Team & Access editors set labels');
  assert.strictEqual((await patch(ck.boss, me.id, { ...base, salesLabel: 'Ely Santos' })).status, 200);
  b = (await call(on, 'GET', '/api/monday/bootstrap', ck.broker)).data;
  assert.ok(!b.scopeNotice && b.viewings.length > 0 && b.viewings.every((v) => v.broker === 'Ely Santos'), 'their own viewings only');
  assert.ok(!b.viewings.some((v) => v.id === '6110'), "not another broker's viewing");
  assert.ok(b.leads.some((l) => l.id === '9001') && b.leads.every((l) => l.salesperson === 'Ely Santos' || b.viewings.some((v) => v.leadId === l.id)));
  // a second broker with the same portal name: names don't matter, labels do; a label can belong to one broker only
  const add = (body) => call(on, 'POST', '/api/team', ck.boss, { ...base, password: PW, ...body });
  assert.strictEqual((await add({ email: 'ely2@example.com', salesLabel: 'Ely Santos' })).status, 400, 'label already taken');
  const two = await add({ email: 'ely2@example.com', salesLabel: 'Gia Cruz' });
  assert.strictEqual(two.status, 201, two.text);
  const r2 = await fetch(on + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ely2@example.com', password: PW }) });
  const ck2 = r2.headers.get('set-cookie').split(';')[0];
  const b2 = (await call(on, 'GET', '/api/monday/bootstrap', ck2)).data;
  assert.ok(b2.viewings.length > 0 && b2.viewings.every((v) => v.broker === 'Gia Cruz'), 'same name, different label: only their own label\'s viewings');
  assert.ok(!b2.viewings.some((v) => v.broker === 'Ely Santos'));
  // a broker can record a result for their own viewing, never for another broker's
  assert.strictEqual((await result(on, ck.broker, '6110', { outcome: 'failed', tags: ['layout'] })).status, 404);
  assert.strictEqual((await result(on, ck.broker, '6105', { outcome: 'failed', tags: ['layout'] })).status, 200);
  // a label shared by two active brokers (e.g. set outside the portal) identifies no one: both are denied
  await User.updateOne({ email: 'ely2@example.com' }, { $set: { salesLabel: 'Ely Santos' } });
  for (const c of [ck.broker, ck2]) {
    const d = (await call(on, 'GET', '/api/monday/bootstrap', c)).data;
    assert.deepStrictEqual([d.viewings.length, d.leads.length], [0, 0]); assert.match(d.scopeNotice, /more than one broker/);
    assert.strictEqual((await result(on, c, '6105', { outcome: 'failed', tags: ['layout'] })).status, 404);
  }
  await User.updateOne({ email: 'ely2@example.com' }, { $set: { active: false } });
  assert.ok((await call(on, 'GET', '/api/monday/bootstrap', ck.broker)).data.viewings.length > 0, 'an inactive broker no longer counts');
});

test('feedback shapes the suggestions with the Apps Script rules (hide, boost, reasons read from text)', () => {
  const fb = SH.feedbackPrefs([{ tags: ['too_expensive', 'disliked_building'], name: 'Tower A', price: 100000, building: 'Tower A', location: 'Makati' },
    { tags: [], feedback: 'The unit was too small for them', name: 'Tower B', sqm: 40, building: 'Tower B' }, { tags: ['liked_area'], building: 'Tower C', location: 'Pasig' }]);
  assert.deepStrictEqual(fb.rules.map((r) => r.t), ['too_expensive', 'disliked_building', 'too_small', 'liked_area']);
  assert.ok(fb.summary.some((s) => /Under 100,000/.test(s)) && fb.notes.length === 1);
  const L = (o) => SH.applyFeedback({ price: 80000, sqm: 50, bedrooms: '2', building: 'Tower Z', location: 'Makati', ...o }, fb);
  assert.strictEqual(L({ price: 120000 }).hide, true, 'as expensive or more: hidden');
  assert.strictEqual(L({ building: 'Tower A' }).hide, true, 'the building they disliked: hidden');
  assert.strictEqual(L({ sqm: 35 }).hide, true, 'no bigger than the one too small: hidden');
  const ok = L({}); assert.strictEqual(ok.hide, false); assert.strictEqual(ok.boost, 3); assert.deepStrictEqual(ok.chips, ['bigger']);
  assert.strictEqual(L({ location: 'Pasig' }).boost, 6, 'the area they liked moves up');
  // the shared validation the page and the server both use
  assert.deepStrictEqual(SH.validateResult({ outcome: 'loi', conf: '65', state: ' ok ' }).value, { outcome: 'loi', tags: [], feedback: '', conf: { pct: 65, state: 'ok' } });
  assert.match(SH.validateResult({ outcome: 'failed', feedback: 'x'.repeat(201) }, 200).errors[0], /200 characters/);
  assert.ok(SH.portalPending({ status: 'Confirmed', date: ymd(-1), time: '10:00' }, Date.now()));
  assert.ok(!SH.portalPending({ status: 'Confirmed', date: ymd(1), time: '10:00' }, Date.now()));
});
