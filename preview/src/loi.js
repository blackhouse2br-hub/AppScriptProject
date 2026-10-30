'use strict';
// LOI (Code.gs apiLoiDefaults / apiMakeLoi / fillLoiDoc_ and Settings → Files): the team uploads its Lease and Sale LOI
// Word templates; a member prepares an LOI for a lead from the fields they review (pre-filled in the page from the lead,
// listing and Calendar records), and the portal fills a copy of the template for them to download and check.
//
// Nothing here sends, shares or signs anything: e-signature, sending the signing link and keeping the signed copy need
// services the portal doesn't have (shared.js LOI_SETUP), so those steps are not offered.
const express = require('express');
const SH = require('../public/shared');
const { LoiTemplate, Loi } = require('./models');
const { need, findVisibleLead } = require('./access');
const docx = require('./docx');

const MAX_TEMPLATE = 2 * 1024 * 1024, MAX_PER_LEAD = 50;   // prepared LOIs kept per client (the list shows them all)
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const who = (u) => ({ userId: u._id, name: u.name, email: u.email || '' });
const loiOut = (x) => ({ id: String(x._id), slot: x.slot, slotLabel: SH.LOI_SLOTS[x.slot], templateName: x.templateName, fields: x.fields, missing: x.missing,
  status: x.status, createdAt: x.createdAt, by: x.createdBy && x.createdBy.name, size: x.data ? x.data.length : 0 });
const tplOut = (t) => ({ slot: t.slot, label: SH.LOI_SLOTS[t.slot], name: t.name, size: t.size, at: t.updatedAt, by: t.uploadedBy && t.uploadedBy.name });

function loiRoutes(r, config, integ) {
  const rawBody = express.raw({ type: () => true, limit: MAX_TEMPLATE });
  const readFile = (req, res, next) => rawBody(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Templates can be 2 MB at most.' : 'The file could not be read.' }) : next()));

  /** The lead if this member may see it (MongoDB, or the live Monday board). */
  async function leadFor(req, res) {
    const { source, id } = req.params;
    let lead = null;
    try {
      if (source === 'mongo') { const l = await findVisibleLead(req.user, id); if (l) lead = { id: String(l._id) }; }
      else if (source === 'monday' && integ.monday) { const l = await integ.visibleMondayLead(req.user, id); if (l) lead = { id: l.id }; }
    } catch (err) { if (!err.integration) throw err; res.status(502).json({ error: err.message }); return null; }
    if (!lead) res.status(404).json({ error: 'Lead not found.' });
    return lead;
  }

  // ----- templates (Settings → Files): uploaded by members with edit access to Settings; the content is never listed -----
  // listed (names only) for anyone who prepares LOIs or manages Settings
  r.get('/loi/templates', (req, res, next) => (['leads', 'team'].some((m) => SH.access(req.user, m) !== 'none') ? next() : res.status(403).json({ error: 'You don\'t have access to LOI templates.' })), async (req, res) => {
    res.json({ templates: (await LoiTemplate.find({}, { data: 0 }).lean()).map(tplOut), slots: SH.LOI_SLOTS });
  });
  r.post('/loi/templates/:slot', need('team', 'edit'), readFile, async (req, res) => {
    const slot = req.params.slot; if (!SH.LOI_SLOTS[slot]) return res.status(404).json({ error: 'Unknown template.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let chk; try { chk = docx.checkTemplate(buf); } catch (e) { return bad(res, docx.userMessage(e)); }
    if (chk.kind && (chk.kind === 'lease') !== (slot === 'lease')) return bad(res, `This is a ${chk.kind === 'lease' ? 'lease' : 'sale'} LOI; upload it as the ${chk.kind === 'lease' ? 'Lease' : 'Sale'} template.`);
    let name = ''; try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')).replace(/[^\w .()-]/g, '').slice(0, 120); } catch (e) { /* default */ }
    const t = await LoiTemplate.findOneAndUpdate({ slot }, { $set: { slot, name: name || slot + '.docx', size: buf.length, data: buf, uploadedBy: who(req.user) } }, { upsert: true, returnDocument: 'after', runValidators: true });
    res.status(201).json({ template: tplOut(t) });
  });
  r.delete('/loi/templates/:slot', need('team', 'edit'), async (req, res) => {
    if (!SH.LOI_SLOTS[req.params.slot]) return res.status(404).json({ error: 'Unknown template.' });
    await LoiTemplate.deleteOne({ slot: req.params.slot });
    res.json({ ok: true });
  });

  // ----- a lead's LOIs -----
  r.get('/loi/:source/:id', need('leads', 'view'), async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    const list = await Loi.find({ source: req.params.source, leadId: lead.id }, { data: 0 }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ lois: list.map(loiOut), templates: (await LoiTemplate.find({}, { data: 0 }).lean()).map(tplOut), sending: false });
  });
  // make the document from the reviewed fields (a copy of the template; nothing is sent)
  r.post('/loi/:source/:id', need('leads', 'edit'), async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    const { value, missing, errors } = SH.validateLoi(req.body);
    if (errors.length) return bad(res, errors[0]);
    const tpl = await LoiTemplate.findOne({ slot: value.slot });
    if (!tpl) return res.status(409).json({ error: `The ${SH.LOI_SLOTS[value.slot]} LOI template hasn't been uploaded yet (Settings → Files).` });
    if ((await Loi.countDocuments({ source: req.params.source, leadId: lead.id })) >= MAX_PER_LEAD) return res.status(409).json({ error: `This client already has ${MAX_PER_LEAD} prepared LOIs, the most the portal keeps.` });
    let data; try { data = docx.fillLoi(tpl.data, value.fields); } catch (e) { return res.status(422).json({ error: 'The template could not be filled: ' + docx.userMessage(e) }); }
    const x = await Loi.create({ source: req.params.source, leadId: lead.id, slot: value.slot, templateName: tpl.name, templateAt: tpl.updatedAt, fields: value.fields, missing, data, createdBy: who(req.user) });
    res.status(201).json({ loi: loiOut(x) });
  });
  r.get('/loi/:source/:id/:loiId/docx', need('leads', 'view'), async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    const x = SH.isId24(req.params.loiId) ? await Loi.findOne({ _id: req.params.loiId, source: req.params.source, leadId: lead.id }).lean() : null;
    if (!x) return res.status(404).json({ error: 'LOI not found.' });
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="LOI-${x.slot}-${String(x._id).slice(-6)}.docx"`, 'Cache-Control': 'no-store' }).send(Buffer.isBuffer(x.data) ? x.data : Buffer.from(x.data.buffer));   // lean() gives a BSON Binary
  });
}

module.exports = { loiRoutes };
