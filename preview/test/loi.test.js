'use strict';
// LOI and Contract tabs: the LOI pre-fill rules (Code.gs apiLoiDefaults), filling the team's Word template
// (fillLoiDoc_) and the LOI routes, with an in-memory MongoDB, the fake Monday board and a made-up template (the team's
// real templates are never used in tests). Nothing is sent or signed: the routes have no way to.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, Loi } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const docx = require('../src/docx');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];

// a made-up LOI shaped like the team's: blank header lines, an Annex A table (empty value cells are self-closing
// paragraphs), the commission line and the signature captions
const P = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const ROW = (label, value) => `<w:tr><w:tc><w:tcPr/>${P(label)}</w:tc><w:tc><w:tcPr/>${value == null ? '<w:p w:rsidR="00C1"/>' : P(value)}</w:tc></w:tr>`;
function fakeTemplate(kind) {
  const lease = kind === 'lease';
  const body = [P('Date: _______________'), P('To:      _______________________________'), P('            _______________________________'), P('            _______________________________'),
    P(lease ? 'RE:     LETTER OF INTENT TO LEASE' : 'RE:     LETTER OF INTENT TO PURCHASE'), P('Dear _______________:'),
    `<w:tbl>${ROW(lease ? 'Lessor' : 'Seller')}${ROW(lease ? 'Lessee' : 'Buyer')}${ROW('Property')}${lease ? ROW('Lease Term') + ROW('Monthly Rental') + ROW('Advance Rental') + ROW('Security Deposit') : ROW('Total Purchase Price') + ROW('Terms of Payment', 'Full payment upon signing')}
      ${ROW("Broker's Commission", 'Equivalent to _____% (_____ percent) of the price.')}${ROW('Other Concessions', 'Pets included etc.')}</w:tbl>`,
    P('_______________________________'), P('Print Name &amp; Signature'), P('_______________________________'), P(lease ? 'LESSOR' : 'SELLER'), P('BLACKHOUSE INC. — Broker')].join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'word/document.xml', data: Buffer.from(xml) }]);
}
/** Every element opened is closed, in order (the filled XML is still well-formed). */
function balanced(xml) {
  const stack = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue; if (!m[1]) stack.push(m[2]); else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

let mem, server, base, fake;
const cookies = {};
async function call(method, url, { body, cookie, file, name } = {}) {
  const headers = {}; if (cookie) headers.cookie = cookie;
  if (file) { headers['content-type'] = 'application/octet-stream'; headers['x-file-name'] = name || 'x.docx'; } else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: file || (body === undefined ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer()); let data = null; try { data = JSON.parse(buf.toString()); } catch (e) { /* not JSON */ }
  return { status: res.status, data, buf, headers: res.headers };
}
async function login(who) {
  if (cookies[who]) return cookies[who];
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who); return (cookies[who] = r.headers.get('set-cookie').split(';')[0]);
}

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  ({ server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_loi'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222',
    MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: `http://127.0.0.1:${fake.address().port}/monday` }, ARGV));
  base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Boss', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit' }, passwordHash },
    { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: 'settings@example.com', name: 'Settings Editor', role: 'Broker', modules: { team: 'edit' }, passwordHash },
    { email: 'nobody@example.com', name: 'No Access', role: 'Broker', modules: { pages: 'view' }, passwordHash }]);
});
test.after(async () => { server.close(); fake.close(); server.closeAllConnections(); fake.closeAllConnections(); await mongoose.disconnect(); await mem.stop(); });

const LEASE_FIELDS = { DATE: 'October 29, 2026', TO_1: 'Fake Owner', TO_2: 'Unit 9Z, Fake Tower', TO_3: 'Faketown', DEAR: 'Fake Owner', CLIENT: 'Test Client One', BROKER_SIGN: 'Ely Santos',
  PROPERTY: 'Unit 9Z, Fake Tower, Faketown (2 BR)', LEASE_TERM: 'One (1) year', MONTHLY_RENT: '₱45,000', ADVANCE: 'One (1) month', DEPOSIT: 'Two (2) months', CONCESSIONS: '', COMM_PCT: '2.5' };

test('pre-fill: values only from the records, missing ones empty, conflicts flagged (Code.gs apiLoiDefaults)', () => {
  const lead = { name: 'Test Client One', inquiry: 'Rent', salesperson: 'Gia Cruz', leaseTerm: '', pets: '' };
  const listings = [{ id: 'a', building: 'Fake Tower', tower: 'Unit 9Z', cityRaw: 'Faketown', type: 'For Rent', price: 45000, bedrooms: '2', contact: 'Fake Owner' },
    { id: 'b', building: 'Fake Tower', tower: 'Unit 1A', cityRaw: 'Faketown', type: 'For Rent', price: 47000, bedrooms: '1', contact: 'Other Owner' },
    { id: 'c', building: 'Other Place', tower: 'Unit 2', type: 'For Rent', price: 45000, contact: 'X' }];
  const m = SH.loiListing(listings, 'Fake Tower', 46000);
  assert.deepStrictEqual([m.listing.id, m.ambiguous], ['a', true]);                                   // closest price, and two candidates
  assert.strictEqual(SH.loiListing(listings, 'Fake Tower', 90000).listing, null);                    // more than 15 % away: no listing
  const d = SH.loiDraft({ lead, listing: m.listing, deal: { sp: 'Ely Santos', rate: 46000, building: 'Fake Tower' }, ambiguous: true, today: '2026-10-29' });
  const v = Object.fromEntries(d.fields.map((x) => [x.key, x]));
  assert.deepStrictEqual([d.lease, v.TO_1.value, v.CLIENT.value, v.BROKER_SIGN.value, v.MONTHLY_RENT.value, v.PROPERTY.value],
    [true, 'Fake Owner', 'Test Client One', 'Ely Santos', '₱45,000', 'Unit 9Z, Fake Tower, Faketown (2 BR)']);
  assert.deepStrictEqual([v.LEASE_TERM.state, v.COMM_PCT.value, v.COMM_PCT.state], ['default', '', 'entered']);   // the original's default term; commission is typed
  assert.ok(d.warnings.some((w) => /more than one listing/i.test(w)) && d.warnings.some((w) => /differs from the Calendar/.test(w)) && d.warnings.some((w) => /viewing's broker/.test(w)));
  // no listing: owner, property and price are missing (never guessed)
  const none = Object.fromEntries(SH.loiDraft({ lead, listing: null, deal: { building: 'Nowhere' }, today: '2026-10-29' }).fields.map((x) => [x.key, x]));
  assert.deepStrictEqual([none.TO_1.state, none.MONTHLY_RENT.state, none.DEAR.value], ['missing', 'missing', 'Sir/Madam']);
  // a rent client and a sale listing: flagged
  assert.ok(SH.loiDraft({ lead, listing: { ...listings[0], type: 'For Sale' }, deal: null, today: '2026-10-29' }).warnings.some((w) => /For Sale.*Rent/.test(w)));
});

test('deal stages: the latest Calendar item, its file columns and the 5-day rules', () => {
  const s = SH.dealStages([{ id: '1', fin: '2026-09-01' }, { id: '2', loi: '2026-10-01', contract: '2026-10-10', files: { signed: false } }], '2026-10-29');
  assert.strictEqual(s.deal.id, '2'); assert.strictEqual(s.others, 1);
  assert.ok(s.warnings.some((w) => /Contract Date was 19 days ago and no Signed Contract/.test(w)));
  assert.ok(SH.dealStages([{ id: '3', loi: '2026-10-20' }], '2026-10-29').warnings.some((w) => /owner hasn't signed/.test(w)));
  assert.deepStrictEqual(SH.dealStages([{ id: '4', loi: '2026-10-27' }], '2026-10-29').warnings, []);
  assert.strictEqual(SH.dealStages([], '2026-10-29'), null);
  // the deal row (Contract Date) wins over a newer viewing row with only an LOI date
  assert.strictEqual(SH.dealStages([{ id: 'v', loi: '2026-10-27' }, { id: 'deal', contract: '2026-10-09' }], '2026-10-29').deal.id, 'deal');
  // Code.gs loiMap_ / stage rules: failed items don't count; files and payments count across the client's items;
  // payment or a signed contract ends the contract rule; a contract file is the owner's signature of the LOI
  const failedLoi = SH.dealStages([{ id: 'f', loi: '2026-10-27', status: 'Failed' }, { id: 'ok', loi: '2026-10-01', group: 'Deals' }, { id: 'arch', contract: '2026-10-20', group: 'Archive' }], '2026-10-29');
  assert.deepStrictEqual([failedLoi.deal.id, failedLoi.failed], ['ok', 2]);
  assert.deepStrictEqual(SH.dealStages([{ id: 'f', loi: '2026-10-27', status: 'Failed' }], '2026-10-29').deal, null);
  assert.deepStrictEqual(SH.dealStages([{ id: 'c', contract: '2026-10-01', paid: 30000 }], '2026-10-29').warnings, [], 'paid: Active, no rule');
  assert.deepStrictEqual(SH.dealStages([{ id: 'c', contract: '2026-10-01' }, { id: 's', files: { signed: true } }], '2026-10-29').warnings, [], 'signed on another item');
  assert.deepStrictEqual(SH.dealStages([{ id: 'l', loi: '2026-10-01', files: { contract: true } }], '2026-10-29').warnings, [], 'contract file: the owner signed');
  assert.strictEqual(SH.dealStages([{ id: 'a', contract: '2026-10-28' }, { id: 'b', fin: '2026-09-01', files: { loi: true } }], '2026-10-29').deal.files.loi, true, 'LOI file on another item');
});

test('the template reader refuses zip bombs and damaged files; values are written literally and safely', () => {
  const tpl = fakeTemplate('lease');
  // two directory entries pointing at the same data (the overlapping-entry zip bomb)
  const parts = docx.unzip(tpl), dup = docx.zip(parts.concat([parts[1]]));
  const eocd = dup.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), cd = dup.readUInt32LE(eocd + 16);
  let p = cd; const offs = [];
  for (let i = 0; i < 3; i++) { offs.push(p); p += 46 + dup.readUInt16LE(p + 28); }
  dup.writeUInt32LE(dup.readUInt32LE(offs[1] + 42), offs[2] + 42);   // third entry → second entry's data
  assert.throws(() => docx.unzip(dup), /damaged/);
  // a declared size that doesn't match the data
  const lie = Buffer.from(tpl), lieCd = lie.readUInt32LE(lie.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16);
  lie.writeUInt32LE(1, lieCd + 24);
  assert.throws(() => docx.unzip(lie), /damaged/);
  assert.match(docx.userMessage(new RangeError('Cannot create a Buffer larger than 4294967295')), /could not be read/);
  // "$&" and the like are kept as typed; control characters are removed; XML-special characters are escaped
  const { value } = SH.validateLoi({ slot: 'lease', fields: { ...LEASE_FIELDS, TO_1: 'A $& B <C> & "D"\u0001', DEAR: 'Owner $1', CLIENT: 'Tom\u0007 Lee' } });
  assert.strictEqual(value.fields.TO_1, 'A $& B <C> & "D"');
  const out = docx.fillLoi(tpl, value.fields), t = docx.docText(out), xml = docx.unzip(out).find((e) => e.name === 'word/document.xml').data.toString();
  assert.ok(t.some((x) => x.includes('To:      A $& B <C> & "D"')) && t.some((x) => x.includes('Dear Owner $1:')) && t.some((x) => x.includes('Tom Lee')));
  assert.ok(balanced(xml) && !/[\u0000-\u0008]/.test(xml));
  // an unknown {{PLACEHOLDER}} stays as written; known ones are filled
  const ph = docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'word/document.xml', data: Buffer.from(`<w:document xmlns:w="w"><w:body>${P('LETTER OF INTENT TO LEASE')}${P('{{CLIENT}} {{SOMETHING_ELSE}}')}</w:body></w:document>`) }]);
  assert.ok(docx.docText(docx.fillLoi(ph, value.fields)).includes('Tom Lee {{SOMETHING_ELSE}}'));
  // the original's Terms of Payment for a sale when none is typed; a typed one is kept
  assert.match(SH.validateLoi({ slot: 'absolute', fields: { ...LEASE_FIELDS, PRICE: '₱1' } }).value.fields.TERMS, /Deed of Absolute Sale/);
  assert.match(SH.validateLoi({ slot: 'conditional', fields: { ...LEASE_FIELDS, PRICE: '₱1' } }).value.fields.TERMS, /payment schedule/);
  assert.strictEqual(SH.validateLoi({ slot: 'conditional', fields: { ...LEASE_FIELDS, TERMS: '30 % down' } }).value.fields.TERMS, '30 % down');
  assert.strictEqual(SH.validateLoi({ slot: 'lease', fields: LEASE_FIELDS }).value.fields.TERMS, '');
});

test('the form: allowed fields only, missing values listed (not filled), commission words, owner and client names follow', () => {
  const r = SH.validateLoi({ slot: 'lease', fields: { ...LEASE_FIELDS, MONTHLY_RENT: '' } });
  assert.deepStrictEqual(r.missing, ['Monthly rent']);
  assert.deepStrictEqual([r.value.fields.OWNER, r.value.fields.OWNER_SIGN, r.value.fields.CLIENT_SIGN, r.value.fields.COMM_WORDS, r.value.fields.PRICE], ['Fake Owner', 'Fake Owner', 'Test Client One', 'Two point five', '']);
  assert.match(SH.validateLoi({ slot: 'lease', fields: { ...LEASE_FIELDS, COMM_PCT: '150' } }).errors[0], /0 to 100/);
  assert.match(SH.validateLoi({ slot: 'lease', fields: { OWNER: 'x' } }).errors[0], /Invalid/);
  assert.match(SH.validateLoi({ slot: 'contract', fields: {} }).errors[0], /Invalid/);
  assert.deepStrictEqual(SH.validateLoi({ slot: 'absolute', fields: { ...LEASE_FIELDS, PRICE: '' } }).missing, ['Price']);
});

test('filling: the made-up lease template gets every value; empty values stay blank lines; the XML stays well-formed', () => {
  const tpl = fakeTemplate('lease'), { value } = SH.validateLoi({ slot: 'lease', fields: { ...LEASE_FIELDS, TO_3: '' } });
  const out = docx.fillLoi(tpl, value.fields), t = docx.docText(out), xml = docx.unzip(out).find((e) => e.name === 'word/document.xml').data.toString();
  const has = (s) => t.some((x) => x.includes(s));
  for (const s of ['Date: October 29, 2026', 'To:      Fake Owner', 'Unit 9Z, Fake Tower', 'Dear Fake Owner:', 'Test Client One', '₱45,000', 'Two (2) months', 'One (1) year', '2.5% (two point five percent)', 'Fake Owner — LESSOR', 'Ely Santos — BLACKHOUSE INC. — Broker', 'Test Client One — Print Name & Signature']) assert.ok(has(s), s);
  assert.ok(t.includes('            _______________________________'), 'TO_3 was empty: its blank line stays');
  assert.ok(has('—') && !has('Pets included etc.'), 'empty concessions replace the template\'s example');
  assert.ok(balanced(xml), 'well-formed');
  // the template itself is unchanged
  assert.ok(docx.docText(tpl).includes('Date: _______________'));
  assert.throws(() => docx.checkTemplate(Buffer.from('not a zip at all, just text padding to be long enough')), /Not a \.docx/);
  assert.throws(() => docx.checkTemplate(docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('x') }, { name: 'word/document.xml', data: Buffer.from(P('A memo')) }])), /doesn't look like an LOI/);
});

test('routes: templates by Settings editors only; an LOI is made for a visible lead from the reviewed fields, downloadable, never sent', async () => {
  const boss = await login('boss'), ana = await login('ana'), viewer = await login('viewer');
  // templates
  assert.strictEqual((await call('POST', '/api/loi/templates/lease', { cookie: ana, file: fakeTemplate('lease') })).status, 403);
  assert.strictEqual((await call('POST', '/api/loi/templates/lease', { cookie: boss, file: Buffer.from('plain text, not a document at all.....') })).status, 400);
  assert.match((await call('POST', '/api/loi/templates/lease', { cookie: boss, file: fakeTemplate('sale') })).data.error, /sale LOI/);
  const up = await call('POST', '/api/loi/templates/lease', { cookie: boss, file: fakeTemplate('lease'), name: 'Lease LOI.docx' });
  assert.strictEqual(up.status, 201, JSON.stringify(up.data));
  const list = await call('GET', '/api/loi/templates', { cookie: ana });
  assert.deepStrictEqual(list.data.templates.map((t) => [t.slot, t.name]), [['lease', 'Lease LOI.docx']]);
  assert.ok(!JSON.stringify(list.data).includes('LETTER OF INTENT'), 'template contents are never listed');
  // an LOI for Monday lead 9001 (Ana's)
  const url = '/api/loi/monday/9001';
  assert.strictEqual((await call('POST', url, { cookie: viewer, body: { slot: 'lease', fields: LEASE_FIELDS } })).status, 403, 'view access can\'t make one');
  assert.strictEqual((await call('POST', url, { cookie: ana, body: { slot: 'absolute', fields: LEASE_FIELDS } })).status, 409, 'no sale template uploaded');
  assert.strictEqual((await call('POST', '/api/loi/monday/9003', { cookie: ana, body: { slot: 'lease', fields: LEASE_FIELDS } })).status, 404, 'Bea\'s lead is not Ana\'s');
  const made = await call('POST', url, { cookie: ana, body: { slot: 'lease', fields: { ...LEASE_FIELDS, MONTHLY_RENT: '' } } });
  assert.strictEqual(made.status, 201, JSON.stringify(made.data));
  assert.deepStrictEqual([made.data.loi.status, made.data.loi.missing, made.data.loi.by], ['draft', ['Monthly rent'], 'Ana Agent']);
  const mine = await call('GET', url, { cookie: viewer });
  assert.deepStrictEqual([mine.data.lois.length, mine.data.signing.enabled, mine.data.signing.ready], [1, false, false]);
  const dl = await call('GET', `${url}/${made.data.loi.id}/docx`, { cookie: viewer });
  assert.strictEqual(dl.status, 200, dl.buf.toString().slice(0, 200)); assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.ok(docx.docText(dl.buf).some((x) => x.includes('Test Client One')));
  assert.strictEqual((await call('GET', `/api/loi/monday/9003/${made.data.loi.id}/docx`, { cookie: boss })).status, 404, 'only under its own lead');
  assert.strictEqual(await Loi.countDocuments(), 1);
  // with signing switched off (this server has no LOI_SIGNING), sending is refused and says what's needed
  const off = await call('POST', `${url}/${made.data.loi.id}/send`, { cookie: boss, body: { role: 'client', channel: 'link', confirm: true } });
  assert.strictEqual(off.status, 409); assert.ok(off.data.needs.some((n) => /LOI_SIGNING/.test(n)));
  assert.strictEqual(await require('../src/models').LoiSignLink.countDocuments(), 0);
  // Settings editors without Leads access can see and manage the templates; members with neither can't list them
  const settings = await login('settings'), nobody = await login('nobody');
  assert.strictEqual((await call('GET', '/api/loi/templates', { cookie: settings })).status, 200);
  assert.strictEqual((await call('GET', '/api/loi/templates', { cookie: nobody })).status, 403);
  assert.strictEqual((await call('DELETE', '/api/loi/templates/lease', { cookie: ana })).status, 403, 'Leads editors can\'t remove templates');
  // only the three template paths accept a file body; other LOI paths stay JSON-only
  for (const p of ['/api/loi/templates/other', url]) assert.strictEqual((await call('POST', p, { cookie: boss, file: fakeTemplate('lease') })).status, 415, p);
  // a MongoDB-source lead that doesn't exist / isn't visible
  assert.strictEqual((await call('GET', '/api/loi/mongo/0123456789abcdef01234567', { cookie: boss })).status, 404);
  assert.strictEqual((await call('DELETE', '/api/loi/templates/lease', { cookie: settings })).status, 200);
});
