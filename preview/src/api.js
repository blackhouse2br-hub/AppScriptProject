'use strict';
// JSON API for MongoDB mode. Each handler is listed explicitly here (no generic dispatch to server functions),
// and every handler checks module access and lead visibility for the signed-in user.
const express = require('express');
const SH = require('../public/shared');
const { Lead, Listing, Viewing, Note, User, Template } = require('./models');
const { authRoutes, requireUser, hashPassword, revokeSessions } = require('./auth');
const { dbReady } = require('./db');
const { isId, need, leadScope, viewingScope, findVisibleLead } = require('./access');
const { integrationRoutes, createIntegrations } = require('./integrations/routes');

const bad = (res, errors) => res.status(400).json({ error: errors[0], errors });
const LEAD_SCREENS = ['leads', 'vaportal', 'monitor', 'calendar', 'renewals', 'ldash', 'daily', 'brokers'];
const LISTING_SCREENS = ['leads', 'invdash', 'calendar'];

function apiRouter(config) {
  const r = express.Router();
  const integ = createIntegrations(config);

  // the API never silently swaps in demo data: if MongoDB is down, say so
  r.use((req, res, next) => (dbReady() ? next() : res.status(503).json({ error: 'The database is unavailable. Check that MongoDB is running. The app will not switch to demo data.' })));
  // cross-site protection on top of SameSite=Strict cookies
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin) { let host = ''; try { host = new URL(origin).host; } catch (e) { /* invalid */ } if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' }); }
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
    res.json({ user: u.toJSON(), leads, listings, viewings, users, templates });
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
    if (!value.password) return bad(res, [`Set a temporary password (at least ${SH.MIN_PASSWORD} characters).`]);
    const { password, ...rec } = value;
    const user = await User.create({ ...rec, passwordHash: await hashPassword(password) });
    res.status(201).json({ user });
  });
  r.patch('/team/:id', need('team', 'edit'), async (req, res) => {
    const user = isId(req.params.id) ? await User.findById(req.params.id) : null;
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    const { value, errors } = SH.validateUser(req.body, { vaLabels: await integ.allowedVaLabels() });
    if (errors.length) return bad(res, errors);
    if (user.role === 'Manager' && value.role !== 'Manager' && (await managers()) < 2) return bad(res, ['Keep at least one Manager.']);
    const { password, ...rec } = value;
    Object.assign(user, rec);
    if (password) user.passwordHash = await hashPassword(password);
    user.markModified('modules');
    await user.save();
    if (password) await revokeSessions(user._id, user._id.equals(req.user._id) ? req.sessionDoc._id : null);
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

  // read-only Monday.com / respond.io (status, live reads); nothing is written to either service
  integrationRoutes(r, integ);

  r.use((req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  return r;
}

module.exports = { apiRouter };
