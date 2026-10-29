'use strict';
// JSON API for MongoDB mode. Each handler is listed explicitly here (no generic dispatch to server functions),
// and every handler checks module access and lead visibility for the signed-in user.
const express = require('express');
const SH = require('../public/shared');
const { Lead, Listing, Viewing, Note, User, Template, AvailabilityRequest, LeadOverride, RenewalLog, DailyNote, PlCell } = require('./models');
const { authRoutes, requireUser, hashPassword, revokeSessions } = require('./auth');
const { dbReady } = require('./db');
const { isId, need, leadScope, viewingScope, findVisibleLead, resolveBrokerLabel, scopeExternal } = require('./access');
const { integrationRoutes, createIntegrations } = require('./integrations/routes');
const { saveMondayResult, saveMongoResult, pendingFeedback } = require('./integrations/viewingResult');
const { kpiReviewRoutes } = require('./kpiReview');
const { projectRoutes } = require('./projects');
const { upsellRoutes } = require('./upsell');

const bad = (res, errors) => res.status(400).json({ error: errors[0], errors });
const LEAD_SCREENS = ['leads', 'vaportal', 'monitor', 'calendar', 'renewals', 'ldash', 'daily', 'propreq', 'brokers'];
const LISTING_SCREENS = ['leads', 'invdash', 'calendar'];

function apiRouter(config) {
  const r = express.Router();
  const integ = createIntegrations(config);
  const google = config.auth.provider === 'google';

  // the API never silently swaps in demo data: if MongoDB is down, say so
  r.use((req, res, next) => (dbReady() ? next() : res.status(503).json({ error: 'The database is unavailable. Check that MongoDB is running. The app will not switch to demo data.' })));
  // cross-site protection on top of SameSite=Strict cookies: changes only from this server's own page or the portal
  // (PORTAL_URL); a sibling subdomain of the same site is not trusted
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin && origin !== config.web.portalOrigin && origin !== config.web.apiOrigin) {
      let host = ''; try { host = new URL(origin).host; } catch (e) { /* invalid */ }
      if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
    // JSON only; the one exception is a Project Pages file upload (the file itself, checked by projects.js / projectMedia.js)
    const upload = req.method === 'POST' && /^\/(projects\/[a-f0-9]{24}\/media|upsell\/campaigns\/[a-f0-9]{24}\/image)$/.test(req.path);
    if (!upload && !req.is('application/json') && req.headers['content-length'] !== '0' && req.method !== 'DELETE') return res.status(415).json({ error: 'Send JSON.' });
    next();
  });
  r.use(express.json({ limit: '100kb' }));
  authRoutes(r, config);
  r.use(requireUser);
  // a Broker's exact Monday Salesperson label (admin-set; missing or shared → no Monday viewings), resolved once per request
  r.use(async (req, res, next) => { await resolveBrokerLabel(req.user); next(); });

  r.get('/bootstrap', async (req, res) => {
    const u = req.user, sees = (mods) => mods.some((m) => SH.access(u, m) !== 'none');
    const [leads, listings, viewings, users, templates] = await Promise.all([
      sees(LEAD_SCREENS) ? Lead.find(await leadScope(u)).sort({ createdAt: -1 }).limit(5000) : [],
      sees(LISTING_SCREENS) ? Listing.find().sort({ code: 1 }).limit(5000) : [],
      sees(['calendar', 'leads', 'vaportal', 'monitor', 'brokers', 'daily']) ? Viewing.find(await viewingScope(u)).limit(10000) : [],
      SH.access(u, 'team') !== 'none' ? User.find().sort({ role: 1, name: 1 }) : [],
      SH.access(u, 'team') !== 'none' ? Template.find().sort({ name: 1 }) : [],
    ]);
    const ovs = new Map((await LeadOverride.find({ source: 'mongo', failed: { $ne: null } }).limit(20000).lean()).map((o) => [o.leadId, o]));
    // listings get the same one-city label as Monday listings ("Taguig", "BGC" → "Taguig (BGC)"); the stored record is unchanged
    const shown = listings.map((x) => { const j = x.toJSON(); return { ...j, city: SH.canonCity(j.city, j.building) || j.city || '', cityRaw: j.city }; });
    res.json({ user: u.toJSON(), leads: leads.map((l) => SH.applyOverride(l.toJSON(), ovs.get(String(l._id)))), listings: shown, viewings, users, templates });
  });

  // ----- portal-only records for a lead from either source (MongoDB, or Monday.com which stays read-only) -----
  /** The lead if this user may see it: { id }. Monday leads are checked against the live (read-only) board. */
  async function leadFor(req, res) {
    const { source, id } = req.params;
    let lead = null;
    try {
      if (source === 'mongo') { const l = await findVisibleLead(req.user, id); if (l) lead = { id: String(l._id) }; }
      else if (source === 'monday') { const l = await integ.visibleMondayLead(req.user, id); if (l) lead = { id: l.id }; }
    } catch (err) { if (!err.integration) throw err; res.status(502).json({ error: err.message }); return null; }
    if (!lead) res.status(404).json({ error: 'Lead not found.' });
    return lead;
  }
  async function listingFor(source, id) {
    if (source === 'mongo') { const x = isId(id) ? await Listing.findById(id) : null; return x && { id: String(x._id), name: `${x.building} · ${x.code}` }; }
    const x = await integ.mondayListing(id); return x && { id: x.id, name: x.building + (x.tower ? ' · ' + x.tower : '') };
  }
  const who = (req) => ({ name: req.user.name, userId: req.user._id });

  // Asking for Availability: the VA's own record of units they're checking with owners. Nothing is sent to anyone.
  r.get('/leads/:source/:id/asking', need('leads', 'view'), async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    res.json({ requests: await AvailabilityRequest.find({ source: req.params.source, leadId: lead.id }).sort({ createdAt: 1 }).limit(SH.ASK.maxPerLead) });
  });
  r.post('/leads/:source/:id/asking', need('leads', 'edit'), async (req, res) => {
    const { value, errors } = SH.validateAsk(req.body);
    if (errors.length) return bad(res, errors);
    const lead = await leadFor(req, res); if (!lead) return;
    await AvailabilityRequest.init();   // the unique index must exist before inserting, or two presses at once could both insert
    const key = { source: req.params.source, leadId: lead.id, listingId: value.listingId };
    const existing = await AvailabilityRequest.findOne(key);
    if (existing) return res.json({ request: existing, already: true });
    const listing = await listingFor(req.params.source, value.listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if ((await AvailabilityRequest.countDocuments({ source: key.source, leadId: lead.id })) >= SH.ASK.maxPerLead) return bad(res, [`This lead already has ${SH.ASK.maxPerLead} units in Asking for Availability. Remove some first.`]);
    try {
      const request = await AvailabilityRequest.create({ ...key, listingName: listing.name.slice(0, 160), createdBy: who(req), updatedBy: who(req) });
      res.status(201).json({ request });
    } catch (err) {
      if (err.code !== 11000) throw err;   // pressed twice / two people at once: the unique index keeps one record
      res.json({ request: await AvailabilityRequest.findOne(key), already: true });
    }
  });
  /** An Asking record and its lead, if the user may see the lead. */
  async function askFor(req, res) {
    const a = isId(req.params.rid) ? await AvailabilityRequest.findById(req.params.rid) : null;
    if (!a) { res.status(404).json({ error: 'Request not found.' }); return null; }
    req.params.source = a.source; req.params.id = a.leadId;
    return (await leadFor(req, res)) ? a : null;
  }
  r.patch('/asking/:rid', need('leads', 'edit'), async (req, res) => {
    const { value, errors } = SH.validateAskPatch(req.body);
    if (errors.length) return bad(res, errors);
    const a = await askFor(req, res); if (!a) return;
    // contact taps are logged only (the link itself opens on the user's device); the newest SH.ASK.logMax are kept
    const update = value.contacted
      ? { $push: { contacts: { $each: [{ via: value.contacted, by: req.user.name }], $slice: -SH.ASK.logMax } }, $set: { updatedBy: who(req) } }
      : { $set: { status: value.status, updatedBy: who(req) } };
    res.json({ request: await AvailabilityRequest.findByIdAndUpdate(a._id, update, { returnDocument: 'after', runValidators: true }) });
  });
  r.delete('/asking/:rid', need('leads', 'edit'), async (req, res) => {
    const a = await askFor(req, res); if (!a) return;
    await a.deleteOne();
    res.json({ ok: true });
  });

  // Failed override: stored in MongoDB and labelled "Portal override"; Monday's Client Status / AI STATUS are not changed.
  // Managers only (setting and removing).
  const managerOnly = (req, res, next) => (req.user.role === 'Manager' ? next() : res.status(403).json({ error: 'Only Managers can set or remove a Failed override.' }));
  r.put('/leads/:source/:id/override', managerOnly, async (req, res) => {
    const { value, errors } = SH.validateFailOverride(req.body);
    if (errors.length) return bad(res, errors);
    const lead = await leadFor(req, res); if (!lead) return;
    await LeadOverride.init();   // unique index first, so concurrent saves update one record
    const override = await LeadOverride.findOneAndUpdate({ source: req.params.source, leadId: lead.id },
      { $set: { failed: { reason: value.reason, at: new Date(), by: req.user.name, byUserId: req.user._id } } },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true });
    res.json({ override });
  });
  r.delete('/leads/:source/:id/override', managerOnly, async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    await LeadOverride.deleteOne({ source: req.params.source, leadId: lead.id });
    // the lead's own status again: recomputed from Monday (read-only) or the MongoDB record
    let fields;
    if (req.params.source === 'monday') {
      const all = await integ.monday.loadAll(false), l = all.leads.find((x) => x.id === lead.id);
      fields = l ? integ.statusFields(integ.enrich(all, [l], new Map())[0]) : null;
    } else fields = (await Lead.findById(lead.id)).toJSON();
    res.json({ ok: true, lead: fields });
  });

  // ----- leads + notes -----
  r.get('/leads/:id/notes', need('leads', 'view'), async (req, res) => {
    const lead = await findVisibleLead(req.user, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    res.json({ notes: await Note.find({ leadId: lead._id }).sort({ at: 1 }).limit(500) });
  });
  r.patch('/leads/:id', need('leads', 'edit'), async (req, res) => {
    const lead = await findVisibleLead(req.user, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const { value, errors } = SH.validateLeadPatch(req.body);
    if (errors.length) return bad(res, errors);
    const changed = Object.keys(value).filter((k) => String(lead[k] ?? '') !== String(value[k]));
    if (!changed.length) return res.json({ lead, note: null });
    changed.forEach((k) => { lead[k] = value[k]; });
    await lead.save();
    const note = await Note.create({ leadId: lead._id, by: req.user.name, byUserId: req.user._id, text: SH.leadUpdateNote(changed) });
    res.json({ lead, note });
  });
  r.post('/leads/:id/notes', need('leads', 'edit'), async (req, res) => {
    const lead = await findVisibleLead(req.user, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const { value, errors } = SH.validateNote(req.body?.text);
    if (errors.length) return bad(res, errors);
    const note = await Note.create({ leadId: lead._id, by: req.user.name, byUserId: req.user._id, text: value });
    await Lead.updateOne({ _id: lead._id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
    res.status(201).json({ note });
  });

  // ----- listings -----
  r.patch('/listings/:id', need('invdash', 'edit'), async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Listing not found.' });
    const { value, errors } = SH.validateAvailability(req.body);
    if (errors.length) return bad(res, errors);
    const listing = await Listing.findByIdAndUpdate(req.params.id, { $set: value }, { returnDocument: 'after', runValidators: true });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.json({ listing });
  });

  // ----- viewings -----
  r.post('/viewings', need('calendar', 'edit'), async (req, res) => {
    const { leadId, listingId, ...rest } = req.body || {};
    const lead = await findVisibleLead(req.user, leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const listing = isId(listingId) ? await Listing.findById(listingId) : null;
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    const { value, errors } = SH.validateBooking(rest);
    if (errors.length) return bad(res, errors);
    const viewing = await Viewing.create({ ...value, leadId: lead._id, listingId: listing._id, status: 'Proposed', createdBy: req.user.name });
    Object.assign(lead, SH.bookingLeadChanges(lead));
    await lead.save();
    const note = await Note.create({ leadId: lead._id, by: req.user.name, byUserId: req.user._id, text: SH.bookingNote(listing.code, value.date, value.time) });
    res.status(201).json({ viewing, lead, note });
  });
  r.patch('/viewings/:id', need('calendar', 'edit'), async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Viewing not found.' });
    const viewing = await Viewing.findOne({ $and: [{ _id: req.params.id }, await viewingScope(req.user)] });
    if (!viewing) return res.status(404).json({ error: 'Viewing not found.' });
    const { value, errors } = SH.validateViewingPatch(req.body);
    if (errors.length) return bad(res, errors);
    Object.assign(viewing, value);
    await viewing.save();
    res.json({ viewing });
  });
  // the result of a viewing that happened (Create LOI / Failed, reasons, broker feedback): a portal booking ('mongo') or
  // a Monday Calendar-board item ('monday'); each part is saved where it belongs (src/integrations/viewingResult.js)
  r.post('/viewings/:source/:id/result', need('calendar', 'edit'), async (req, res) => {
    const { source, id } = req.params;
    try {
      if (source === 'mongo') return res.json(await saveMongoResult({ user: req.user, id, body: req.body }));
      if (source === 'monday') return res.json(await saveMondayResult({ integ, user: req.user, id, body: req.body }));
      res.status(404).json({ error: 'Viewing not found.' });
    } catch (err) {
      const code = err.httpStatus || (err.integration ? 502 : 500);
      if (code === 500 && !err.integration && !err.httpStatus) throw err;
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      res.status(code).json({ error: err.message, ...['needsConfirm', 'stale', 'writesOff', 'retryAfter', 'partial'].reduce((o, k) => (err[k] ? { ...o, [k]: err[k] } : o), {}) });
    }
  });
  // ----- Renewals: "I sent it from respond.io" log (the portal sends nothing; template key and time only) -----
  r.post('/leads/:source/:id/renewal-log', need('renewals', 'edit'), async (req, res) => {
    const kind = req.body && req.body.kind;
    if (!req.body || Object.keys(req.body).some((k) => k !== 'kind') || !SH.RENEWAL_TEMPLATES.some((t) => t.k === kind)) return bad(res, ['Pick a message template.']);
    const lead = await leadFor(req, res); if (!lead) return;
    const entry = await RenewalLog.create({ source: req.params.source, leadId: lead.id, kind, by: { name: req.user.name, userId: req.user._id } });
    res.status(201).json({ entry: { leadId: lead.id, kind, at: entry.createdAt, by: req.user.name } });
  });
  /** The renewal log of the clients this user can see: { leadId: [{ kind, at, by }] } (newest first, 12 each). */
  r.get('/renewals/log', need('renewals', 'view'), async (req, res) => {
    const source = req.query.source === 'mongo' ? 'mongo' : 'monday';
    let ids;
    if (source === 'mongo') ids = (await Lead.find(await leadScope(req.user), { _id: 1 }).limit(20000).lean()).map((l) => String(l._id));
    else {
      if (!integ.monday) return res.json({ log: {} });
      const all = await integ.monday.loadAll(false);
      ids = scopeExternal(req.user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads.map((l) => l.id);
    }
    const rows = await RenewalLog.find({ source, leadId: { $in: ids } }).sort({ createdAt: -1 }).limit(20000).lean();
    const log = {};
    rows.forEach((x) => { const a = (log[x.leadId] = log[x.leadId] || []); if (a.length < 12) a.push({ kind: x.kind, at: x.createdAt, by: x.by && x.by.name }); });
    res.json({ log });
  });

  // ----- Daily Report: the team's own extra lines (call plan, anything else), as typed -----
  r.get('/daily/notes', need('daily', 'view'), async (req, res) => {
    const n = await DailyNote.findOne({ key: 'daily' }).lean();
    res.json({ notes: { call: (n && n.call) || '', extra: (n && n.extra) || '' } });
  });
  r.put('/daily/notes', need('daily', 'edit'), async (req, res) => {
    const b = req.body || {};
    if (Object.keys(b).some((k) => !['call', 'extra'].includes(k)) || ['call', 'extra'].some((k) => b[k] !== undefined && typeof b[k] !== 'string')) return bad(res, ['Invalid request.']);
    const set = {}; if (b.call !== undefined) set.call = b.call.slice(0, 2000); if (b.extra !== undefined) set.extra = b.extra.slice(0, 4000);
    const n = await DailyNote.findOneAndUpdate({ key: 'daily' }, { $set: { ...set, by: { name: req.user.name, userId: req.user._id } } }, { upsert: true, new: true, runValidators: true });
    res.json({ notes: { call: n.call, extra: n.extra } });
  });

  // ----- P&L: manual monthly lines (the commission figures are read from the Monday Calendar board) -----
  r.get('/pl/cells', need('pl', 'view'), async (req, res) => {
    const cells = {};
    (await PlCell.find({}).limit(5000).lean()).forEach((c) => { (cells[c.line] = cells[c.line] || {})[c.month] = c.value; });
    res.json({ cells });
  });
  r.put('/pl/cells', need('pl', 'edit'), async (req, res) => {
    const { value, errors } = SH.validatePlCell(req.body);
    if (errors.length) return bad(res, errors);
    if (value.value === null) await PlCell.deleteOne({ line: value.line, month: value.month });
    else await PlCell.findOneAndUpdate({ line: value.line, month: value.month }, { $set: { value: value.value, by: { name: req.user.name, userId: req.user._id } } }, { upsert: true, runValidators: true });
    res.json({ cell: value });
  });

  // Pending Broker Feedback beside the Calendar: viewings that happened with no result yet (both sources)
  r.get('/calendar/pending', need('calendar', 'view'), async (req, res) => {
    res.json(await pendingFeedback({ integ, user: req.user, now: Date.now() }));
  });

  // ----- team (Settings → Team & Access) -----
  const managers = () => User.countDocuments({ role: 'Manager', active: true });
  /**
   * Checks a member against the board's labels. A Broker's Salesperson label must be an exact label on Monday (the
   * labels must be readable) and not already held by another active broker. → { value } or { errors }.
   */
  async function checkMember(body, selfId) {
    const salesLabels = await integ.allowedSalesLabels();
    if (body && body.role === 'Broker' && body.salesLabel && !salesLabels) return { errors: ['The Monday Salesperson labels could not be read, so a broker\'s label can\'t be checked. Try again shortly, or save without a label.'] };
    const { value, errors } = SH.validateUser(body, { vaLabels: await integ.allowedVaLabels(), salesLabels: salesLabels || [] });
    if (errors.length) return { errors };
    if (value.salesLabel && await User.exists({ _id: { $ne: selfId || null }, role: 'Broker', active: true, salesLabel: value.salesLabel })) {
      return { errors: [`The Salesperson label "${value.salesLabel}" is already set for another broker. Each broker needs their own label.`] };
    }
    return { value, errors: [] };
  }
  r.get('/team', need('team', 'view'), async (req, res) => res.json({ users: await User.find().sort({ role: 1, name: 1 }) }));
  r.post('/team', need('team', 'edit'), async (req, res) => {
    const { value, errors } = await checkMember(req.body);
    if (errors.length) return bad(res, errors);
    const { password, ...rec } = value;
    if (google) { const user = await User.create(rec); return res.status(201).json({ user }); }   // they sign in with this email's Google account
    if (!password) return bad(res, [`Set a temporary password (at least ${SH.MIN_PASSWORD} characters).`]);
    const user = await User.create({ ...rec, passwordHash: await hashPassword(password) });
    res.status(201).json({ user });
  });
  r.patch('/team/:id', need('team', 'edit'), async (req, res) => {
    const user = isId(req.params.id) ? await User.findById(req.params.id).select('+googleSub') : null;
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    const { value, errors } = await checkMember(req.body, user._id);
    if (errors.length) return bad(res, errors);
    if (user.role === 'Manager' && value.role !== 'Manager' && (await managers()) < 2) return bad(res, ['Keep at least one Manager.']);
    let { password, ...rec } = value;
    if (google) password = '';   // no passwords on a Google sign-in server
    const emailChanged = rec.email !== user.email;
    Object.assign(user, rec);
    if (password) user.passwordHash = await hashPassword(password);
    if (emailChanged) user.googleSub = undefined;   // a new address means a new Google account must be linked
    user.markModified('modules');
    await user.save();
    if (password || emailChanged) await revokeSessions(user._id, user._id.equals(req.user._id) ? req.sessionDoc._id : null);
    res.json({ user });
  });
  r.delete('/team/:id', need('team', 'edit'), async (req, res) => {
    const user = isId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    if (user._id.equals(req.user._id)) return bad(res, ['You can\'t remove yourself.']);
    if (user.role === 'Manager' && (await managers()) < 2) return bad(res, ['Keep at least one Manager.']);
    await user.deleteOne();
    await revokeSessions(user._id);
    res.json({ ok: true });
  });

  // ----- WhatsApp templates (stored only; sending is not connected) -----
  r.get('/templates', need('team', 'view'), async (req, res) => res.json({ templates: await Template.find().sort({ name: 1 }) }));
  r.post('/templates', need('team', 'edit'), async (req, res) => {
    const { value, errors } = SH.validateTemplate(req.body);
    if (errors.length) return bad(res, errors);
    res.status(201).json({ template: await Template.create(value) });
  });
  r.patch('/templates/:id', need('team', 'edit'), async (req, res) => {
    if (!isId(req.params.id)) return res.status(404).json({ error: 'Template not found.' });
    const { value, errors } = SH.validateTemplate(req.body);
    if (errors.length) return bad(res, errors);
    const template = await Template.findByIdAndUpdate(req.params.id, { $set: value }, { returnDocument: 'after', runValidators: true });
    if (!template) return res.status(404).json({ error: 'Template not found.' });
    res.json({ template });
  });
  r.delete('/templates/:id', need('team', 'edit'), async (req, res) => {
    const t = isId(req.params.id) ? await Template.findByIdAndDelete(req.params.id) : null;
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    res.json({ ok: true });
  });

  // KPI Review: coaching and feedback per VA and month, acknowledgment and monthly snapshots (MongoDB only; reads the
  // VA Management data, writes nothing to Monday.com or respond.io)
  kpiReviewRoutes(r, config, integ);
  // Project Pages: projects, units, media (MongoDB / GridFS), preview, optional read-only Google Drive
  projectRoutes(r, config);
  // Upselling: offers to clients, sent 1:1 or tagged through respond.io (sending off unless RESPOND_SENDS=on)
  upsellRoutes(r, config, integ);

  // Monday.com / respond.io (status, live reads); nothing is written to either service except the allowlisted,
  // confirmed Monday updates (POST /monday/write, mondayWrite.js; off unless MONDAY_WRITES=on)
  integrationRoutes(r, integ);

  r.use((req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  r.integ = integ;   // used by server.js to preload Monday.com (read-only) at startup
  return r;
}

module.exports = { apiRouter };
