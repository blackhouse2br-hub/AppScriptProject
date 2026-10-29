'use strict';
// VA labels: one match rule for the server's lead scoping, the Leads VA filter, VA Management and KPI Review.
const test = require('node:test');
const assert = require('node:assert');
const SH = require('../public/shared');
const { scopeExternal } = require('../src/access');

test('vaKey: case, spacing and punctuation don\'t count; empty is unassigned', () => {
  assert.strictEqual(SH.vaKey('  Cora  Fake '), 'cora fake');
  assert.ok(SH.sameVa('Ana', 'ana') && SH.sameVa('Ana ', 'ANA') && SH.sameVa('Cora Fake', 'Cora  Fake'));
  assert.ok(!SH.sameVa('Ana', 'Ana, Bea') && !SH.sameVa('Ana', 'Anna'));
  assert.strictEqual(SH.vaKey(null), ''); assert.strictEqual(SH.vaKey(''), '');
});

test('vaLabels: one entry per VA, the most used spelling, sorted without regard to case', () => {
  assert.deepStrictEqual(SH.vaLabels(['Bea', 'Ana', 'ana', 'Ana', '', null, 'Cora  Fake', 'Cora Fake', 'Cora Fake', 'dev']), ['Ana', 'Bea', 'Cora Fake', 'dev']);
  assert.deepStrictEqual(SH.vaLabels([]), []);
  assert.deepStrictEqual(SH.vaLabels(['Cora  Fake', 'Cora Fake']), ['Cora Fake'], 'a tie goes to the tidy spelling');
});

test('VA Management figures count every spelling of a VA, as the VA\'s own account sees them', () => {
  const leads = [{ id: '1', va: 'Ana', ai: 'LOI' }, { id: '2', va: 'ana', ai: 'Failed' }, { id: '3', va: 'Bea' }, { id: '4', va: '' }];
  const w = SH.vaWorkload(leads, [{ leadId: '2', status: 'Done' }], 'Ana');
  assert.deepStrictEqual([w.leads, w.loiPlus, w.failed, w.viewings], [2, 1, 1, 1]);
  const seen = scopeExternal({ role: 'VA', vaLabel: 'Ana' }, { leads, viewings: [], listings: [] }).leads.map((l) => l.id);
  assert.deepStrictEqual(seen, ['1', '2'], 'the server shows the Ana VA the same two leads');
  assert.strictEqual(SH.vaPerformance(leads.map((l) => ({ ...l, inquiryDate: '2026-10-01' })), [], 'ANA', '2026-10-01', '', '2026-10-29').n, 2);
});
