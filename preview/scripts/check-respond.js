'use strict';
// Read-only respond.io connection check for the local portal:
//   npm run check-respond
//
// 1. Reads up to 3 Respond IDs from the Monday Leads board (one page, Respond ID column only; no full load).
// 2. For each, fetches the respond.io contact and its message history (GET only, read-only allowlist).
// Prints connection status and counts only: no tokens, IDs, names, phone numbers or message text.
// Nothing is written anywhere: no messages are sent, no contacts or Monday items change, nothing is saved.
const { loadConfig, redact } = require('../src/config');
const { createStatus } = require('../src/integrations/status');
const { createMonday } = require('../src/integrations/monday');
const { createRespond } = require('../src/integrations/respondio');

async function checkRespond(config, log = console.log) {
  const ic = config.integrations;
  if (!ic) throw new Error('Integrations run only in MongoDB mode (APP_MODE=mongo in preview/.env).');
  if (!ic.respond.token) throw new Error('RESPOND_TOKEN is empty in preview/.env. Add the respond.io API token there and run this again.');
  log('respond.io token: set · workspace (space) ID for "Open in respond.io" links: ' + (ic.respond.spaceId ? 'set' : 'not set (optional)'));
  if (!ic.monday.token || !ic.monday.boards.leads) throw new Error('Monday.com is needed to find leads with a Respond ID (MONDAY_TOKEN and MONDAY_LEADS_BOARD_ID).');

  const sample = await createMonday(ic.monday, createStatus(true, [])).respondIdSample(3);
  if (!sample.column) throw new Error('The Monday Leads board has no "Respond ID" column, so no lead can be linked to respond.io.');
  log(`Monday Leads board: ${sample.withId} of the first ${sample.rows} leads have a Respond ID; testing ${sample.ids.length}.`);
  if (!sample.ids.length) throw new Error('No lead on the first page of the Leads board has a Respond ID, so there is nothing to test with yet.');

  const status = createStatus(true, []), respond = createRespond(ic.respond, status);
  const results = [];
  for (const [i, id] of sample.ids.entries()) {
    try {
      const c = await respond.chat(id);
      results.push({ ok: true, messages: c.messages.length, more: c.more });
      log(`  lead ${i + 1}: contact found · ${c.messages.length} message${c.messages.length === 1 ? '' : 's'}${c.more ? ' (more older ones not fetched)' : ''}`);
    } catch (err) {
      results.push({ ok: false, error: err.message });
      log(`  lead ${i + 1}: ${redact(err.message)}`);
      if (/rejected|rate-limiting/.test(err.message)) break;   // bad token or rate limit: stop
    }
  }
  const s = status.snapshot();
  log(`respond.io: ${s.state === 'ok' ? 'connected (read-only)' : s.state === 'error' ? 'error: ' + redact(s.lastError) : 'not checked'}`);
  return { sample: { rows: sample.rows, withId: sample.withId, tested: sample.ids.length }, results, state: s.state };
}

if (require.main === module) {
  let config;
  try { config = loadConfig(); } catch (err) { console.error('[check-respond] ' + redact(err.message)); process.exit(1); }
  checkRespond(config).then((r) => process.exit(r.state === 'ok' ? 0 : 1), (err) => { console.error('[check-respond] ' + redact(err.message)); process.exit(1); });
}

module.exports = { checkRespond };
