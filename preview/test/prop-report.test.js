'use strict';
// Property Requirements report (public/prop-report.js): which leads qualify, RENT vs SALE layout, missing values,
// numbering, and text that pastes cleanly into a chat channel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PR = require('../public/prop-report');
const { computeLead } = require('../src/integrations/pipeline');
const { generate } = require('../public/demo-data');

const DATE = '2026-10-26';
let seq = 0;
const lead = (o) => ({ id: String(++seq), code: 'T-' + seq, name: 'Client ' + seq, phone: '+63 900 555 00' + String(seq).padStart(2, '0'),
  email: 'client' + seq + '@example.com', ai: 'Property Matching', temp: 'Warm', status: 'Qualified', inquiry: 'Rent',
  createdAt: '2026-10-' + String(10 + seq).padStart(2, '0') + 'T09:00:00Z', ...o });
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const blocks = (text) => text.split('\n\n').slice(1);

test('active-lead filter: Property Matching only, minus closed, failed, lost and dead leads', () => {
  const ok = lead({});
  const cases = [
    [ok, true],
    [lead({ temp: 'Hot' }), true], [lead({ temp: 'Cold' }), true],
    [lead({ temp: 'Unchecked' }), true], [lead({ temp: 'Not on Respond.io' }), true],   // chat not read yet is not "inactive"
    [lead({ status: 'New Inquiry' }), true], [lead({ status: '' }), true], [lead({ status: 'Sourcing for Unit' }), true],
    [lead({ ai: 'Scheduling' }), false], [lead({ ai: 'LOI' }), false], [lead({ ai: 'Active' }), false],
    [lead({ ai: 'For Renewal' }), false], [lead({ ai: 'Failed' }), false], [lead({ ai: 'Not on Respond.io' }), false], [lead({ ai: '' }), false],
    [lead({ temp: 'Lost' }), false], [lead({ temp: 'Dead' }), false],
    [lead({ status: 'Closed' }), false], [lead({ status: 'Failed' }), false], [lead({ status: 'Called - Failed' }), false],
    [lead({ status: 'Closed Lost' }), false], [lead({ status: 'Disqualified' }), false], [lead({ status: 'Not interested' }), false],
    [lead({ status: 'Cancelled' }), false],
  ];
  for (const [l, want] of cases) assert.strictEqual(PR.isSourcingLead(l), want, JSON.stringify({ ai: l.ai, temp: l.temp, status: l.status }));
  assert.strictEqual(PR.isSourcingLead(null), false);
  assert.strictEqual(PR.isSourcingLead(undefined), false);
  // "Qualified" contains no inactive word boundary match ("disqualified" does)
  assert.strictEqual(PR.isSourcingLead(lead({ status: 'Qualified' })), true);
});

test('the filter follows the app\'s real status rules for Monday leads (pipeline.computeLead)', () => {
  const now = new Date('2026-10-26T09:00:00+08:00').getTime();
  const monday = (o) => ({ contactId: '555001', inquiry: 'Rent', createdAt: '2026-10-20T01:00:00Z', ...o });
  const status = (o) => { const l = monday(o); return { ...l, ...computeLead(l, null, null, now), status: l.clientStatus || l.nextAction || '' }; };
  const sourcing = status({ nextAction: 'Sourcing for Unit' });
  assert.strictEqual(sourcing.ai, 'Property Matching');
  assert.ok(PR.isSourcingLead(sourcing), 'Next Action "Sourcing for Unit" qualifies');
  assert.ok(PR.isSourcingLead(status({ nextAction: 'New Inquiry' })), 'a new inquiry is matched for properties');
  assert.ok(!PR.isSourcingLead(status({ nextAction: 'Schedule Viewing' })), 'Scheduling does not qualify');
  assert.ok(!PR.isSourcingLead(status({ nextAction: 'Closed Lost' })), 'closed lost → Failed');
  assert.ok(!PR.isSourcingLead(status({ nextAction: 'New Inquiry', clientStatus: 'Failed' })), 'failed by hand on Monday');
  assert.ok(!PR.isSourcingLead(status({ nextAction: 'Moved in' })), 'closed / active tenants');
  // a client who stopped replying 7+ days ago is Dead, even while the stage still says Property Matching
  const quiet = monday({ nextAction: 'New Inquiry' });
  const rs = { waiting: 'client', lastInAt: now - 9 * 864e5, lastAt: now - 9 * 864e5, inCount: 1, total: 3, in48: 0, outAfterIn: 1 };
  const dead = { ...quiet, ...computeLead(quiet, null, rs, now) };
  assert.strictEqual(dead.ai, 'Property Matching');
  assert.strictEqual(dead.temp, 'Dead');
  assert.ok(!PR.isSourcingLead(dead));
});

test('active sourcing leads qualify with or without a respond.io ID; closed/failed/other stages never do', () => {
  const now = new Date('2026-10-26T09:00:00+08:00').getTime();
  const staleLoi = { ds: '2026-10-10', files: 0, cfiles: 0, sfiles: 0, paid: 0 }, freshLoi = { ...staleLoi, ds: '2026-10-24' };
  const status = (o, lm) => { const l = { inquiry: 'Rent', createdAt: '2026-10-20T01:00:00Z', ...o }; return { ...l, ...computeLead(l, lm || null, null, now), status: l.clientStatus || l.nextAction || '' }; };
  for (const contactId of ['555001', '']) {
    const tag = contactId ? 'with Respond ID' : 'no Respond ID';
    const s = (o, lm) => status({ contactId, ...o }, lm);
    // sourcing, from each kind of evidence
    assert.ok(PR.isSourcingLead(s({ nextAction: 'Sourcing for Unit' })), tag + ': Next Action says sourcing');
    assert.ok(PR.isSourcingLead(s({ nextAction: 'New Inquiry' })), tag + ': new inquiry');
    assert.ok(PR.isSourcingLead(s({ nextAction: '', boardStatus: 'Sourcing' })), tag + ': Status column says sourcing');
    assert.ok(PR.isSourcingLead(s({ nextAction: 'Schedule Viewing', aiStatusLabel: 'Property Matching' })), tag + ': Monday AI STATUS');
    assert.ok(PR.isSourcingLead(s({ nextAction: 'Negotiation' }, staleLoi)), tag + ': Calendar LOI unsigned 5+ days → back to matching');
    // not sourcing: other stages
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Schedule Viewing' })), tag + ': scheduling');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Sourcing for Unit' }, freshLoi)), tag + ': Calendar LOI beats the Next Action text');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Sourcing for Unit' }, { ...staleLoi, sfiles: 1, paid: 50000 })), tag + ': paid → Active');
    // not sourcing: closed, failed, lost, dead
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Closed Lost' })), tag + ': closed lost');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Not interested' })), tag + ': not interested');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Moved in' })), tag + ': moved in');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Sourcing for Unit', clientStatus: 'Failed' })), tag + ': failed by hand');
    assert.ok(!PR.isSourcingLead(s({ nextAction: 'Sourcing for Unit', aiStatusLabel: 'Failed' })), tag + ': AI STATUS Failed');
    assert.ok(!PR.isSourcingLead({ ...s({ nextAction: 'Sourcing for Unit' }), temp: 'Dead' }), tag + ': dead');
  }
  // without a Respond ID the AI Status shown in the app is unchanged; only the report looks past it
  const noId = status({ contactId: '', nextAction: 'Sourcing for Unit' });
  assert.deepStrictEqual([noId.ai, noId.workStage, noId.temp], ['Not on Respond.io', 'Property Matching', 'Not on Respond.io']);
  const withId = status({ contactId: '555001', nextAction: 'Sourcing for Unit' });
  assert.strictEqual(withId.workStage, withId.ai);
  // demo / MongoDB records: workStage carries the stage; with nothing but "Not on Respond.io" there is no evidence
  assert.ok(PR.isSourcingLead(lead({ ai: 'Not on Respond.io', workStage: 'Property Matching', temp: 'Not on Respond.io' })));
  assert.ok(!PR.isSourcingLead(lead({ ai: 'Not on Respond.io', workStage: 'Property Matching', status: 'Failed' })));
  assert.ok(!PR.isSourcingLead(lead({ ai: 'Not on Respond.io', workStage: 'Scheduling' })));
  assert.ok(!PR.isSourcingLead(lead({ ai: 'Not on Respond.io' })));
  // booking a viewing moves such a lead out of the report, like any other
  const SH = require('../public/shared');
  const nr = lead({ ai: 'Not on Respond.io', workStage: 'Property Matching' });
  assert.ok(!PR.isSourcingLead({ ...nr, ...SH.bookingLeadChanges(nr) }));
  assert.strictEqual(SH.bookingLeadChanges(nr).ai, undefined, 'the AI Status stays Not on Respond.io');
});

test('pets: only a clear answer is reported; Not Applicable, N/A, Any, blank and unknown → "Not specified"', () => {
  const line = (l) => PR.buildReport([l], DATE).match(/^Pet Friendly\/Not Pet Friendly: .*$/m)[0];
  for (const p of ['', undefined, null, '  ', 'Not Applicable', 'N/A', 'Any', 'Not specified', 'Small pets only', 'Dog'])
    assert.strictEqual(line(lead({ pets: p })), 'Pet Friendly/Not Pet Friendly: Not specified', JSON.stringify(p));
  assert.strictEqual(line(lead({})), 'Pet Friendly/Not Pet Friendly: Not specified', 'field missing');
  for (const p of ['No Pets', 'Not Pet Friendly', 'no pets allowed']) assert.strictEqual(line(lead({ pets: p })), 'Pet Friendly/Not Pet Friendly: Not Pet Friendly', p);
  for (const p of ['With Pets', 'Pet Friendly', 'pets allowed']) assert.strictEqual(line(lead({ pets: p })), 'Pet Friendly/Not Pet Friendly: Pet Friendly', p);
  // MongoDB: a new lead's default is unset, not "No Pets"; a chosen value is stored as is
  const { Lead } = require('../src/models');
  assert.strictEqual(new Lead({ code: 'X', name: 'X' }).pets, '');
  assert.strictEqual(new Lead({ code: 'X', name: 'X', pets: 'No Pets' }).pets, 'No Pets');
  // Monday: an empty or "not stated" cell is unset; an actual answer is kept
  const { shapeLead } = require('../src/integrations/monday');
  const cols = { contactId: 'c', pets: 'p', nextAction: 'n', inquiry: 'i' };
  const monday = (text) => shapeLead({ id: 1, name: 'BH-1', column_values: [{ id: 'p', text }, { id: 'i', text: 'Rent' }] }, cols).pets;
  // the live board's labels are "With Pets", "No Pets" and "Not Applicable"; Not Applicable must never become Pet Friendly
  for (const t of ['', 'N/A', 'Not specified', 'Any', '-', 'Not Applicable', 'not applicable', 'Dog', '1 cat', 'Small pets only']) assert.strictEqual(monday(t), '', JSON.stringify(t));
  for (const t of ['No', 'None', 'No pets', 'No Pets', 'Wala', 'Not pet friendly']) assert.strictEqual(monday(t), 'No Pets', t);
  for (const t of ['Yes', 'With Pets', 'Pet friendly', 'Pets allowed']) assert.strictEqual(monday(t), 'With Pets', t);
  // demo data has both explicit and unset preferences
  const pets = generate(new Date('2026-10-22T09:00:00Z')).leads.map((l) => l.pets);
  assert.ok(pets.includes('') && pets.includes('No Pets') && pets.includes('With Pets'));
});

test('RENT block: every field in order, monthly price, furnishing and pets lines', () => {
  const l = lead({ budget: 85000, city: 'Makati', building: 'Acacia Demo Residences', sqm: '45-60', bedrooms: '2', bathrooms: '1',
    parking: '1 Slot', furnishing: 'Fully Furnished', pets: 'With Pets' });
  assert.strictEqual(PR.buildReport([l], DATE), [
    'Property Requirements for today October 26, 2026', '',
    '1. RENT',
    'Price: ₱85,000/month',
    'Location: Makati',
    'Specific Building: Acacia Demo Residences',
    'SQM: 45-60',
    'Bedroom: 2',
    'Bathroom: 1',
    'Parking: 1 Slot',
    'Furnished/Unfurnished: Fully Furnished',
    'Pet Friendly/Not Pet Friendly: Pet Friendly'].join('\n'));
  assert.match(PR.buildReport([lead({ pets: 'No Pets' })], DATE), /^Pet Friendly\/Not Pet Friendly: Not Pet Friendly$/m);
});

test('SALE block: no furnishing or pet lines, price without /month', () => {
  const l = lead({ inquiry: 'Buy', budget: 25000000, city: 'Taguig (BGC)', sqm: '120', bedrooms: '3', bathrooms: '2', parking: '2 Slots',
    furnishing: 'Fully Furnished', pets: 'With Pets' });
  const text = PR.buildReport([l], DATE);
  assert.strictEqual(blocks(text)[0], ['1. SALE', 'Price: ₱25,000,000', 'Location: Taguig (BGC)', 'Specific Building: Not specified',
    'SQM: 120', 'Bedroom: 3', 'Bathroom: 2', 'Parking: 2 Slots'].join('\n'));
  assert.doesNotMatch(text, /Furnished|Pet Friendly|\/month/);
});

test('missing values show "Not specified" and nothing is made up', () => {
  const l = lead({ budget: 0, city: '', location: '', building: '', sqm: '  ', bedrooms: '', bathrooms: undefined, parking: null, furnishing: '', pets: '' });
  assert.strictEqual(blocks(PR.buildReport([l], DATE))[0], ['1. RENT', 'Price: Not specified', 'Location: Not specified',
    'Specific Building: Not specified', 'SQM: Not specified', 'Bedroom: Not specified', 'Bathroom: Not specified', 'Parking: Not specified',
    'Furnished/Unfurnished: Not specified', 'Pet Friendly/Not Pet Friendly: Not specified'].join('\n'));
  // Location is the structured City only: with no City it says so, and the free-text location / requirements never appear
  const freeText = PR.buildReport([lead({ city: '', location: 'Salcedo Village, c/o Maria 0900 555 0161', requirements: 'call Maria' })], DATE);
  assert.match(freeText, /^Location: Not specified$/m);
  assert.doesNotMatch(freeText, /Salcedo|Maria|0900 555 0161|call/);
  // unknown Rent/Sale: said so, and the rent-only lines are left out
  const unknown = blocks(PR.buildReport([lead({ inquiry: '' })], DATE))[0];
  assert.match(unknown, /^1\. RENT\/SALE: Not specified$/m);
  assert.doesNotMatch(unknown, /Furnished|Pet Friendly/);
  assert.strictEqual(PR.dateLabel('not a date'), 'Not specified');
});

test('numbering runs 1..n over qualifying leads only: rentals first, then sales, oldest first', () => {
  const leads = [
    lead({ inquiry: 'Buy', city: 'S-new', createdAt: '2026-10-20T00:00:00Z' }),
    lead({ inquiry: 'Rent', city: 'R-new', createdAt: '2026-10-19T00:00:00Z' }),
    lead({ inquiry: 'Rent', city: 'X-failed', ai: 'Failed' }),
    lead({ inquiry: 'Buy', city: 'S-old', createdAt: '2026-10-01T00:00:00Z' }),
    lead({ inquiry: 'Rent', city: 'X-dead', temp: 'Dead' }),
    lead({ inquiry: 'Rent', city: 'R-old', createdAt: '2026-10-02T00:00:00Z' }),
    lead({ inquiry: 'Rent', city: 'X-closed', status: 'Closed' }),
  ];
  const text = PR.buildReport(deepFreeze(leads), DATE);   // frozen: the report never changes the records
  const heads = text.match(/^\d+\. .+$/gm), places = text.match(/^Location: .+$/gm).map((s) => s.slice(10));
  assert.deepStrictEqual(heads, ['1. RENT', '2. RENT', '3. SALE', '4. SALE']);
  assert.deepStrictEqual(places, ['R-old', 'R-new', 'S-old', 'S-new']);
  assert.doesNotMatch(text, /X-/);
});

test('copy-ready output: plain text, chosen date in the heading, no client details, no stray whitespace', () => {
  const l = lead({ name: 'Maria Secret', phone: '+63 900 555 1234', email: 'maria@example.com', code: 'BH-777',
    city: 'Makati\nCBD', building: 'Tower <A> & "B"', sqm: '50\t+', budget: 60000, bedrooms: 'Studio' });
  const text = PR.buildReport([l, lead({ inquiry: 'Buy', budget: 1 })], '2027-01-05');
  assert.ok(text.startsWith('Property Requirements for today January 5, 2027\n\n1. RENT\n'));
  assert.match(text, /^Location: Makati CBD$/m, 'line breaks inside a value are collapsed');
  assert.match(text, /^Specific Building: Tower <A> & "B"$/m, 'plain text, not HTML-escaped');
  assert.match(text, /^SQM: 50 \+$/m);
  assert.match(text, /^Bedroom: Studio$/m);
  assert.ok(text.includes('Pet Friendly/Not Pet Friendly: Not specified\n\n2. SALE\n'), 'one blank line between requirements');
  assert.doesNotMatch(text, /Maria|Secret|555 1234|maria@|BH-777/, 'no names, phone numbers, emails or lead IDs');
  assert.doesNotMatch(text, /\r|\t|&amp;|&lt;|<br|undefined|null|NaN/);
  for (const line of text.split('\n')) assert.strictEqual(line, line.trimEnd(), 'no trailing spaces: ' + JSON.stringify(line));
  assert.ok(!text.endsWith('\n'));
  assert.strictEqual(PR.buildReport([], DATE), 'Property Requirements for today October 26, 2026\n\nNo active property-sourcing requirements.');
});

test('demo data: report lists exactly the qualifying leads, each fully formatted', () => {
  const d = generate(new Date('2026-10-22T09:00:00Z'));
  const want = d.leads.filter(PR.isSourcingLead);
  assert.ok(want.length > 3, 'demo set has property-sourcing leads');
  const text = PR.buildReport(d.leads, DATE), bs = blocks(text);
  assert.strictEqual(bs.length, want.length);
  bs.forEach((b, i) => {
    const sale = b.startsWith(`${i + 1}. SALE`);
    assert.ok(sale || b.startsWith(`${i + 1}. RENT`), b);
    assert.strictEqual(b.split('\n').length, sale ? 8 : 10, b);
  });
});

test('the report module is read-only: no network, storage or writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'prop-report.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|BH_API|viber/i);
});
