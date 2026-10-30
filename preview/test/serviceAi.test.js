'use strict';
// The Service Requests AI request (src/serviceAi.js) against a local fake Anthropic API: the settings Claude Haiku 5.5
// needs (no temperature; low effort so thinking leaves room for the JSON) and clear errors. No real API call.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createServiceAi } = require('../src/serviceAi');

let server, base, reply = null;
const seen = [];
test.before(async () => {
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      const [code, out] = reply || [200, { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify({ services: [{ service: 'movers', interest: 'interested', summary: 'Moving on the 15th', details: { date: '15th', area: '', from: '', to: '', unit: '', items: '', issue: '', budget: '', notes: '' } }] }) }] }];
      res.writeHead(code, { 'content-type': 'application/json', 'request-id': 'req_fake' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const ai = () => createServiceAi({ apiKey: 'fake-key-not-real', baseURL: base });
const apiError = (type, message) => ({ type: 'error', error: { type, message } });

test('the request suits Claude Haiku 5.5: structured output, low effort, no temperature; the answer is read by block type', async () => {
  const out = await ai().classify({ offered: ['movers'], convo: 'CLIENT: yes to movers on the 15th' });
  assert.deepStrictEqual(Object.keys(out), ['movers']); assert.strictEqual(out.movers.interest, 'interested');
  const b = seen.at(-1);
  assert.strictEqual(b.model, 'claude-haiku-5-5');
  assert.strictEqual(b.output_config.effort, 'low'); assert.strictEqual(b.output_config.format.type, 'json_schema');
  assert.ok(b.max_tokens >= 4000, 'room for thinking and the JSON');
  assert.ok(!('temperature' in b) && !('top_p' in b) && !('top_k' in b), 'non-default sampling values return a 400 on Haiku 5.5');
  assert.strictEqual(b.messages.at(-1).role, 'user', 'no assistant prefill');
});

test('clear errors: no credit, wrong key, busy, cut off, declined', async () => {
  const cases = [
    [[400, apiError('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')], /no credit left/],
    [[401, apiError('authentication_error', 'invalid x-api-key')], /refused the server's ANTHROPIC_API_KEY/],
    [[403, apiError('permission_error', 'no access')], /isn't allowed to use this model/],
    [[529, apiError('overloaded_error', 'Overloaded')], /busy/],
    [[200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 4000 }, content: [{ type: 'thinking', thinking: '', signature: 'x' }] }], /cut off/],
    [[200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [] }], /declined/],
  ];
  const c = createServiceAi({ apiKey: 'fake-key-not-real', baseURL: base });
  for (const [r, re] of cases) {
    reply = r;
    await assert.rejects(c.classify({ offered: ['movers'], convo: 'CLIENT: hi' }), (e) => { assert.match(e.message, re); assert.ok(!/fake-key-not-real/.test(e.message)); return true; });
  }
  reply = null;
});

test('redaction keeps dates and amounts a supplier needs, and removes phone numbers', () => {
  const SH = require('../public/shared');
  const c = { name: 'Isabela Fontanilla', phone: '+63 917 555 0142', email: 'isa@example.org', contactId: '987650001' };
  const r = SH.redactForAi('Isabela here: moving 2026-11-15 or 15/11/2026, budget 15000-20000, 40-60 sqm. Call 0918 222 3344 or +63 917 555 0142, landline 8123-4567.', c);
  for (const keep of ['2026-11-15', '15/11/2026', '15000-20000', '40-60']) assert.ok(r.includes(keep), keep + ' kept: ' + r);
  for (const gone of ['Isabela', '0918 222 3344', '917 555 0142', '8123-4567']) assert.ok(!r.includes(gone), gone + ' removed: ' + r);
  assert.strictEqual(SH.leaksClient('Move on 2026-11-15, budget 15000-20000', c), false, 'a date or range is not a phone number');
  assert.strictEqual(SH.leaksClient('Call 0918 222 3344', c), true);
  assert.strictEqual(SH.stripContacts('On 2026-11-15, call 0918-222-3344'), 'On 2026-11-15, call [removed]');
});