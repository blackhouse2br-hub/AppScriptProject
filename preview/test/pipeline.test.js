'use strict';
// Pure status rules ported from Code.gs (fixed "now", no network).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/integrations/pipeline');

const NOW = Date.parse('2026-10-22T04:00:00Z');
const H = 3600e3, D = 864e5;
const m = (from, hoursAgo, src, text = 'x') => ({ from, src: src || (from === 'client' ? 'client' : 'user'), ts: NOW - hoursAgo * H, text });
const lead = (o) => ({ id: '1', contactId: '123', createdAt: new Date(NOW - 30 * D).toISOString(), ...o });

test('AI Status from status text (aiStatusOne_)', () => {
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'Called - Failed' }), NOW).stage, 'Failed');
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'For Payment' }), NOW).stage, 'Collection');
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'LOI Sent' }), NOW).stage, 'LOI');
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'Schedule Viewing' }), NOW).stage, 'Scheduling');
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'New Inquiry', boardStatus: 'Contract Signing' }), NOW).stage, 'Contract');   // Status column can move it further
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'Closed', inquiry: 'Rent', moveIn: '2025-11-15', leaseTerm: '1 year' }), NOW).stage, 'For Renewal');
  assert.strictEqual(P.aiStatus(lead({ nextAction: 'Closed', inquiry: 'Rent', moveIn: '2026-09-01', leaseTerm: '1 year' }), NOW).stage, 'Active');
});

test('proof beats Monday AI STATUS, which beats rules; 5-day owner-signing rule', () => {
  const l = lead({ aiStatusLabel: 'Scheduling', nextAction: 'New Inquiry' });
  assert.deepStrictEqual([P.computeLead(l, null, null, NOW).ai, P.computeLead(l, null, null, NOW).aiSource], ['Scheduling', 'monday']);
  assert.strictEqual(P.computeLead(l, { ds: '2026-10-20', files: 0, cfiles: 0, sfiles: 0, paid: 0 }, null, NOW).ai, 'LOI');
  const lapsed = P.computeLead(l, { ds: '2026-10-10', files: 0, cfiles: 0, sfiles: 0, paid: 0 }, null, NOW);
  assert.deepStrictEqual([lapsed.ai, lapsed.aiSource], ['Property Matching', 'proof']); assert.match(lapsed.aiSub, /not signed by the owner after 5 days/);
  assert.strictEqual(P.computeLead(l, { sfiles: 1, paid: 50000, cd: '2026-10-01' }, null, NOW).ai, 'Active');
  assert.strictEqual(P.computeLead(l, { sfiles: 1, paid: 0, cd: '2026-10-01' }, null, NOW).ai, 'Collection');
  assert.strictEqual(P.computeLead(lead({ clientStatus: 'Disqualified' }), null, null, NOW).ai, 'Failed');
  const unresp = P.computeLead(lead({ clientStatus: 'Unresponsive' }), null, null, NOW);
  assert.strictEqual(unresp.ai, 'Failed');
  assert.strictEqual(unresp.aiSub, 'Unresponsive');
  assert.strictEqual(P.computeLead(lead({ contactId: '' }), null, null, NOW).ai, 'Not on Respond.io');
  assert.strictEqual(P.computeLead(lead({ contactId: '', contractDate: '2026-10-20' }), null, null, NOW).ai, 'Contract');   // proof wins even without a chat
});

test('reply state: only human replies count (apiGetReplyStates)', () => {
  const a = P.replyState([m('client', 1), m('va', 0.5, 'workflow'), m('va', 5, 'user'), m('client', 6)], NOW);
  assert.deepStrictEqual([a.waiting, a.in48, a.botReplied], ['va', 2, true]);
  const b = P.replyState([m('va', 1, 'echo'), m('client', 3)], NOW);
  assert.strictEqual(b.waiting, 'client');
  assert.strictEqual(P.replyState([], NOW), null);
});

test('temperature (temperature_)', () => {
  const t = (msgs, stage = 'Scheduling') => P.temperature(stage, P.replyState(msgs, NOW), lead({}), NOW).temp;
  assert.strictEqual(t([m('client', 2)]), 'Hot');
  assert.strictEqual(t([m('client', 4 * 24)]), 'Lost');
  assert.strictEqual(t([m('client', 8 * 24)]), 'Dead');
  assert.strictEqual(t([m('va', 1, 'user')]), 'Cold');                          // never replied
  assert.strictEqual(t([m('va', 30, 'user'), m('va', 40, 'user'), m('client', 50)]), 'Cold');   // 2 unanswered
  assert.strictEqual(t([m('client', 2)], 'Active'), 'Active');
  // chat not read yet: Unchecked (no status guessed from the lead's age); no Respond ID: Not on Respond.io
  const old = { createdAt: new Date(NOW - 9 * D).toISOString() };
  assert.strictEqual(P.temperature('Scheduling', null, lead({ ...old, contactId: '555001' }), NOW).temp, 'Unchecked');
  assert.strictEqual(P.temperature('Scheduling', null, lead({ ...old, contactId: '' }), NOW).temp, 'Not on Respond.io');
  assert.strictEqual(P.temperature('Failed', null, lead({ contactId: '555001' }), NOW).temp, 'Dead');
});

test('days in stage (stageSegments_), with the LOI roll-back', () => {
  const l = lead({ createdAt: new Date(NOW - 30 * D).toISOString() });
  const s = P.segments(l, { booked: NOW - 10 * D, ds: '2026-10-12' }, NOW);   // LOI 10 days ago → 5 days LOI, then back to matching
  assert.strictEqual(Math.round(s.days.Scheduling), 0);   // booked and LOI on the same day (Oct 12)
  assert.strictEqual(s.back, 'LOI');
  assert.ok(Math.round(s.days.LOI) === 5);
  assert.strictEqual(s.cur, 'Property Matching');
});
