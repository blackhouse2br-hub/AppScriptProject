'use strict';
// JSON API for MongoDB mode. Each handler is listed explicitly here (no generic dispatch to server functions),
// and every handler checks module access and lead visibility for the signed-in user.
const express = require('express');
const SH = require('../public/shared');
const { Lead, Listing, Viewing, Note, User, Template, AvailabilityRequest, LeadOverride } = require('./models');
const { authRoutes, requireUser, hashPassword, revokeSessions } = require('./auth');
const { dbReady } = require('./db');
const { isId, need, leadScope, viewingScope, findVisibleLead } = require('./access');
const { integrationRoutes, createIntegrations } = require('./integrations/routes');

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
    if (!req.is('application/json') && req.headers['content-length'] !== '0' && req.method !== 'DELETE') return res.status(415).json({ error: 'Send JSON.' });
    next();
  });
  r.use(express.json({ limit: '100kb' }));
  authRoutes(r, config);
  r.use(requireUser);

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

  // ----- team (Settings → Team & Access) -----
  const managers = () => User.countDocuments({ role: 'Manager', active: true });
  r.get('/team', need('team', 'view'), async (req, res) => res.json({ users: await User.find().sort({ role: 1, name: 1 }) }));
  r.post('/team', need('team', 'edit'), async (req, res) => {
    const { value, errors } = SH.validateUser(req.body, { vaLabels: await integ.allowedVaLabels() });
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
    const { value, errors } = SH.validateUser(req.body, { vaLabels: await integ.allowedVaLabels() });
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

  // Monday.com / respond.io (status, live reads); nothing is written to either service except the allowlisted,
  // confirmed Monday updates (POST /monday/write, mondayWrite.js; off unless MONDAY_WRITES=on)
  integrationRoutes(r, integ);

  r.use((req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  r.integ = integ;   // used by server.js to preload Monday.com (read-only) at startup
  return r;
}

module.exports = { apiRouter };
