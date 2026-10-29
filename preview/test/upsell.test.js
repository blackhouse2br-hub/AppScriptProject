'use strict';
// Upselling end to end: an in-memory MongoDB, the fake Monday board and a fake respond.io (fictional clients). No real
// message is sent: every respond.io request goes to the local fake and is recorded, so the tests check exactly what
// would be sent, to whom, and that nothing is sent without the operator's confirmation.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, UpsellSend } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');
const { PNG } = require('./fixtures/fake-google-ai');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
// extra fictional clients: a tenant (closed deal), one whose 24 h WhatsApp window is closed, one that hits a rate limit
const L = fx.BOARDS['1111111'], CAL = fx.BOARDS['3333333'];
L.items.push({ id: '9301', name: 'BH-U1', group: 'ALL CLIENTS', v: { cn: 'Tenant Tina Cruz', va1: 'Ana', inq: 'Rent', cs: 'Qualified', city: 'Makati', rid: '555301' } },
  { id: '9302', name: 'BH-U2', group: 'ALL CLIENTS', v: { cn: 'Window Wendy', va1: 'Bea', inq: 'Rent', cs: 'Qualified', city: 'Taguig', rid: '555302' } },
  { id: '9303', name: 'BH-U3', group: 'ALL CLIENTS', v: { cn: 'Rate Ricky', va1: 'Bea', inq: 'Buy', cs: 'Failed', city: 'Pasig', rid: '555303' } },
  // a returning client: a second lead with the same respond.io contact as Tina; and one whose send hits a respond.io server error
  { id: '9304', name: 'BH-U4', group: 'ALL CLIENTS', v: { cn: 'Tina Cruz (2nd inquiry)', va1: 'Ana', inq: 'Rent', cs: 'Qualified', city: 'Makati', rid: '555301' } },
  { id: '9305', name: 'BH-U5', group: 'ALL CLIENTS', v: { cn: 'Server Error Sam', va1: 'Bea', inq: 'Rent', cs: 'Qualified', city: 'Pasig', rid: '555305' } });
CAL.columns.push({ id: 'ccd', title: 'Contract Date', type: 'date', settings_str: '{}' });
CAL.items.push({ id: '6401', name: 'Deal U1', group: 'Closed', created: '2026-09-01', v: { fs: '2026-09-01', cl: { linked: ['9301'] }, b: 'Fake Tower', c: 'Makati', tm: '10:00', sp: 'Ely Santos', st: 'Closed', ccd: '2026-09-10' } });

const sent = [];   // every respond.io POST that reached the fake: { path, body }
let fake, fakeBase, mem, server, base, offBase, offServer;
const front = http.createServer((req, res) => {   // in front of the fixture: records sends and injects failures
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (req.method === 'POST' && req.url.startsWith('/respond/')) {
      const path = req.url.slice('/respond'.length); sent.push({ path, body: JSON.parse(body || 'null') });
      if (/id:555302\/message/.test(path)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'Outside of the 24 hour messaging window' })); }
      if (/id:555303\//.test(path)) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' }); return res.end('{}'); }
      if (/id:555305\//.test(path)) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{}'); }
    }
    const r = await fetch(fakeBase + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
});
const cookies = {};
async function call(b, method, url, { body, cookie, file, name } = {}) {
  const headers = {}; if (cookie) headers.cookie = cookie;
  if (file) { headers['content-type'] = 'application/octet-stream'; headers['x-file-name'] = name || 'x'; } else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(b + url, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text: buf.toString(), buf, headers: res.headers };
}
async function login(who) {
  if (cookies[who]) return cookies[who];
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who); return (cookies[who] = r.headers.get('set-cookie').split(';')[0]);
}

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r)); fakeBase = `http://127.0.0.1:${fake.address().port}`;
  await new Promise((r) => front.listen(0, '127.0.0.1', r)); const f = `http://127.0.0.1:${front.address().port}`;
  mem = await MongoMemoryServer.create();
  const env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_up'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond' };
  ({ server } = await start({ ...env, RESPOND_SENDS: 'on' }, ARGV)); base = `http://127.0.0.1:${server.address().port}`;
  const app2 = createApp(loadConfig(env, ARGV)); offServer = await new Promise((r) => { const s = app2.listen(0, '127.0.0.1', () => r(s)); }); offBase = `http://127.0.0.1:${offServer.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Jonjo Boss', role: 'Manager', passwordHash },
    { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Bea', modules: { upsell: 'view' }, passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { upsell: 'edit' }, passwordHash },
    { email: 'none@example.com', name: 'No Upsell', role: 'Broker', modules: { leads: 'view' }, passwordHash }]);
});
test.after(async () => { server.close(); offServer.close(); front.close(); fake.close(); server.closeAllConnections(); offServer.closeAllConnections(); front.closeAllConnections(); fake.closeAllConnections(); await mongoose.disconnect(); await mem.stop(); });

let cid, version;
const audience = (cookie, b = base) => call(b, 'GET', `/api/upsell/campaigns/${cid}/audience`, { cookie });
async function save(cookie, patch) { const r = await call(base, 'PUT', '/api/upsell/campaigns/' + cid, { cookie, body: { ...patch, version } }); if (r.status === 200) version = r.data.campaign.version; return r; }

test('access: Upselling view reads, edit drafts and sends, others nothing; offers start from Renewals → Message texts', async () => {
  assert.strictEqual((await call(base, 'GET', '/api/upsell/campaigns')).status, 401);
  assert.strictEqual((await call(base, 'GET', '/api/upsell/meta', { cookie: await login('none') })).status, 403);
  const viewer = await login('viewer');
  const meta = (await call(base, 'GET', '/api/upsell/meta', { cookie: viewer })).data;
  assert.deepStrictEqual(meta.templates.map((t) => t.k), ['concierge', 'movers', 'cleaners', 'aircon', 'repairs', 'interiors', 'furniture', 'legal']);
  assert.strictEqual(meta.sends, true);
  assert.strictEqual((await call(base, 'POST', '/api/upsell/campaigns', { cookie: viewer, body: { name: 'x' } })).status, 403);
  const boss = await login('boss');
  const c = await call(base, 'POST', '/api/upsell/campaigns', { cookie: boss, body: { name: 'October concierge' } });
  assert.strictEqual(c.status, 201); cid = c.data.campaign.id; version = c.data.campaign.version;
  assert.strictEqual(c.data.campaign.text, SH.UPSELL.concierge); assert.match(c.data.campaign.tag, /^upsell-concierge-\d{4}-\d{2}$/);
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/send`, { cookie: viewer, body: { confirm: true, hash: 'x', action: 'message' } })).status, 403);
  // validation
  for (const p of [{ audience: { preset: 'everyone' } }, { text: 'x'.repeat(1501) }, { owner: 'me' }, { template: 'nope' }, { name: '' }]) assert.strictEqual((await save(boss, p)).status, 400, JSON.stringify(p).slice(0, 40));
  const off = await call(offBase, 'GET', '/api/upsell/meta', { cookie: boss });
  assert.strictEqual(off.data.sends, false); assert.match(off.data.sendsNote, /RESPOND_SENDS/);
});

const names = (list) => list.map((x) => x.name).sort();
const batch = (a, k) => a.batches[k];
const send = (cookie, body, b = base) => call(b, 'POST', `/api/upsell/campaigns/${cid}/send`, { cookie, body });

test('audience: worked out on the server from visible Monday clients; presets, filters, opt-outs by client and contact; VAs see only theirs', async () => {
  const boss = await login('boss');
  assert.strictEqual((await save(boss, { audience: { preset: 'all', statuses: [], type: '', city: '', contact: 'respond', skipDays: 14 } })).status, 200);
  let a = (await audience(boss)).data;
  assert.deepStrictEqual(names(a.recipients), ['Hot Client', 'Rate Ricky', 'Server Error Sam', 'Tenant Tina Cruz', 'Test Client One', 'Test Client Three', 'Tina Cruz (2nd inquiry)', 'Window Wendy']);
  assert.ok(a.recipients.every((x) => x.onRespond) && a.counts.respond === a.counts.audience);
  // one respond.io contact is in a batch once, even with two leads
  assert.strictEqual(batch(a, 'message').ids.filter((id) => ['9301', '9304'].includes(id)).length, 1);
  await save(boss, { audience: { preset: 'tenants', statuses: [], type: '', city: '', contact: 'respond', skipDays: 14 } });
  assert.deepStrictEqual(names((await audience(boss)).data.recipients), ['Tenant Tina Cruz'], 'tenants: a closed deal');
  await save(boss, { audience: { preset: 'past', statuses: [], type: 'Buy', city: 'pas', contact: 'any', skipDays: 0 } });
  assert.deepStrictEqual(names((await audience(boss)).data.recipients), ['Rate Ricky'], 'past + Buy + city');
  await save(boss, { audience: { preset: 'all', statuses: [], type: '', city: '', contact: 'respond', skipDays: 14 } });
  assert.deepStrictEqual(names((await audience(await login('ana'))).data.recipients), ['Hot Client', 'Tenant Tina Cruz', 'Test Client One', 'Tina Cruz (2nd inquiry)'], 'a VA sees only their own clients');
  // opt-outs: only for clients you can see; they cover every lead of the same respond.io contact; listed for undo
  assert.strictEqual((await call(base, 'POST', '/api/upsell/optout', { cookie: await login('ana'), body: { ids: ['9302'], on: true } })).status, 404, 'not Ana\'s client');
  assert.strictEqual((await call(base, 'POST', '/api/upsell/optout', { cookie: boss, body: { ids: ['9003', '9304'], on: true } })).status, 200);
  a = (await audience(boss)).data;
  assert.ok(!a.recipients.some((x) => ['9003', '9301', '9304'].includes(x.id)), 'Tina\'s other lead is covered by the opt-out too');
  assert.deepStrictEqual(a.opted.map((x) => [x.id, x.self]).sort(), [['9003', true], ['9301', false], ['9304', true]]);
  await call(base, 'POST', '/api/upsell/optout', { cookie: boss, body: { ids: ['9304'], on: false } });
  assert.ok((await audience(boss)).data.recipients.some((x) => x.id === '9301'), 'undo works');
});

test('message rendering and preview; image checks, persistent public link for respond.io only by its token', async () => {
  const boss = await login('boss');
  await save(boss, { text: 'Hi {firstName}! {va} here. Concierge for {building}.' });
  const pv = (await call(base, 'GET', `/api/upsell/campaigns/${cid}/preview?lead=9301`, { cookie: boss })).data;
  assert.strictEqual(pv.text, 'Hi Tenant! Jonjo here. Concierge for your unit.');
  assert.strictEqual(SH.upsellText('Hi {firstName}', { name: '' }, ''), 'Hi there');
  for (const [buf, n] of [[Buffer.from('<svg onload=alert(1)>'), 'a.png'], [Buffer.from('%PDF-1.4'), 'a.pdf'], [Buffer.concat([PNG(), Buffer.alloc(5 * 1024 * 1024)]), 'big.png']]) {
    assert.ok([400, 413].includes((await call(base, 'POST', `/api/upsell/campaigns/${cid}/image`, { cookie: boss, file: buf, name: n })).status), n);
  }
  const up = await call(base, 'POST', `/api/upsell/campaigns/${cid}/image`, { cookie: boss, file: PNG(2), name: 'concierge.png' });
  assert.strictEqual(up.status, 201); version = up.data.campaign.version;
  const pub = await call(base, 'GET', '/upsell-media/' + up.data.campaign.image.token);
  assert.strictEqual(pub.status, 200); assert.strictEqual(pub.headers.get('content-type'), 'image/png'); assert.ok(pub.buf.equals(PNG(2)));
  assert.strictEqual((await call(base, 'GET', '/upsell-media/' + 'A'.repeat(32))).status, 404);
  assert.strictEqual((await call(base, 'GET', `/api/upsell/campaigns/${cid}/image`)).status, 401, 'the in-portal link needs sign-in');
});

test('sending: only the reviewed batch, after confirmation; per-client records; failures, unknown outcomes, no duplicates, retries', async () => {
  const boss = await login('boss'), before = sent.length;
  let a = (await audience(boss)).data;
  assert.strictEqual(sent.length, before, 'reviewing sends nothing');
  assert.strictEqual((await send(boss, { hash: batch(a, 'message').hash, action: 'message' })).status, 400, 'no confirmation');
  const stale = await send(boss, { confirm: true, hash: 'not-what-was-reviewed', action: 'message' });
  assert.strictEqual(stale.status, 409); assert.ok(stale.data.stale);
  assert.strictEqual((await send(boss, { confirm: true, hash: batch(a, 'message').hash, action: 'message' }, offBase)).status, 409, 'sending switched off');
  assert.strictEqual((await send(boss, { confirm: true, hash: batch(a, 'tag').hash, action: 'message' })).status, 409, 'a tag batch\'s fingerprint can\'t confirm a message send');
  // a change after review (an opt-out) makes the reviewed batch stale
  await call(base, 'POST', '/api/upsell/optout', { cookie: boss, body: { ids: ['9006'], on: true } });
  assert.strictEqual((await send(boss, { confirm: true, hash: batch(a, 'message').hash, action: 'message' })).status, 409);
  await call(base, 'POST', '/api/upsell/optout', { cookie: boss, body: { ids: ['9006'], on: false } });
  assert.strictEqual(sent.length, before, 'nothing reached respond.io');
  a = (await audience(boss)).data;
  const reviewed = batch(a, 'message');
  // two confirmed sends at the same moment: one runs, the other is refused (lock, or its batch is no longer next)
  const [s1, s2] = await Promise.all([0, 1].map(() => send(boss, { confirm: true, hash: reviewed.hash, action: 'message' })));
  const ran = [s1, s2].find((x) => x.status === 200), other = [s1, s2].find((x) => x !== ran);
  assert.ok(ran, JSON.stringify([s1.data, s2.data])); assert.strictEqual(other.status, 409);
  const res = Object.fromEntries(ran.data.results.map((x) => [x.name, x]));
  assert.ok(ran.data.results.every((x) => reviewed.ids.includes(x.id)), 'only reviewed clients');
  assert.strictEqual(ran.data.results.filter((x) => ['9301', '9304'].includes(x.id)).length, 1, 'one send for the shared contact');
  assert.match(res['Window Wendy'].error, /24 hours/);
  assert.strictEqual(res['Test Client Three'], undefined, 'opted out earlier, never sent');
  // the batch stops at the first server error (unknown outcome) or rate limit; both are recorded
  assert.ok(ran.data.stopped, 'the batch stopped'); assert.match(ran.data.stopped, /server error|rate-limiting/);
  const posts = sent.slice(before), tina = posts.filter((p) => p.path === '/contact/id:555301/message');
  assert.strictEqual(tina.length, 2, 'image, then text, once');
  assert.strictEqual(tina[0].body.message.type, 'attachment'); assert.match(tina[0].body.message.attachment.url, /\/upsell-media\/[A-Za-z0-9_-]{32}$/);
  assert.deepStrictEqual(tina[1].body, { message: { type: 'text', text: 'Hi Tenant! Jonjo here. Concierge for your unit.' } });
  assert.ok(posts.every((p) => /^\/contact\/id:\d+\/message$/.test(p.path)), 'only message sends');
  // keep sending batches until everyone was tried; the server-error client ends "unknown" and is never retried
  for (let i = 0; i < 6; i++) { a = (await audience(boss)).data; if (!batch(a, 'message').ids.length) break; await send(boss, { confirm: true, hash: batch(a, 'message').hash, action: 'message' }); }
  const recs = await UpsellSend.find({ campaignId: cid, action: 'message' }).lean(), by = Object.fromEntries(recs.map((r) => [r.leadId, r.status]));
  assert.strictEqual(by['9305'], 'sending', 'server error → unknown'); assert.strictEqual(by['9302'], 'failed'); assert.strictEqual(by['9301'], 'sent');
  a = (await audience(boss)).data;
  assert.ok(!batch(a, 'retry').ids.includes('9305') && batch(a, 'retry').ids.includes('9302'), 'retry: failed yes, unknown no');
  assert.deepStrictEqual(batch(a, 'message').ids, [], 'nobody gets it twice');
  const n = sent.length;
  const retry = await send(boss, { confirm: true, hash: batch(a, 'retry').hash, action: 'message', retry: true });
  assert.strictEqual(retry.status, 200);
  assert.deepStrictEqual(retry.data.results.map((x) => x.id).sort(), batch(a, 'retry').ids.slice().sort());
  assert.ok(sent.slice(n).every((p) => !/555301|555305/.test(p.path)), 'no repeat to sent or unknown clients');
  // the unknown one is settled by a person who checked the chat
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/resolve`, { cookie: await login('viewer'), body: { leadId: '9305', outcome: 'failed' } })).status, 403);
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/resolve`, { cookie: boss, body: { leadId: '9305', outcome: 'failed' } })).status, 200);
  assert.ok(batch((await audience(boss)).data, 'retry').ids.includes('9305'), 'now it can be retried');
  const results = (await call(base, 'GET', `/api/upsell/campaigns/${cid}/results`, { cookie: boss })).data.results;
  assert.ok(results.some((x) => x.name === 'Window Wendy' && x.status === 'failed' && x.attempts >= 2));
  assert.strictEqual((await call(base, 'DELETE', '/api/upsell/campaigns/' + cid, { cookie: boss })).status, 409, 'a sent offer is kept as a record');
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/image`, { cookie: boss, file: PNG(3), name: 'new.png' })).status, 409, 'its image can\'t change after sending');
});

test('tagging for a respond.io broadcast; a VA only reaches their own clients; CSV for email tools', async () => {
  const ana = await login('ana');
  const c = await call(base, 'POST', '/api/upsell/campaigns', { cookie: ana, body: { name: 'Ana tag test', template: 'aircon' } });
  assert.strictEqual(c.status, 201); assert.match(c.data.campaign.text, /aircon/i);
  const id = c.data.campaign.id;
  await call(base, 'PUT', '/api/upsell/campaigns/' + id, { cookie: ana, body: { version: 1, tag: 'Aircon Oct!!', audience: { preset: 'all', statuses: [], type: '', city: '', contact: 'respond', skipDays: 0 } } });
  const a = (await call(base, 'GET', `/api/upsell/campaigns/${id}/audience`, { cookie: ana })).data, n = sent.length;
  const t = await call(base, 'POST', `/api/upsell/campaigns/${id}/send`, { cookie: ana, body: { confirm: true, hash: a.batches.tag.hash, action: 'tag' } });
  assert.strictEqual(t.status, 200, JSON.stringify(t.data));
  const tags = sent.slice(n);
  assert.ok(tags.length >= 2 && tags.every((p) => /^\/contact\/id:\d+\/tag$/.test(p.path) && JSON.stringify(p.body) === '["Aircon Oct"]'), JSON.stringify(tags));
  assert.ok(tags.every((p) => ['555001', '555006', '555301'].includes(p.path.match(/id:(\d+)/)[1])), 'only Ana\'s clients');
  const csv = await call(base, 'GET', `/api/upsell/campaigns/${cid}/csv`, { cookie: await login('boss') });
  assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.text, /^email,first_name,full_name,phone,city,status,rent_or_sale,tenant/);
});

test('an unknown tag result can be settled too; resolve is checked', async () => {
  const boss = await login('boss');
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/resolve`, { cookie: boss, body: { leadId: '9305', outcome: 'sent', action: 'tag' } })).status, 409, 'nothing waiting');
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/resolve`, { cookie: boss, body: { leadId: '9305', outcome: 'sent', action: 'other' } })).status, 400);
  await UpsellSend.create({ campaignId: cid, source: 'monday', leadId: '9305', contactId: '', action: 'tag', status: 'sending' });
  assert.strictEqual((await call(base, 'POST', `/api/upsell/campaigns/${cid}/resolve`, { cookie: boss, body: { leadId: '9305', outcome: 'failed', action: 'tag' } })).status, 200);
});
