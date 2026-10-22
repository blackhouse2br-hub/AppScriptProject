'use strict';
// Module-access and lead-visibility checks shared by the MongoDB API and the read-only integration routes.
const mongoose = require('mongoose');
const SH = require('../public/shared');
const { Lead, Viewing } = require('./models');

const isId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(id);

/** Requires at least `level` ('view' | 'edit') on a module. */
const need = (mod, level) => (req, res, next) => {
  const a = SH.access(req.user, mod);
  if (a === 'edit' || (level === 'view' && a === 'view')) return next();
  res.status(403).json({ error: `You don't have ${level} access to ${mod === 'team' ? 'Settings' : mod}.` });
};

// ----- MongoDB visibility (mirrors visibleLeads/visibleViewings in the front end) -----
async function leadScope(user) {
  if (user.role === 'Manager') return {};
  if (user.role === 'VA') return { va: user.vaLabel || '\u0000no-label' };   // a VA without a label sees nothing
  const ids = await Viewing.distinct('leadId', { broker: user.name });
  return { $or: [{ salesperson: user.name }, { _id: { $in: ids } }] };
}
async function viewingScope(user) {
  if (user.role === 'Manager') return {};
  if (user.role === 'Broker') return { broker: user.name };
  return { leadId: { $in: await Lead.distinct('_id', await leadScope(user)) } };
}
async function findVisibleLead(user, id) {
  if (!isId(id)) return null;
  return Lead.findOne({ $and: [{ _id: id }, await leadScope(user)] });
}

// ----- the same rules for records read live from Monday.com (matched by label / name) -----
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function scopeExternal(user, data) {
  if (user.role === 'Manager') return data;
  let leads;
  if (user.role === 'VA') leads = user.vaLabel ? data.leads.filter((l) => norm(l.va) === norm(user.vaLabel)) : [];
  else {
    const mine = new Set(data.viewings.filter((v) => norm(v.broker) === norm(user.name)).map((v) => v.leadId));
    leads = data.leads.filter((l) => norm(l.salesperson) === norm(user.name) || mine.has(l.id));
  }
  const ids = new Set(leads.map((l) => l.id));
  const viewings = user.role === 'Broker' ? data.viewings.filter((v) => norm(v.broker) === norm(user.name)) : data.viewings.filter((v) => ids.has(v.leadId));
  const listings = ['leads', 'invdash', 'calendar'].some((m) => SH.access(user, m) !== 'none') ? data.listings : [];
  return { leads, viewings, listings };
}

module.exports = { isId, need, leadScope, viewingScope, findVisibleLead, scopeExternal };
