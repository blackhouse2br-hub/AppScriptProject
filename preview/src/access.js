'use strict';
// Module-access and lead-visibility checks shared by the MongoDB API and the read-only integration routes.
const mongoose = require('mongoose');
const SH = require('../public/shared');
const { Lead, Viewing, User } = require('./models');

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

// ----- the same rules for records read live from Monday.com (matched by label) -----
const norm = SH.vaKey;   // the same VA-label match as the Leads VA filter and VA Management
/**
 * A Broker's identity on Monday: their exact Salesperson label, set by an admin in Team & Access (user.salesLabel).
 * Missing, or held by more than one active broker → no label (no Monday viewings or clients) and a notice saying why.
 * Resolved once per request (resolveBrokerLabel); scopeExternal denies a Broker whose label wasn't resolved.
 */
async function resolveBrokerLabel(user) {
  if (!user || user.role !== 'Broker') return null;
  const label = String(user.salesLabel || '');
  let r;
  if (!label) r = { label: '', notice: 'Your account has no Monday Salesperson label yet, so no Monday viewings or clients are shown. Ask an admin to set it in Settings → Team & Access.' };
  else if ((await User.countDocuments({ role: 'Broker', active: true, salesLabel: label })) > 1) r = { label: '', notice: `The Monday Salesperson label "${label}" is set for more than one broker, so it can't identify you and no Monday viewings or clients are shown. Ask an admin to fix it in Settings → Team & Access.` };
  else r = { label };
  if (user.$locals) user.$locals.brokerLabel = r; else user._brokerLabel = r;
  return r;
}
const brokerLabelOf = (user) => (user.$locals && user.$locals.brokerLabel) || user._brokerLabel || { label: '' };
function scopeExternal(user, data) {
  if (user.role === 'Manager') return data;
  let leads, label = '';
  if (user.role === 'VA') leads = user.vaLabel ? data.leads.filter((l) => norm(l.va) === norm(user.vaLabel)) : [];
  else {
    // Broker: exact Salesperson label only (no name or first-name matching); none → nothing from Monday
    label = brokerLabelOf(user).label;
    const mine = new Set(label ? data.viewings.filter((v) => v.broker === label).map((v) => v.leadId) : []);
    leads = label ? data.leads.filter((l) => l.salesperson === label || mine.has(l.id)) : [];
  }
  const ids = new Set(leads.map((l) => l.id));
  const viewings = user.role === 'Broker' ? (label ? data.viewings.filter((v) => v.broker === label) : []) : data.viewings.filter((v) => ids.has(v.leadId));
  const listings = ['leads', 'invdash', 'calendar'].some((m) => SH.access(user, m) !== 'none') ? data.listings : [];
  return { leads, viewings, listings };
}

module.exports = { isId, need, leadScope, viewingScope, findVisibleLead, scopeExternal, resolveBrokerLabel, brokerLabelOf };
