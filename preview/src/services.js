'use strict';
// Service Requests (Code.gs apiServiceScan / apiGetServiceBoard / apiServiceUpdate / apiSaveSuppliers / apiSupplierSend).
// After a services offer (Renewals → Message, or Upselling), "Check replies" reads each client's respond.io replies and
// AI marks their interest per offered service. Staff send an anonymised request to a supplier — through respond.io
// (only with RESPOND_SENDS=on, confirmed, recorded first) or by WhatsApp / Viber / email opened on their own device —
// and move the request through its stages. Nothing here writes to Monday; the client's name never goes to a supplier.
const SH = require('../public/shared');
const { Lead, RenewalLog, UpsellSend, UpsellCampaign, UpsellLegacy, ServiceRequest, Supplier, ServiceSend } = require('./models');
const { need, leadScope, scopeExternal } = require('./access');
const { createServiceAi } = require('./serviceAi');
const { createRespondSender } = require('./integrations/respondio');

const SV = SH.SERVICES;
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const isId = (s) => /^[a-f0-9]{24}$/.test(String(s || ''));
const SCAN_MAX = 15, SCAN_MS = 25e3;

function serviceRoutes(r, config, integ) {
  const rc = config.integrations.respond;
  const sender = rc.token && rc.sends ? createRespondSender(rc) : null;
  const ai = config.projects && config.projects.ai ? createServiceAi(config.projects.ai) : null;
  const view = need('services', 'view'), edit = need('services', 'edit');
  const setup = () => ({ ai: !!ai, aiModel: ai ? ai.model : '', respondRead: !!integ.respond, supplierSends: !!sender });

  /** The clients this member may see, from one source: [{ id, name, va, contactId, area, city }]. */
  async function clients(user, source) {
    if (source === 'monday') {
      if (!integ.monday) return [];
      const all = await integ.monday.loadAll(false);
      if (all.errors.leads) { const e = new Error('The Monday leads board could not be read: ' + all.errors.leads); e.integration = 'monday'; throw e; }
      const leads = scopeExternal(user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads;
      // area: the client's lease building (latest Calendar deal), else the board's building (as apiGetServiceBoard)
      const lease = {};
      (all.deals || []).filter((d) => d.leadId && d.building).sort((a, b) => String(a.contract || a.fin).localeCompare(String(b.contract || b.fin))).forEach((d) => { lease[d.leadId] = d; });
      return leads.map((l) => ({ id: String(l.id), name: l.name || '', email: l.email || '', phone: l.phone || '', va: l.va || '', contactId: String(l.contactId || '').replace(/\D/g, ''),
        area: (lease[l.id] && lease[l.id].building) || String(l.building || '').split(',')[0].trim(), city: (lease[l.id] && lease[l.id].city) || l.city || '' }));
    }
    const leads = await Lead.find(await leadScope(user)).limit(20000).lean();
    return leads.map((l) => ({ id: String(l._id), name: l.name || '', email: l.email || '', phone: l.phone || '', va: l.va || '', contactId: String(l.contactId || '').replace(/\D/g, ''), area: String(l.building || '').split(',')[0].trim(), city: l.city || '' }));
  }
  /** Service offers sent to these clients (Renewals log + Upselling sends): { leadId: { svc: firstSentMs } }. */
  async function offers(source, ids) {
    // (plus the Apps Script's own offer history, once imported: scripts/import-legacy-upsell.js)
    const [logs, sends, legacy] = await Promise.all([
      RenewalLog.find({ source, leadId: { $in: ids } }, { leadId: 1, kind: 1, createdAt: 1 }).lean(),
      UpsellSend.find({ source, leadId: { $in: ids }, action: 'message', status: 'sent' }, { leadId: 1, campaignId: 1, updatedAt: 1 }).lean(),
      UpsellLegacy.find({ source, leadId: { $in: ids }, action: { $in: ['message', 'renewal'] } }, { leadId: 1, kind: 1, at: 1 }).lean(),
    ]);
    legacy.forEach((x) => logs.push({ leadId: x.leadId, kind: x.kind, createdAt: x.at }));
    const camps = new Map((await UpsellCampaign.find({ _id: { $in: [...new Set(sends.map((s) => String(s.campaignId)))] } }, { template: 1 }).lean()).map((c) => [String(c._id), c.template]));
    const by = {};
    logs.forEach((x) => (by[x.leadId] = by[x.leadId] || []).push({ kind: x.kind, at: +x.createdAt }));
    sends.forEach((x) => (by[x.leadId] = by[x.leadId] || []).push({ kind: camps.get(String(x.campaignId)) || '', at: +x.updatedAt }));
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, SH.serviceOffers(v)]).filter(([, o]) => Object.keys(o).length));
  }
  const rowOut = (x, c) => ({ id: String(x._id), ref: SH.serviceRef(x.leadId, x.svc), leadId: x.leadId, source: x.source, svc: x.svc, interest: x.interest, summary: x.summary, details: x.details || {},
    stage: x.stage, supplierId: x.supplierId, supplier: x.supplierName, notes: x.notes, offeredAt: x.offeredAt, lastReply: x.lastReply, sentToSupplierAt: x.sentToSupplierAt,
    scannedAt: x.scannedAt, history: (x.history || []).slice(-5), version: x.version, name: c ? c.name : '', va: c ? c.va : '', area: c ? c.area : '', city: c ? c.city : '' });
  const srcOf = (req) => (req.query.source === 'mongo' || (req.body && req.body.source === 'mongo') ? 'mongo' : 'monday');
  const failed = (res, err) => { if (!err.integration) throw err; res.status(err.httpStatus || 502).json({ error: err.message }); };

  // ----- the board -----
  r.get('/services', view, async (req, res) => {
    const source = srcOf(req);
    let cs; try { cs = await clients(req.user, source); } catch (err) { return failed(res, err); }
    const byId = new Map(cs.map((c) => [c.id, c]));
    const rows = (await ServiceRequest.find({ source, leadId: { $in: [...byId.keys()] } }).lean()).map((x) => rowOut(x, byId.get(x.leadId)))
      .sort((a, b) => +new Date(b.lastReply || b.offeredAt || 0) - +new Date(a.lastReply || a.offeredAt || 0));
    const suppliers = (await Supplier.find().sort({ svc: 1, name: 1 }).lean()).map((s) => ({ id: String(s._id), svc: s.svc, name: s.name, channel: s.channel, contact: s.contact, respondId: s.respondId, notes: s.notes }));
    res.json({ source, rows, suppliers, stages: SV.stages, services: SV.keys.map((k) => ({ k, label: SH.serviceLabel(k) })), setup: setup(),
      canEdit: SH.access(req.user, 'services') === 'edit', manager: req.user.role === 'Manager' });
  });

  // ----- "Check replies": a bounded batch per call; the page calls again while remaining > 0 -----
  r.post('/services/scan', edit, async (req, res) => {
    const source = srcOf(req), force = !!(req.body && req.body.force === true), now = Date.now(), t0 = now;
    if (!integ.respond) return res.status(409).json({ error: 'respond.io is not connected (RESPOND_TOKEN), so replies can\'t be read.' });
    let cs; try { cs = await clients(req.user, source); } catch (err) { return failed(res, err); }
    const byId = new Map(cs.filter((c) => c.contactId).map((c) => [c.id, c]));
    const off = await offers(source, [...byId.keys()]);
    const existing = await ServiceRequest.find({ source, leadId: { $in: Object.keys(off) } }).lean();
    const lastScan = {}; existing.forEach((x) => { if (x.scannedAt && (!lastScan[x.leadId] || x.scannedAt > lastScan[x.leadId])) lastScan[x.leadId] = +x.scannedAt; });
    // as the Apps Script: offers in the last 120 days, a respond.io contact, not read in the last 3 hours (unless forced)
    const todo = Object.entries(off).filter(([id, o]) => Math.min(...Object.values(o)) >= now - SV.offerDays * 864e5 && (force || !lastScan[id] || now - lastScan[id] >= SV.rescanHours * 3600e3));
    let scanned = 0; const errors = [];
    for (const [id, o] of todo.slice(0, SCAN_MAX)) {
      if (Date.now() - t0 > SCAN_MS) break;
      const c = byId.get(id);
      let msgs;
      try { msgs = await integ.respond.recent(c.contactId, 50); } catch (err) { errors.push(SH.serviceRef(id, '') + ': ' + err.message); if (/rejected|rate-limiting/.test(err.message)) break; continue; }
      const first = Math.min(...Object.values(o)), after = msgs.filter((m) => (m.ts || 0) >= first - 60e3), replies = after.filter((m) => m.from === 'client' && m.text);
      let found = {}, aiFailed = false, stop = false;
      if (replies.length && ai) {
        // the chat is redacted before it leaves the portal: no client name, email, phone, link, unit number or ID
        // (unit numbers seen anywhere in the chat are also removed where they appear bare, here and in the answer)
        const pc = { ...c, units: [...new Set(after.flatMap((m) => SH.unitsIn(m.text)))] };
        const convo = after.slice(-30).map((m) => (m.from === 'client' ? 'CLIENT: ' : 'BLACKHOUSE: ') + SH.redactForAi(String(m.text).slice(0, 600), pc)).join('\n');
        // a failed read leaves the client unscanned (read again next time); busy or a key / credit problem stops the batch
        try { found = await ai.classify({ offered: Object.keys(o), convo }); } catch (err) { if (!err.integration) throw err; errors.push(err.message); aiFailed = true; stop = err.httpStatus === 429 || !!err.fatal; }
        // and whatever comes back is checked again before it is saved or shown (it can reach a supplier)
        Object.values(found).forEach((f) => {
          f.summary = SH.redactForAi(f.summary, pc);
          Object.keys(f.details).forEach((k) => { f.details[k] = SH.redactForAi(f.details[k], pc); });
          if (SH.leaksClient([f.summary].concat(Object.values(f.details)).join(' '), pc)) { f.summary = ''; f.details = Object.fromEntries(SV.detailKeys.map((k) => [k, ''])); }
        });
      }
      const lastReply = replies.length ? new Date(replies[replies.length - 1].ts) : null;
      for (const [svc, at] of Object.entries(o)) {
        const f = found[svc];
        await ServiceRequest.updateOne({ source, leadId: id, svc },
          { $set: { offeredAt: new Date(at), ...(aiFailed ? {} : { scannedAt: new Date() }), ...(f ? { interest: f.interest, summary: f.summary, details: f.details, lastReply } : {}) },
            $setOnInsert: { stage: 'New', history: [{ at: new Date(), by: req.user.name, stage: 'New', what: 'Offer found' }] } }, { upsert: true });
      }
      scanned++;
      if (stop) break;
    }
    res.json({ scanned, remaining: todo.length - scanned, errors: errors.slice(0, 5), aiMissing: !ai });
  });

  /** A request this member may see (its client is visible to them). */
  async function requestFor(req, res) {
    const x = isId(req.params.id) ? await ServiceRequest.findById(req.params.id) : null;
    if (!x) { res.status(404).json({ error: 'Request not found.' }); return null; }
    let cs; try { cs = await clients(req.user, x.source); } catch (err) { failed(res, err); return null; }
    const c = cs.find((y) => y.id === x.leadId);
    if (!c) { res.status(404).json({ error: 'Request not found.' }); return null; }
    return { x, c };
  }
  const hist = (by, stage, what) => ({ $push: { history: { $each: [{ at: new Date(), by, stage, what }], $slice: -20 } } });

  r.patch('/services/:id', edit, async (req, res) => {
    const { value, errors } = SH.validateServicePatch(req.body); if (errors.length) return bad(res, errors[0]);
    const t = await requestFor(req, res); if (!t) return;
    const { version, ...set } = value;
    const what = Object.keys(set).map((k) => k === 'stage' ? 'Stage: ' + set.stage : k === 'interest' ? 'Interest: ' + set.interest : 'Notes').join(', ');
    const doc = await ServiceRequest.findOneAndUpdate({ _id: t.x._id, version }, { $set: set, $inc: { version: 1 }, ...hist(req.user.name, set.stage || t.x.stage, what) }, { returnDocument: 'after', runValidators: true }).lean();
    if (!doc) return res.status(409).json({ error: 'Someone else changed this request. Reload and try again.' });
    res.json({ row: rowOut(doc, t.c) });
  });

  /** Code.gs svSendModal "Mark as sent" (after WhatsApp / Viber / email from the member's own device). */
  r.post('/services/:id/mark-sent', edit, async (req, res) => {
    const t = await requestFor(req, res); if (!t) return;
    const sp = isId(req.body && req.body.supplierId) ? await Supplier.findById(req.body.supplierId).lean() : null;
    if (!sp || sp.svc !== t.x.svc) return bad(res, 'Pick one of this service\'s suppliers.');
    const doc = await ServiceRequest.findByIdAndUpdate(t.x._id, { $set: { stage: 'Sent to supplier', supplierId: String(sp._id), supplierName: sp.name, sentToSupplierAt: new Date() }, $inc: { version: 1 },
      ...hist(req.user.name, 'Sent to supplier', 'Sent to ' + sp.name + ' (' + sp.channel + ', from their own device)') }, { returnDocument: 'after' }).lean();
    res.json({ row: rowOut(doc, t.c) });
  });

  /** Code.gs apiSupplierSend: the reviewed text to the supplier's respond.io contact. Off unless RESPOND_SENDS=on. */
  r.post('/services/:id/send', edit, async (req, res) => {
    const b = req.body || {};
    if (b.confirm !== true) return bad(res, 'Confirm the send first.');
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text || text.length > SV.textMax) return bad(res, `Write the request (up to ${SV.textMax} characters).`);
    const t = await requestFor(req, res); if (!t) return;
    const sp = isId(b.supplierId) ? await Supplier.findById(b.supplierId).lean() : null;
    if (!sp || sp.svc !== t.x.svc) return bad(res, 'Pick one of this service\'s suppliers.');
    if (!sp.respondId) return bad(res, 'This supplier has no respond.io contact ID — use the WhatsApp / Viber / email button instead.');
    if (!sender) return res.status(409).json({ error: 'Sending through respond.io is switched off on this server (RESPOND_SENDS). Use the WhatsApp / Viber / email button, then "Mark as sent".' });
    if (sender.onlyTo.length && req.user.role !== 'Manager') return res.status(403).json({ error: 'This server is in a controlled test (RESPOND_SEND_ONLY_TO): only a Manager can send on respond.io.' });
    if (!sender.allowed(sp.respondId)) return res.status(409).json({ error: 'This server only sends to the test contacts in RESPOND_SEND_ONLY_TO, and this supplier isn\'t one. Nothing was sent.' });
    // the client's name, number or email must not be in it (the page warns; the server refuses)
    if (SH.leaksClient(text, t.c)) return bad(res, 'The text contains the client\'s name, a phone number or an email. Remove it: suppliers never get the client\'s details.');
    // a send that never finished (the server stopped mid-send) counts as possibly sent: no longer in flight
    await ServiceSend.updateMany({ requestId: t.x._id, supplierId: String(sp._id), status: 'sending', createdAt: { $lt: new Date(Date.now() - 5 * 60e3) } }, { $set: { status: 'unknown', error: 'The server stopped before the result was known: check the chat.' }, $unset: { lock: 1 } });
    // sent (or possibly sent) to this supplier before: only again when the member says so
    const prev = await ServiceSend.findOne({ requestId: t.x._id, supplierId: String(sp._id), status: { $in: ['sent', 'unknown'] } }).sort({ createdAt: -1 }).lean();
    if (prev && b.resend !== true) return res.status(409).json({ error: `This request was already ${prev.status === 'sent' ? 'sent' : 'possibly sent'} to ${sp.name} (${prev.by}). Check the supplier's chat in respond.io before sending it again.`, already: true });
    await ServiceSend.init();   // the lock's unique index must exist before the first send
    let rec;
    try { rec = await ServiceSend.create({ requestId: t.x._id, supplierId: String(sp._id), supplierName: sp.name, text, by: req.user.name, lock: `${t.x._id}:${sp._id}` }); }
    catch (err) { if (err.code === 11000) return res.status(409).json({ error: 'This request is being sent to that supplier right now.' }); throw err; }
    try { await sender.text(sp.respondId, text); }
    catch (err) {
      await ServiceSend.updateOne({ _id: rec._id }, { $set: { status: err.unknown ? 'unknown' : 'failed', error: String(err.message).slice(0, 300) }, $unset: { lock: 1 } });
      return res.status(err.unknown ? 502 : 409).json({ error: err.message, unknown: !!err.unknown });
    }
    await ServiceSend.updateOne({ _id: rec._id }, { $set: { status: 'sent' }, $unset: { lock: 1 } });
    const doc = await ServiceRequest.findByIdAndUpdate(t.x._id, { $set: { stage: 'Sent to supplier', supplierId: String(sp._id), supplierName: sp.name, sentToSupplierAt: new Date() }, $inc: { version: 1 },
      ...hist(req.user.name, 'Sent to supplier', 'Sent to ' + sp.name + ' via respond.io') }, { returnDocument: 'after' }).lean();
    res.json({ row: rowOut(doc, t.c), sent: true });
  });

  // ----- suppliers (Code.gs apiSaveSuppliers): the whole list, saved by a Manager -----
  r.put('/services/suppliers', edit, async (req, res) => {
    if (req.user.role !== 'Manager') return res.status(403).json({ error: 'Only Managers edit the supplier list.' });
    const { value, errors } = SH.validateSuppliers(req.body && req.body.suppliers); if (errors.length) return bad(res, errors[0]);
    const keep = value.filter((s) => s.id).map((s) => s.id);
    await Supplier.deleteMany({ _id: { $nin: keep } });
    for (const s of value) {
      const doc = { svc: s.svc, name: s.name, channel: s.channel, contact: s.contact, respondId: s.respondId, notes: s.notes, updatedBy: req.user.name };
      if (s.id) await Supplier.updateOne({ _id: s.id }, { $set: doc }, { runValidators: true }); else await Supplier.create(doc);
    }
    const out = (await Supplier.find().sort({ svc: 1, name: 1 }).lean()).map((x) => ({ id: String(x._id), svc: x.svc, name: x.name, channel: x.channel, contact: x.contact, respondId: x.respondId, notes: x.notes }));
    res.json({ suppliers: out });
  });
}

module.exports = { serviceRoutes };
