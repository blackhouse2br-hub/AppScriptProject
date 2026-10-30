'use strict';
// Imports the Apps Script's Upselling records into the portal, so nobody is offered again too soon or messaged after
// opting out:
//   upo_<leadId> = "1"                 → an opt-out (UpsellOptOut, source monday)
//   up_<leadId>  = [{ t, k, ch, by }]  → past offers (UpsellLegacy), counted by "skip if offered in the last N days"
//   rn_<leadId>  = [{ t, k, by }]      → past Renewals → Message sends (UpsellLegacy, action renewal): the services
//                                         offers Service Requests "Check replies" looks for
// Input: a JSON export of the Apps Script project's Script Properties ({ "key": "value", ... }), e.g. made in the Apps
// Script editor with  JSON.stringify(PropertiesService.getScriptProperties().getProperties())  and saved to a file.
// Dry run by default (prints counts only, writes nothing). --apply writes to the database in MONGODB_URI; running it
// again changes nothing (existing records are kept).
//   node --env-file=.env scripts/import-legacy-upsell.js export.json            (dry run)
//   node --env-file=.env scripts/import-legacy-upsell.js export.json --apply
const fs = require('fs');

/** The records an export holds: { optOuts: [leadId], offers: [{ leadId, at, kind, action }], skipped }. */
function parseExport(props) {
  const out = { optOuts: [], offers: [], skipped: 0 };
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('The file must be a JSON object of Script Properties.');
  for (const [k, v] of Object.entries(props)) {
    let m = /^upo_(\d{1,20})$/.exec(k);
    if (m) { if (String(v) === '1' || v === 1 || v === true) out.optOuts.push(m[1]); else out.skipped++; continue; }
    // up_ (Upselling sends and tags) and rn_ (Renewals → Message, incl. the services offers Service Requests reads)
    m = /^(up|rn)_(\d{1,20})$/.exec(k);
    if (!m) continue;
    const renewal = m[1] === 'rn'; m = [m[0], m[2]];
    let log; try { log = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { out.skipped++; continue; }
    if (!Array.isArray(log)) { out.skipped++; continue; }
    for (const x of log) {
      const at = Number(x && x.t);
      if (!(at > 1.5e12 && at < Date.now() + 864e5)) { out.skipped++; continue; }
      out.offers.push({ leadId: m[1], at: new Date(at), kind: String((x && x.k) || '').slice(0, 40), action: renewal ? 'renewal' : /tag/i.test(String((x && x.ch) || '')) ? 'tag' : 'message' });
    }
  }
  return out;
}

/** Writes them (idempotent). models: { UpsellOptOut, UpsellLegacy }. */
async function apply(models, recs) {
  const by = { name: 'Import from the Apps Script' };
  let optOuts = 0, offers = 0;
  for (let i = 0; i < recs.optOuts.length; i += 500) {
    const r = await models.UpsellOptOut.bulkWrite(recs.optOuts.slice(i, i + 500).map((leadId) => ({ updateOne: { filter: { source: 'monday', leadId }, update: { $setOnInsert: { source: 'monday', leadId, by } }, upsert: true } })));
    optOuts += r.upsertedCount;
  }
  for (let i = 0; i < recs.offers.length; i += 500) {
    const r = await models.UpsellLegacy.bulkWrite(recs.offers.slice(i, i + 500).map((o) => ({ updateOne: { filter: { source: 'monday', leadId: o.leadId, at: o.at, kind: o.kind, action: o.action }, update: { $setOnInsert: { source: 'monday', ...o } }, upsert: true } })));
    offers += r.upsertedCount;
  }
  return { optOuts, offers };
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.log('Usage: node --env-file=.env scripts/import-legacy-upsell.js <script-properties.json> [--apply]'); process.exit(2); }
  const recs = parseExport(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Found ${recs.optOuts.length} opt-outs and ${recs.offers.length} past offers (${recs.skipped} entries skipped as unreadable).`);
  if (flag !== '--apply') { console.log('Dry run: nothing was written. Add --apply to import.'); return; }
  const mongoose = require('mongoose');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI);
  try { const r = await apply(require('../src/models'), recs); console.log(`Imported ${r.optOuts} new opt-outs and ${r.offers} new past offers.`); }
  finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch((e) => { console.error(String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '[database]')); process.exit(1); });
module.exports = { parseExport, apply };
