'use strict';
// Client Requirements message (public/client-req.js): who qualifies (the app's own Property Sourcing rule), the exact
// RENT / SALE layout, missing values, numbering and order, privacy, copy-ready text and the Manila business date.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CR = require('../public/client-req');
const PR = require('../public/prop-report');
const SH = require('../public/shared');
const { computeLead } = require('../src/integrations/pipeline');
const { generate } = require('../public/demo-data');

const DATE = '2026-10-27';
let seq = 0;
// every lead carries a name, phone, email, code and ID, so the privacy checks have something to catch
const lead = (o) => ({ id: 'L' + (++seq), code: 'BH-' + (700 + seq), name: 'Maria Santos ' + seq, phone: '+63 900 555 ' + String(1000 + seq),
  email: 'maria' + seq + '@example.com', contactId: '5550' + seq, ai: 'Property Matching', temp: 'Warm', status: 'Qualified', inquiry: 'Rent',
  createdAt: '2026-10-' + String(10 + (seq % 15)).padStart(2, '0') + 'T09:00:00Z', ...o });
const msg = (leads) => CR.buildMessage(leads, DATE);
const blocks = (text) => text.split('\n\n').slice(1);
const NOW = new Date('2026-10-27T09:00:00+08:00').getTime();
/** A Monday-shaped lead after the app's real status rules (pipeline.computeLead), as /api/monday/bootstrap sends it. */
const monday = (o, lm, rs) => { const l = { inquiry: 'Rent', createdAt: '2026-10-20T01:00:00Z', city: 'Makati', ...o }; return { ...l, ...computeLead(l, lm || null, rs || null, NOW), status: l.clientStatus || l.nextAction || '' }; };

test('eligibility: active Property Sourcing clients qualify, with or without a respond.io ID', () => {
  for (const contactId of ['555001', '']) {
    const tag = contactId ? 'with Respond ID' : 'no Respond ID';
    const s = monday({ contactId, nextAction: 'Sourcing for Unit' });
    assert.strictEqual(s.workStage, 'Property Matching', tag);
    if (!contactId) assert.strictEqual(s.ai, 'Not on Respond.io', 'no chat linked, but the stage still comes from Monday');
    assert.strictEqual(CR.clients([s]).length, 1, tag + ': qualifies');
    assert.strictEqual(CR.clients([monday({ contactId, nextAction: 'New Inquiry' })]).length, 1, tag + ': new inquiry is sourcing');
  }
  // the same leads as Property Requirements, always (one rule for both reports)
  const mix = [lead({}), lead({ ai: 'Scheduling' }), lead({ temp: 'Dead' }), lead({ ai: 'Not on Respond.io', workStage: 'Property Matching' })];
  assert.deepStrictEqual(CR.clients(mix).map((l) => l.id), PR.sourcingLeads(mix).map((l) => l.id));
});

test('exclusions: other stages, failed / closed / lost / dead, Unresponsive, portal Failed override', () => {
  const ex = {
    scheduling: monday({ nextAction: 'Schedule Viewing' }),
    closedLost: monday({ nextAction: 'Closed Lost' }),
    failedOnMonday: monday({ nextAction: 'New Inquiry', clientStatus: 'Failed' }),
    unresponsive: monday({ nextAction: 'New Inquiry', clientStatus: 'Unresponsive' }),
    movedIn: monday({ nextAction: 'Moved in' }),
    activeByProof: monday({ nextAction: 'New Inquiry' }, { ds: '', dc: '', cd: '2026-10-01', files: 0, cfiles: 1, sfiles: 1, paid: 50000 }),
    freshLoi: monday({ nextAction: 'New Inquiry' }, { ds: '2026-10-25', dc: '', cd: '', files: 0, cfiles: 0, sfiles: 0, paid: 0 }),
    dead: monday({ contactId: '555001', nextAction: 'New Inquiry' }, null, { waiting: 'client', lastInAt: NOW - 9 * 864e5, lastAt: NOW - 9 * 864e5, inCount: 1, total: 3, in48: 0, outAfterIn: 1 }),
    lost: lead({ temp: 'Lost' }), closed: lead({ status: 'Closed' }), disqualified: lead({ status: 'Disqualified' }),
    unresponsiveText: monday({ nextAction: 'Unresponsive' }), unresponsiveStatus: lead({ status: 'Unresponsive' }),
    noChatNoStage: lead({ ai: 'Not on Respond.io' }), renewal: lead({ ai: 'For Renewal' }),
    override: SH.applyOverride(lead({}), { failed: { reason: 'Not responsive', by: 'Manager', at: new Date() } }),
  };
  assert.strictEqual(ex.unresponsive.ai, 'Failed');
  for (const [k, l] of Object.entries(ex)) assert.strictEqual(CR.clients([l]).length, 0, k + ' must not qualify');
  assert.deepStrictEqual(CR.clients([null, undefined, lead({})]).length, 1);
  assert.strictEqual(msg(Object.values(ex)), 'Client Requirements for October 27, 2026\n\nNo active Property Sourcing clients today.');
});

test('RENT block: exact layout, Building Name first when given, furnishing and pets, monthly budget', () => {
  const l = lead({ inquiry: 'Rent', building: 'Demo Tower One', city: 'Taguig (BGC)', sqm: '70+', bedrooms: '2', bathrooms: '2', parking: '1 Slot',
    furnishing: 'Fully Furnished', pets: 'With Pets', budget: 150000 });
  assert.strictEqual(blocks(msg([l]))[0], ['1. Client 1', 'RENT', 'Building Name: Demo Tower One', 'Location: Taguig (BGC)', 'SQM: 70+', 'Bedroom: 2',
    'Bathroom: 2', 'Parking: 1 Slot', 'Furnished/Unfurnished: Fully Furnished', 'Pet Friendly/Not Pet Friendly: Pet Friendly', 'Budget: ₱150,000/month'].join('\n'));
  assert.match(msg([lead({ pets: 'No Pets' })]), /^Pet Friendly\/Not Pet Friendly: Not Pet Friendly$/m);
});

test('SALE block: no furnishing or pet lines, budget without /month; unknown type says so', () => {
  const s = lead({ inquiry: 'Buy', city: 'Makati', sqm: '120', bedrooms: '3', bathrooms: '3', parking: '2 Slots', furnishing: 'Unfurnished', pets: 'With Pets', budget: 25e6 });
  assert.strictEqual(blocks(msg([s]))[0], ['1. Client 1', 'SALE', 'Location: Makati', 'SQM: 120', 'Bedroom: 3', 'Bathroom: 3', 'Parking: 2 Slots', 'Budget: ₱25,000,000'].join('\n'));
  const u = blocks(msg([lead({ inquiry: '', budget: 90000 })]))[0];
  assert.match(u, /^RENT\/SALE: Not specified$/m);
  assert.doesNotMatch(u, /Furnished|Pet Friendly|\/month/);
});

test('missing values: "Not specified"; blank Building Name line left out; nothing is guessed', () => {
  for (const blank of [undefined, null, '', '   ']) {
    const b = blocks(msg([lead({ building: blank, city: blank, location: blank, sqm: blank, bedrooms: blank, bathrooms: blank, parking: blank, furnishing: blank, pets: blank, budget: blank })]))[0];
    assert.strictEqual(b, ['1. Client 1', 'RENT', 'Location: Not specified', 'SQM: Not specified', 'Bedroom: Not specified', 'Bathroom: Not specified',
      'Parking: Not specified', 'Furnished/Unfurnished: Not specified', 'Pet Friendly/Not Pet Friendly: Not specified', 'Budget: Not specified'].join('\n'), JSON.stringify(blank));
  }
  assert.match(msg([lead({ budget: 0 })]), /^Budget: Not specified$/m);
  assert.match(msg([lead({ budget: 'abc' })]), /^Budget: Not specified$/m);
  // Location is the structured City only: with no City it says so, and the free-text Client Requirements text never appears
  for (const city of ['', undefined, '  ']) {
    const t = msg([lead({ city, location: 'Near Ayala Triangle, c/o Maria 0900 555 0187', requirements: 'call Maria' })]);
    assert.match(t, /^Location: Not specified$/m, JSON.stringify(city));
    assert.doesNotMatch(t, /Ayala|Maria|0900 555 0187|call/);
  }
  assert.match(msg([lead({ city: 'Makati', location: 'Near Ayala Triangle' })]), /^Location: Makati$/m, 'City wins; the free text is never added');
  assert.match(msg([lead({ pets: '' })]), /^Pet Friendly\/Not Pet Friendly: Not specified$/m);
  // pet wording (shared with Property Requirements): Not Applicable never becomes Pet Friendly
  const petLine = (p) => msg([lead({ pets: p })]).match(/^Pet Friendly\/Not Pet Friendly: (.*)$/m)[1];
  for (const p of ['Not Applicable', 'N/A', 'Any', 'Not specified', '', '  ', undefined, 'Small pets only', 'Dog']) assert.strictEqual(petLine(p), 'Not specified', JSON.stringify(p));
  for (const p of ['With Pets', 'Pet Friendly']) assert.strictEqual(petLine(p), 'Pet Friendly', p);
  for (const p of ['No Pets', 'Not Pet Friendly']) assert.strictEqual(petLine(p), 'Not Pet Friendly', p);
  const { shapeLead } = require('../src/integrations/monday');
  const fromMonday = shapeLead({ id: 1, name: 'x', column_values: [{ id: 'p', text: 'Not Applicable' }, { id: 'i', text: 'Rent' }] }, { contactId: 'c', pets: 'p', nextAction: 'n', inquiry: 'i' });
  assert.strictEqual(petLine(fromMonday.pets), 'Not specified', 'live label "Not Applicable" end to end');
  assert.match(msg([lead({ city: '', location: 'Near Ayala Triangle' })]), /^Location: Not specified$/m, 'no fallback to free text');
  // values are passed through as stored (Monday labels too), never mapped to something else
  assert.match(msg([lead({ parking: 'With 1 slot (tandem)' })]), /^Parking: With 1 slot \(tandem\)$/m);
});

test('numbering and order: 1..n over qualifying clients only; rentals first, then sales, oldest inquiry first', () => {
  const leads = [
    lead({ inquiry: 'Buy', createdAt: '2026-10-01T00:00:00Z' }), lead({ inquiry: 'Rent', createdAt: '2026-10-05T00:00:00Z', city: 'R2' }),
    lead({ ai: 'Scheduling' }), lead({ inquiry: 'Rent', createdAt: '2026-10-02T00:00:00Z', city: 'R1' }), lead({ inquiry: 'Buy', createdAt: '2026-10-09T00:00:00Z' }),
  ];
  const b = blocks(msg(leads));
  assert.strictEqual(b.length, 4);
  b.forEach((x, i) => assert.ok(x.startsWith(`${i + 1}. Client ${i + 1}\n`), x.split('\n')[0]));
  assert.deepStrictEqual(b.map((x) => x.split('\n')[1]), ['RENT', 'RENT', 'SALE', 'SALE']);
  assert.match(b[0], /Location: R1/); assert.match(b[1], /Location: R2/);
  assert.deepStrictEqual([...msg(leads).matchAll(/^(\d+)\. Client (\d+)$/gm)].map((m) => [m[1], m[2]]), [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]);
});

test('privacy: no names, phone numbers, emails, lead codes or IDs, even when they appear in other fields', () => {
  const ls = [lead({}), lead({ inquiry: 'Buy' }), lead({ ai: 'Not on Respond.io', workStage: 'Property Matching', contactId: '' })];
  const text = msg(ls);
  for (const l of ls) for (const k of ['name', 'phone', 'email', 'code', 'id', 'contactId']) if (l[k]) assert.ok(!text.includes(String(l[k])), `${k} ${l[k]} leaked`);
  assert.doesNotMatch(text, /Maria|@|\+63|BH-7|L\d/);
});

test('copy-ready: plain text, one blank line between blocks, no trailing spaces or stray characters', () => {
  const text = msg([lead({ city: 'Makati\n\n  BGC', sqm: '50\t+', building: '<Tower & Co>' }), lead({ inquiry: 'Buy' })]);
  assert.ok(text.startsWith('Client Requirements for October 27, 2026\n\n1. Client 1\n'));
  assert.doesNotMatch(text, /\r|\t|&amp;|&lt;|<br|undefined|null|NaN|\n\n\n/);
  assert.ok(text.split('\n').every((x) => x === x.trimEnd()), 'no trailing spaces');
  assert.ok(!text.endsWith('\n'));
  assert.match(text, /^Location: Makati BGC$/m, 'line breaks inside a value are collapsed');
  assert.match(text, /^Building Name: <Tower & Co>$/m, 'plain text, not HTML-escaped (escaping happens only on the page)');
  assert.strictEqual(text.split('\n\n').length, 3);
});

test('date: today\'s business date in Manila time, whatever the device clock zone', () => {
  assert.strictEqual(CR.businessYmd(Date.parse('2026-10-26T16:30:00Z')), '2026-10-27', 'after midnight in Manila');
  assert.strictEqual(CR.businessYmd(Date.parse('2026-10-26T15:59:00Z')), '2026-10-26', 'before midnight in Manila');
  assert.match(CR.buildMessage([], undefined), /^Client Requirements for [A-Z][a-z]+ \d{1,2}, \d{4}\n/);
});

test('works on demo data and never changes the records; the module is read-only', () => {
  const d = generate(new Date('2026-10-27T09:00:00+08:00'));
  const before = JSON.stringify(d.leads);
  const text = CR.buildMessage(d.leads, DATE);
  assert.strictEqual(JSON.stringify(d.leads), before);
  assert.strictEqual(blocks(text).length, PR.sourcingLeads(d.leads).length);
  for (const l of d.leads) assert.ok(!text.includes(l.name) && !text.includes(l.phone) && !text.includes(l.email), 'demo identifiers stay out');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-req.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|API\.|https?:\/\//);
});
