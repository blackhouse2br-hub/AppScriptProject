'use strict';
// Deal files (Code.gs DEAL_SLOTS_ / apiDealUpload / apiDealSetTerm / apiDealClear): the LOI signed by the client and by the
// owner, the signed contract (with the lease start and months), the deposit slip and renewal contracts, per lead and
// unit, kept in Google Drive as the Apps Script did ("Blackhouse LOIs" folder → GOOGLE_DRIVE_DEALS_FOLDER_ID). The
// portal does not generate contracts (the Apps Script didn't either). Nothing here writes to Monday.
const express = require('express');
const SH = require('../public/shared');
const { DealFile, Viewing, Listing } = require('./models');
const { need, findVisibleLead } = require('./access');
const docx = require('./docx');
const { createDrive } = require('./drive');

const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const SLOTS = Object.keys(SH.DEAL_SLOTS);

/** What a file really is, from its first bytes (the Apps Script went by the name only): → { type, ext } or null. */
function sniff(buf) {
  const h = (n) => buf.subarray(0, n);
  if (buf.length < 12) return null;
  if (h(5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: '.pdf' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: '.jpg' };
  if (h(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: '.png' };
  if (h(4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: '.webp' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|heim|heis)$/.test(buf.subarray(8, 12).toString('latin1'))) return { type: 'image/heic', ext: '.heic' };
  if (h(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) { try { if (docx.unzip(buf).some((e) => e.name === 'word/document.xml')) return { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' }; } catch (e) { /* not a .docx */ } }
  return null;
}

function dealRoutes(r, config, integ) {
  const st = config.storage || {};
  const drive = st.drive ? createDrive(st.drive) : null;
  const needs = () => [!drive ? 'GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON (a service account that is a Content manager of a Shared Drive folder)' : '',
    !st.dealsFolder ? 'GOOGLE_DRIVE_DEALS_FOLDER_ID (the folder for deal files)' : ''].filter(Boolean);
  const rawBody = express.raw({ type: () => true, limit: SH.DEAL_FILE_MAX + 1024 });
  const readFile = (req, res, next) => rawBody(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Files can be 15 MB at most.' : 'The file could not be read.' }) : next()));

  /** The lead (visible to this member) and, for a unit key, that unit: the Monday Calendar item or the portal viewing. */
  async function target(req, res, withUnit) {
    const { source, id } = req.params;
    let lead = null, unitName = '';
    try {
      if (source === 'mongo') { const l = await findVisibleLead(req.user, id); if (l) lead = { id: String(l._id), name: l.name }; }
      else if (source === 'monday' && integ.monday) { const l = await integ.visibleMondayLead(req.user, id); if (l) lead = { id: l.id, name: l.name }; }
      if (lead && withUnit) {
        const key = String(req.params.key || '');
        if (source === 'monday') {
          const d = ((await integ.monday.loadAll(false)).deals || []).find((x) => x.id === key && x.leadId === lead.id);
          if (d) unitName = [d.building, d.city].filter(Boolean).join(', ') || 'Calendar item ' + key;
        } else if (/^[a-f0-9]{24}$/.test(key) && await Viewing.exists({ leadId: lead.id, listingId: key })) {
          const L = await Listing.findById(key).lean(); unitName = L ? `${L.building} · ${L.code}` : key;
        }
        if (!unitName) { res.status(404).json({ error: 'That unit isn\'t one of this client\'s viewings or deals.' }); return null; }
      }
    } catch (err) { if (!err.integration) throw err; res.status(502).json({ error: err.message }); return null; }
    if (!lead) { res.status(404).json({ error: 'Lead not found.' }); return null; }
    return { lead, unitName };
  }
  const recOut = (x) => ({ unitKey: x.unitKey, unitName: x.unitName, term: x.term, renewals: x.renewals.map((n) => ({ ...n.file, term: n.term })),
    slots: Object.fromEntries(Object.keys(x.slots || {}).filter((k) => x.slots[k]).map((k) => [k, x.slots[k]])), history: (x.history || []).slice(-10) });

  r.get('/deals/:source/:id', need('leads', 'view'), async (req, res) => {
    const t = await target(req, res, false); if (!t) return;
    const recs = await DealFile.find({ source: req.params.source, leadId: t.lead.id }).lean();
    res.json({ records: recs.map(recOut), setup: { ready: !!(drive && st.dealsFolder), needs: needs() } });
  });

  // upload one file into a slot (?start=&months= for a contract / renewal); a filled slot must be removed first
  r.post('/deals/:source/:id/:key/:slot', need('leads', 'edit'), readFile, async (req, res) => {
    const slot = req.params.slot; if (!SLOTS.includes(slot)) return res.status(404).json({ error: 'Unknown file slot.' });
    if (!drive || !st.dealsFolder) return res.status(503).json({ error: 'Deal files can\'t be saved yet: Google Drive storage is not set up.', setup: true, needs: needs() });
    const t = await target(req, res, true); if (!t) return;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return bad(res, 'The file is empty.');
    if (buf.length > SH.DEAL_FILE_MAX) return res.status(413).json({ error: 'Files can be 15 MB at most.' });
    const kind = sniff(buf); if (!kind) return bad(res, 'Only PDF, JPEG, PNG, WebP, HEIC or Word (.docx) files.');
    let term = null;
    if (slot === 'contract' || slot === 'renewal') {
      const q = req.query || {};
      if (q.start || q.months || slot === 'renewal') { const d = SH.dealTerm(String(q.start || ''), String(q.months || '')); if (d.errors.length) return bad(res, d.errors[0]); term = d.value; }
    }
    const key = { source: req.params.source, leadId: t.lead.id, unitKey: String(req.params.key) };
    const cur = await DealFile.findOne(key).lean();
    if (slot !== 'renewal' && cur && cur.slots && cur.slots[slot]) return res.status(409).json({ error: `${SH.DEAL_SLOTS[slot]} is already on file. Remove it first to replace it.` });
    if (slot === 'renewal' && cur && (cur.renewals || []).length >= 20) return res.status(409).json({ error: 'This unit already has 20 renewal contracts on file, the most the portal keeps.' });
    // as the Apps Script names them: "<slot> – <client> – <unit><ext>"
    const name = `${SH.DEAL_SLOTS[slot]} – ${t.lead.name || t.lead.id} – ${t.unitName}${kind.ext}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 180);
    let up; try { up = await drive.upload(buf, { name, mimeType: kind.type, parent: st.dealsFolder }); } catch (err) { if (!err.integration) throw err; return res.status(err.httpStatus || 502).json({ error: err.message }); }
    const file = { storage: 'drive', fileId: up.id, url: up.webViewLink || '', name, type: kind.type, size: buf.length, src: 'upload', at: new Date(), by: req.user.name };
    const upd = slot === 'renewal' ? { $push: { renewals: { file, term } }, $set: { term, unitName: t.unitName } } : { $set: { ['slots.' + slot]: file, unitName: t.unitName, ...(term ? { term } : {}) } };
    const doc = await DealFile.findOneAndUpdate(key, { ...upd, $push: { ...(upd.$push || {}), history: { $each: [{ at: new Date(), by: req.user.name, what: 'Uploaded: ' + SH.DEAL_SLOTS[slot] }], $slice: -50 } } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    res.status(201).json({ record: recOut(doc) });
  });

  r.put('/deals/:source/:id/:key/term', need('leads', 'edit'), async (req, res) => {
    const d = SH.dealTerm(String((req.body || {}).start || ''), String((req.body || {}).months || '')); if (d.errors.length) return bad(res, d.errors[0]);
    const t = await target(req, res, true); if (!t) return;
    const doc = await DealFile.findOneAndUpdate({ source: req.params.source, leadId: t.lead.id, unitKey: String(req.params.key) },
      { $set: { term: d.value, unitName: t.unitName }, $push: { history: { $each: [{ at: new Date(), by: req.user.name, what: `Lease term: ${d.value.start}, ${d.value.months} months` }], $slice: -50 } } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    res.json({ record: recOut(doc) });
  });

  // remove a file from its slot (the Drive copy is kept, as apiDealClear did)
  r.delete('/deals/:source/:id/:key/:slot', need('leads', 'edit'), async (req, res) => {
    const slot = req.params.slot; if (!SLOTS.includes(slot) || slot === 'renewal') return res.status(404).json({ error: 'Unknown file slot.' });
    const t = await target(req, res, false); if (!t) return;
    const doc = await DealFile.findOneAndUpdate({ source: req.params.source, leadId: t.lead.id, unitKey: String(req.params.key) },
      { $set: { ['slots.' + slot]: null }, $push: { history: { $each: [{ at: new Date(), by: req.user.name, what: 'Removed: ' + SH.DEAL_SLOTS[slot] + ' (kept in Drive)' }], $slice: -50 } } }, { returnDocument: 'after' }).lean();
    if (!doc) return res.status(404).json({ error: 'Nothing on file.' });
    res.json({ record: recOut(doc) });
  });

  // open a file (the portal reads it from Drive; nobody needs Drive access)
  r.get('/deals/:source/:id/:key/:slot/file', need('leads', 'view'), async (req, res) => {
    const t = await target(req, res, false); if (!t) return;
    const doc = await DealFile.findOne({ source: req.params.source, leadId: t.lead.id, unitKey: String(req.params.key) }).lean();
    const slot = req.params.slot, i = Number(req.query.i || 0);
    const f = doc && (slot === 'renewal' ? (doc.renewals[i] || {}).file : SLOTS.includes(slot) ? doc.slots[slot] : null);
    if (!f) return res.status(404).json({ error: 'File not found.' });
    if (!drive) return res.status(503).json({ error: 'Google Drive storage is not set up on this server.', setup: true, needs: needs() });
    let buf; try { buf = await drive.download(f.fileId, SH.DEAL_FILE_MAX + 1024); } catch (err) { if (!err.integration) throw err; return res.status(err.httpStatus || 502).json({ error: err.message }); }
    res.set({ 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name || 'file')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(buf);
  });

  /** For LOI signing: records an e-signed copy in the client / owner LOI slot of the unit (src/loiSign.js). */
  async function recordSigned({ source, leadId, unitKey, unitName, slot, file }) {
    await DealFile.findOneAndUpdate({ source, leadId, unitKey }, { $set: { ['slots.' + slot]: { ...file, src: 'esign' }, unitName }, $push: { history: { $each: [{ at: new Date(), by: file.by, what: 'E-signed: ' + SH.DEAL_SLOTS[slot] }], $slice: -50 } } },
      { upsert: true, setDefaultsOnInsert: true });
  }
  /** The name of a unit of this client (its Monday Calendar item, or a portal viewing's listing), or '' if it isn't one. */
  async function unitOf(source, leadId, key) {
    key = String(key || '');
    if (source === 'monday') {
      if (!integ.monday) return '';
      const d = ((await integ.monday.loadAll(false)).deals || []).find((x) => x.id === key && x.leadId === leadId);
      return d ? [d.building, d.city].filter(Boolean).join(', ') || 'Calendar item ' + key : '';
    }
    if (!/^[a-f0-9]{24}$/.test(key) || !(await Viewing.exists({ leadId, listingId: key }))) return '';
    const L = await Listing.findById(key).lean(); return L ? `${L.building} · ${L.code}` : key;
  }
  return { recordSigned, unitOf, drive, ready: () => !!(drive && st.dealsFolder) };
}

module.exports = { dealRoutes, sniff };
