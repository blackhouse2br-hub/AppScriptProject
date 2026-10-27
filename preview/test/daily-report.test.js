'use strict';
// Daily Report (public/daily-report.js): clients appear only as a numeric lead ID. Regression: Monday's item name is the
// client's "Full Name", and the report used to print it as the "lead ID". Fictional data only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const DR = require('../public/daily-report');
const { shapeLead, matchLeadCols } = require('../src/integrations/monday');
const { generate } = require('../public/demo-data');

const TODAY = '2026-10-27', TOMORROW = '2026-10-28', NOW = Date.parse('2026-10-27T09:00:00+08:00');
// identifying details that must never appear in the broker-group text
const SECRET = { name: 'Juan Dela Cruz', phone: '+63 900 555 0141', email: 'juan.delacruz@example.com', note: 'c/o Maria Santos 0900 555 0142', code: 'JDC-PRIVATE' };

/** A lead exactly as /api/monday/bootstrap shapes it from a Direct Clients item whose name column is the client's Full Name. */
function mondayLead(id, extra) {
  const cols = matchLeadCols([['cn', 'Contact Name', 'text'], ['ph', 'Phone', 'phone'], ['em', 'Email', 'email'], ['inq', 'Inquiry Type', 'status'],
    ['city', 'City', 'text'], ['bud', 'Budget', 'numbers'], ['br', 'No. of Bedrooms', 'dropdown'], ['req', 'Client Requirements', 'text'], ['oth', 'Other Requirements', 'text'], ['rid', 'Respond ID', 'text']]
    .map(([cid, title, type]) => ({ id: cid, title, type })));
  const v = { cn: SECRET.name, ph: SECRET.phone, em: SECRET.email, inq: 'Rent', city: 'Makati', bud: '150000', br: '2', req: 'BGC, near ' + SECRET.note, oth: 'call ' + SECRET.phone, ...extra };
  return shapeLead({ id, name: SECRET.name, created_at: new Date(NOW - 864e5).toISOString(), column_values: Object.keys(cols).map((k) => ({ id: cols[k], text: v[cols[k]] || '' })) }, cols);
}

test('Monday leads: numeric lead ID only, in every section; never the item name, phone, email or notes', () => {
  const a = mondayLead('2210345678'), b = { ...mondayLead('2210345679'), ai: 'LOI', daysInStage: 3 };
  assert.strictEqual(a.code, SECRET.name, 'precondition: the Monday item name is the client\'s name');
  const viewings = [{ id: 'v1', leadId: a.id, date: TODAY, time: '10:00', building: 'Demo Tower', city: 'Makati', broker: 'Ely Santos', status: 'Confirmed' },
    { id: 'v2', leadId: b.id, date: TOMORROW, time: '14:00', building: 'Demo Plaza', city: 'Taguig', broker: 'Gia Cruz', status: 'Proposed' }];
  const text = DR.buildDaily({ leads: [a, b], viewings, listings: [], today: TODAY, tomorrow: TOMORROW, now: NOW });
  assert.match(text, /VIEWINGS TODAY \(1\)\n• 10:00 · Demo Tower \(Makati\) · Lead #2210345678 · broker Ely Santos · Confirmed/);
  assert.match(text, /VIEWINGS TOMORROW \(1\)\n• 14:00 · Demo Plaza \(Taguig\) · Lead #2210345679 · broker Gia Cruz · Proposed/);
  assert.match(text, /NEW CLIENT REQUIREMENTS \(2\)\n• Lead #2210345678 · Rent · Makati · 2 BR · ₱150k/);
  assert.match(text, /LOIs & CONTRACTS IN PROGRESS \(1\)\n• Lead #2210345679 · LOI · 3 days in stage/);
  for (const [k, s] of Object.entries(SECRET)) assert.ok(!text.includes(s), `${k} leaked: ${s}`);
  assert.doesNotMatch(text, /Juan|Dela Cruz|Maria|@|\+63|555 014[12]|c\/o|call /i);
});

test('MongoDB and demo leads: numeric ID when there is one, otherwise "—" (never the code, name or database ID)', () => {
  const oid = '6ae053c657ea10e309809032';
  const plain = { id: oid, code: SECRET.code, name: SECRET.name, phone: SECRET.phone, email: SECRET.email, requirements: SECRET.note, mondayItemId: '', inquiry: 'Buy', city: 'Pasig', bedrooms: '3', budget: 25e6, ai: 'Contract', createdAt: new Date(NOW).toISOString() };
  const imported = { ...plain, id: '6ae053c657ea10e309809033', mondayItemId: '2210000456' };
  const text = DR.buildDaily({ leads: [plain, imported], viewings: [], listings: [], today: TODAY, tomorrow: TOMORROW, now: NOW });
  assert.match(text, /• Lead #— · Buy · Pasig · 3 BR · ₱25M/);
  assert.match(text, /• Lead #2210000456 · Buy/);
  for (const s of [...Object.values(SECRET), oid, '6ae053c657ea10e309809033']) assert.ok(!text.includes(s), 'leaked: ' + s);
  // demo: the numeric demo ID, not the DEMO-#### code
  const d = generate(new Date(NOW));
  const demo = DR.buildDaily({ leads: d.leads, viewings: d.calendar, listings: d.listings, today: TODAY, tomorrow: TOMORROW, now: NOW, demo: true });
  assert.ok(demo.startsWith('BLACKHOUSE DAILY REPORT · Tue, Oct 27 (DEMO DATA)'));
  assert.doesNotMatch(demo, /DEMO-\d/);
  for (const l of d.leads) assert.ok(!demo.includes(l.name) && !demo.includes(l.phone) && !demo.includes(l.email), 'demo identifiers stay out');
  assert.match(demo, /Lead #9\d{3}/);
});

test('no identifying field is ever read: a lead made only of identifying values produces no trace of them', () => {
  const poison = { id: 'not-a-number', mondayItemId: 'Ana Reyes', code: 'Ana Reyes', name: 'Ana Reyes', phone: '09005550157', email: 'ana@reyes.example', requirements: 'Ana Reyes 09005550157',
    location: 'Ana Reyes', otherReqs: 'Ana Reyes', notes: [{ text: 'Ana Reyes' }], ai: 'LOI', createdAt: new Date(NOW).toISOString() };
  const text = DR.buildDaily({ leads: [poison], viewings: [{ leadId: 'not-a-number', date: TODAY, time: '09:00', building: 'X', city: 'Y', broker: 'B', status: 'Confirmed' }], listings: [], today: TODAY, tomorrow: TOMORROW, now: NOW });
  assert.doesNotMatch(text, /Ana|Reyes|09005550157|@/);
  assert.strictEqual((text.match(/Lead #—/g) || []).length, 3, 'viewing, new requirement and LOI lines all show only "Lead #—"');
});

test('copy-ready plain text; the module is read-only; app.js uses it for the page and the Copy button', () => {
  const text = DR.buildDaily({ leads: [], viewings: [], listings: [], today: TODAY, tomorrow: TOMORROW, now: NOW });
  assert.strictEqual(text, 'BLACKHOUSE DAILY REPORT · Tue, Oct 27\n\nVIEWINGS TODAY (0)\n\nVIEWINGS TOMORROW (0)\n\nNEW CLIENT REQUIREMENTS (0)\n\nLOIs & CONTRACTS IN PROGRESS (0)');
  assert.strictEqual(DR.leadNumber({ id: '9001' }), '9001');
  assert.strictEqual(DR.leadNumber({ id: 'abc', mondayItemId: '' }), '');
  // the code itself (comments removed) never touches a name, code, phone, email or free-text field, nor the network
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-report.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|localStorage|https?:\/\/|\.code\b|\.name\b|\.phone\b|\.email\b|requirements/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /const dailyText = \(\) => window\.BH_DAILY\.buildDaily\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'), /<script src="daily-report\.js"><\/script>\s*<script src="api-client\.js">/);
});
