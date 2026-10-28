'use strict';
// Results of viewings that happened: the Calendar's viewing details and its Pending Broker Feedback panel
// (Code.gs apiSetOutcome / apiSaveCalFeedback / pendingFeedback_).
//
// Each part is saved where it belongs:
// - a portal booking (MongoDB Viewing): result, reasons, broker feedback and LOI confidence on the viewing itself;
// - a Monday Calendar-board viewing, as the Apps Script did (Code.gs apiSaveCalFeedback): Create LOI sets its Status to
//   "Under Negotiations" and LOI Creation Date = today (only when empty); Failed changes nothing on Monday. The result,
//   reasons, broker feedback and LOI confidence are kept in the portal (ViewingResult — the Apps Script's bfb_ store). The
//   feedback is copied to Monday only if the owner names one unique text column (MONDAY_CALENDAR_FEEDBACK_COLUMN).
//   Nothing else on the Calendar board can be written.
// Monday parts need MONDAY_WRITES=on and go through the same guarded single-column write, rate limit, fresh re-read,
// confirmation and audit as the other allowlisted Monday updates. If Monday refuses the Status, nothing is saved.
const SH = require('../../public/shared');
const { matchCalendarCols, labelsOf } = require('./monday');
const { isId, viewingScope, scopeExternal } = require('../access');
const { Viewing, Lead, Listing, Note, ViewingResult, MondayWrite } = require('../models');

const CAL = Object.freeze({
  // the only Status a result sets (Create LOI); Failed leaves the Calendar Status as it is
  status: { key: 'status', title: 'Status', types: ['status', 'color'], labels: Object.freeze({ loi: 'Under Negotiations' }) },
  loiDate: { key: 'loi2', title: 'LOI Creation Date', types: ['date'] },
  feedback: { types: ['text', 'long_text'], max: 200 },
});
// Calendar-board statuses / groups that are past the viewing stage (Code.gs pendingFeedback_)
const PAST_VIEWING = /fail|closed|renew|negotiat|owner approval|signature|payment/i;

const fail = (msg, status, extra) => Object.assign(new Error(msg), { httpStatus: status, ...(extra || {}) });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tagText = (tags) => tags.map((t) => SH.FEEDBACK_TAGS[t]).join(', ');
const resultNote = (unit, value) => ['Viewing result — ' + (unit || 'viewing') + ': ' + (value.outcome === 'loi' ? 'LOI' : 'FAILED'),
  value.conf ? 'LOI confidence ' + value.conf.pct + '%' : '', value.tags.length ? tagText(value.tags) : '', value.feedback ? '"' + value.feedback + '"' : ''].filter(Boolean).join(' · ');
/** What the page may show of a saved result (no ids of other users). */
const publicResult = (r) => (r ? { outcome: r.outcome, tags: r.tags || [], feedback: r.feedback || '', loiConf: r.loiConf || null,
  at: r.updatedAt || r.outcomeAt || null, by: (r.by && r.by.name) || r.outcomeBy || '', mondayStatus: r.mondayStatus || '', feedbackOnMonday: !!r.feedbackOnMonday } : null);

/** The Calendar columns a result may write, as on the board now; each must be unambiguous and the one the portal reads. */
async function calendarColumns(monday, outcome, feedbackId) {
  const cols = await monday.boardColumns('calendar'), mapped = matchCalendarCols(cols);
  const one = (spec) => {
    const named = cols.filter((c) => norm(c.title) === norm(spec.title));
    if (!named.length) throw fail(`The Monday Calendar board has no "${spec.title}" column; nothing was changed.`, 409);
    if (named.length > 1) throw fail(`The Monday Calendar board has more than one "${spec.title}" column; nothing is written until there is one.`, 409);
    const c = named[0];
    if (c.id !== mapped[spec.key]) throw fail(`The portal reads ${spec.title} from a different Calendar column than "${c.title}"; nothing is written until they match.`, 409);
    if (!spec.types.includes(c.type)) throw fail(`The Monday Calendar "${c.title}" column is a ${c.type} column, not the expected kind; nothing was changed.`, 409);
    return { id: c.id, title: c.title, type: c.type, labels: labelsOf(c) };
  };
  const loi = outcome === 'loi', out = { status: loi ? one(CAL.status) : null, loiDate: loi ? one(CAL.loiDate) : null, feedback: null };
  if (feedbackId) {
    const c = cols.find((x) => x.id === feedbackId);
    if (!c) throw fail(`MONDAY_CALENDAR_FEEDBACK_COLUMN (${feedbackId}) is not a column of the Calendar board; nothing was changed.`, 409);
    if (!CAL.feedback.types.includes(c.type)) throw fail(`MONDAY_CALENDAR_FEEDBACK_COLUMN names "${c.title}", a ${c.type} column, not a text column; nothing was changed.`, 409);
    if (Object.values(mapped).includes(c.id)) throw fail(`MONDAY_CALENDAR_FEEDBACK_COLUMN names "${c.title}", which the portal already reads for something else; nothing was changed.`, 409);
    out.feedback = { id: c.id, title: c.title, type: c.type };
  }
  return out;
}

/** MondayWrite audit: logged before sending (a change that can't be logged isn't sent), finished with Monday's answer. */
const audit = {
  start: async (e) => (await MondayWrite.create({ ...e, ok: false, error: 'Not confirmed by Monday.com yet.' }))._id,
  finish: async (id, fields) => { try { await MondayWrite.updateOne({ _id: id }, { $set: fields }); } catch (e) { console.error('[viewing-result] audit entry not updated:', e.name); } },
};

/**
 * The result of a Monday Calendar-board viewing. body: { outcome, tags, feedback, conf, state, expect, confirm }:
 * expect = the Status label the page showed (Create LOI is refused if Monday holds another one by now); confirm = the
 * user agreed to replace it. Writes happen one column at a time, Status first; if Status is refused nothing is saved.
 * Failed writes nothing on Monday (unless a feedback column is configured), so it also works with Monday writes off.
 */
async function saveMondayResult({ integ, user, id, body }) {
  const { monday } = integ;
  if (!monday) throw fail('Monday.com is not connected.', 409);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Invalid request.', 400);
  if (body.outcome === 'loi' && !monday.writesEnabled) throw fail('Monday updates are switched off on this server, so Create LOI (which sets the Calendar Status on Monday) can\'t be saved.', 409, { writesOff: true });
  const { expect, confirm, ...rest } = body;
  if (expect !== undefined && typeof expect !== 'string') throw fail('Invalid request.', 400);
  if (confirm !== undefined && typeof confirm !== 'boolean') throw fail('Invalid request.', 400);
  const fbCol = integ.ic.monday.calFeedbackColumn;
  const { value, errors } = SH.validateResult(rest, fbCol ? CAL.feedback.max : undefined);
  if (errors.length) throw fail(errors[0], 400);
  if (!/^\d{1,20}$/.test(String(id))) throw fail('Viewing not found.', 404);
  // counted before anything is read from or sent to Monday
  const wait = integ.writeLimit ? integ.writeLimit(user._id) : 0;
  if (wait) throw fail(`Too many Monday updates in a short time. Nothing was changed; try again in ${wait} s.`, 429, { retryAfter: wait });
  const all = await monday.loadAll(false);
  if (all.errors.viewings) throw fail('The Monday Calendar board could not be read: ' + all.errors.viewings, 502);
  const scoped = scopeExternal(user, { leads: all.leads, viewings: all.viewings, listings: [] });
  const v = scoped.viewings.find((x) => x.id === String(id));
  if (!v) throw fail('Viewing not found.', 404);
  if (!v.leadId) throw fail('This Calendar item has no linked client, so its result can\'t be recorded.', 409);
  // as in the pending list: the client must be one this user can see in the portal
  if (!scoped.leads.some((l) => l.id === v.leadId)) throw fail('This viewing\'s client isn\'t visible to you in the portal, so its result can\'t be recorded here.', 409);
  // a configured feedback column is written only while Monday writes are on
  const copyFeedback = !!fbCol && monday.writesEnabled;
  const cols = await calendarColumns(monday, value.outcome, copyFeedback ? fbCol : '');
  const target = CAL.status.labels[value.outcome] || '';
  if (cols.status && !cols.status.labels.includes(target)) throw fail(`The Calendar "${cols.status.title}" column has no "${target}" label; nothing was changed.`, 409);
  // what Monday holds right now, not the server's copy, decides what is replaced
  let live;
  try { live = await monday.refreshItem('calendar', String(id), { remember: false }); } catch (e) { throw fail('Could not read the viewing from Monday.com, so nothing was changed.' + (e.integration ? ' ' + e.message : ''), 502); }
  if (!live) throw fail('Viewing not found.', 404);
  // the server's copy is refreshed with what Monday holds, so the page's reload shows it
  const changed = (msg) => monday.refreshItem('calendar', String(id)).catch(() => null).then(() => { throw fail(msg, 409, { stale: true }); });
  // the item as it is now must still be this user's and still linked to the same client
  if (live.leadId !== v.leadId || !scopeExternal(user, { leads: all.leads, viewings: [live], listings: [] }).viewings.length) {
    return changed('This viewing\'s client or broker has changed on Monday since the page loaded. Nothing was changed; reload and check it.');
  }
  const before = String(live.statusLabel || '').trim();
  // only a result that replaces the Status needs it to be what the page showed
  if (cols.status && expect !== undefined && expect.trim() !== before) return changed('This viewing\'s Status on Monday has changed since the page loaded. Nothing was changed; reload and check it.');
  const writes = [];
  if (cols.status && before !== target) {
    if (before && confirm !== true) throw fail(`This replaces the viewing's Status on Monday ("${before}" → "${target}"). Confirm to continue.`, 409, { needsConfirm: true });
    writes.push({ action: 'viewingResultStatus', col: cols.status, value: target, from: before, label: true });
  }
  if (cols.loiDate && !live.loiCreated) writes.push({ action: 'viewingLoiDate', col: cols.loiDate, value: todayManila() });
  if (cols.feedback && value.feedback) writes.push({ action: 'viewingFeedback', col: cols.feedback, value: value.feedback.replace(/\s+/g, ' ') });

  const done = [], warnings = [], by = { name: user.name, userId: user._id };
  const prev = await ViewingResult.findOne({ viewingId: String(id) }, { feedbackOnMonday: 1 }).lean();
  if (fbCol && !copyFeedback && value.feedback) warnings.push('Monday updates are switched off, so the feedback was not copied to the Calendar feedback column.');
  if (cols.feedback && !value.feedback && prev && prev.feedbackOnMonday) warnings.push(`The earlier feedback stays in Monday's "${cols.feedback.title}" column (the portal never clears Monday values).`);
  for (const w of writes) {
    // every Monday change counts toward the rate limit (the request itself counted the first one)
    if (w !== writes[0] && integ.writeLimit && integ.writeLimit(user._id)) { warnings.push(`${w.col.title} was not updated: too many Monday updates in a short time.`); continue; }
    const entry = { action: w.action, board: 'calendar', itemId: String(id), column: w.col.title.slice(0, 80), by,
      // labels are board options; dates and feedback text are not stored in the audit
      ...(w.label ? { from: w.from.slice(0, 60), to: w.value.slice(0, 60) } : {}) };
    let auditId;
    try { auditId = await audit.start(entry); } catch (e) {
      if (!done.length) throw fail('The change could not be logged in the portal, so it was not sent to Monday.com.', 503);
      warnings.push(`${w.col.title} was not updated (the change could not be logged).`); continue;
    }
    try {
      await monday.writeColumn({ board: 'calendar', itemId: String(id), columnId: w.col.id, value: w.value });
      await audit.finish(auditId, { ok: true, error: '' });
      done.push({ column: w.col.title, ...(w.label ? { from: w.from, to: w.value } : w.action === 'viewingLoiDate' ? { to: w.value } : {}) });
    } catch (err) {
      await audit.finish(auditId, { ok: false, error: String(err.message || err).slice(0, 200) });
      if (!done.length && w.label) throw err;   // the Status itself was refused: nothing changed anywhere
      warnings.push(`${w.col.title} was not updated on Monday: ${err.message}`);
    }
  }
  const feedbackOnMonday = done.some((d) => cols.feedback && d.column === cols.feedback.title);
  let rec;
  try {
    rec = await ViewingResult.findOneAndUpdate({ viewingId: String(id) }, { $set: {
      leadId: v.leadId, outcome: value.outcome, tags: value.tags, feedback: value.feedback, loiConf: value.conf || null,
      unit: { building: (v.building || '').slice(0, 120), city: (v.city || '').slice(0, 80) }, date: v.date, mondayStatus: target, feedbackOnMonday, by,
    } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  } catch (e) {
    console.error('[viewing-result] portal record not saved:', e.name);
    if (done.length) await monday.refreshItem('calendar', String(id)).catch(() => null);   // the page reloads what Monday holds now
    throw fail(done.length ? 'Monday was updated (' + done.map((d) => d.column).join(', ') + '), but the reasons and broker feedback could not be saved in the portal. Reload and save the result again.' : 'The result could not be saved.', 500, { partial: done.length > 0 });
  }
  // only a change on Monday needs the copy re-read (and the board reloaded for the clients' LOI evidence)
  let fresh = null;
  if (done.length) { try { fresh = await monday.refreshItem('calendar', String(id)); } catch (e) { /* saved; the page reloads the board later */ } }
  const statusDone = cols.status && done.find((d) => d.column === cols.status.title);
  const shown = fresh || { ...live, ...(statusDone ? { statusLabel: target, status: 'Done' } : {}) };
  return { ok: true, source: 'monday', viewing: { ...shown, feedback: rec.feedback, result: publicResult(rec) }, written: done,
    feedbackSavedTo: feedbackOnMonday ? 'monday+portal' : 'portal', feedbackColumn: cols.feedback ? cols.feedback.title : '', warnings };
}

/** The result of a portal booking (MongoDB): kept on the viewing, which becomes Done; a note goes on the lead. */
async function saveMongoResult({ user, id, body }) {
  if (!isId(id)) throw fail('Viewing not found.', 404);
  const v = await Viewing.findOne({ $and: [{ _id: id }, await viewingScope(user)] });
  if (!v) throw fail('Viewing not found.', 404);
  const { value, errors } = SH.validateResult(body);
  if (errors.length) throw fail(errors[0], 400);
  Object.assign(v, { status: 'Done', outcome: value.outcome, feedbackTags: value.tags, feedback: value.feedback, loiConf: value.conf || null, outcomeAt: new Date(), outcomeBy: user.name });
  await v.save();
  const listing = await Listing.findById(v.listingId, { code: 1, building: 1 }).lean();
  await Note.create({ leadId: v.leadId, by: user.name, byUserId: user._id, text: resultNote(listing && (listing.code || listing.building), value).slice(0, 2000) });
  return { ok: true, source: 'mongo', viewing: v, feedbackSavedTo: 'portal', written: [], warnings: [] };
}

/**
 * Pending Broker Feedback for this user: viewings that happened (from 12 Oct 2026, the last 60 days) with no result yet.
 * Portal bookings: Confirmed / Done. Calendar-board items: Final Schedule passed, client visible, no LOI / contract,
 * still at the viewing stage, no result saved, and no portal booking for the same client within 1.5 days.
 */
async function pendingFeedback({ integ, user, now }) {
  const since = SH.pendingSince(now), rows = [], errors = {}, portalDays = {};
  const vs = await Viewing.find({ $and: [await viewingScope(user), { status: { $ne: 'Cancelled' } }] }).limit(10000).lean();
  const leads = new Map((await Lead.find({ _id: { $in: [...new Set(vs.map((v) => String(v.leadId)))] } }, { mondayItemId: 1 }).lean()).map((l) => [String(l._id), l]));
  const listings = new Map((await Listing.find({ _id: { $in: [...new Set(vs.map((v) => String(v.listingId)))] } }, { code: 1, building: 1, city: 1 }).lean()).map((x) => [String(x._id), x]));
  vs.forEach((v) => {
    const t = SH.viewingAt(v), l = leads.get(String(v.leadId));
    if (t && l && l.mondayItemId) (portalDays[l.mondayItemId] = portalDays[l.mondayItemId] || []).push(t);
    if (!SH.portalPending(v, now)) return;
    const x = listings.get(String(v.listingId)) || {};
    rows.push({ src: 'mongo', id: String(v._id), leadId: String(v.leadId), date: v.date, time: v.time, when: t, broker: v.broker, status: v.status,
      unit: { building: x.building || '', city: x.city || '', code: x.code || '' } });
  });
  const ic = integ.ic.monday;
  if (integ.monday && ic.boards.calendar && ic.boards.leads) {
    try {
      const all = await integ.monday.loadAll(false);
      if (all.errors.viewings || all.errors.leads) errors.monday = all.errors.viewings || all.errors.leads;
      else {
        const scoped = scopeExternal(user, { leads: all.leads, viewings: all.viewings, listings: [] }), visible = new Set(scoped.leads.map((l) => l.id));
        const saved = new Set((await ViewingResult.find({ viewingId: { $in: scoped.viewings.map((v) => v.id) } }, { viewingId: 1 }).lean()).map((r) => r.viewingId));
        scoped.viewings.forEach((v) => {
          const fin = Date.parse(v.date + 'T12:00:00+08:00');
          if (!visible.has(v.leadId) || !fin || fin > now || fin < since || saved.has(v.id) || v.loi || v.contract) return;
          if (PAST_VIEWING.test(v.statusLabel + ' ' + v.group)) return;
          if ((portalDays[v.leadId] || []).some((t) => Math.abs(t - fin) < 1.5 * 864e5)) return;   // the same viewing booked in the portal
          rows.push({ src: 'monday', id: v.id, leadId: v.leadId, date: v.date, time: v.time, when: fin, broker: v.broker, status: v.statusLabel,
            unit: { building: v.building, city: v.city } });
        });
      }
    } catch (e) { if (!e.integration) throw e; errors.monday = e.message; }
  }
  rows.sort((a, b) => b.when - a.when);
  return { rows, errors, since: new Date(since).toISOString() };
}

/** Saved results for these Calendar items (shown on the viewings; they also shape the clients' property suggestions). */
async function mondayResults(viewingIds) {
  const rs = await ViewingResult.find({ viewingId: { $in: viewingIds } }).limit(20000).lean();
  return new Map(rs.map((r) => [r.viewingId, { ...publicResult(r), unit: r.unit || {} }]));
}

module.exports = { CAL, saveMondayResult, saveMongoResult, pendingFeedback, mondayResults, publicResult };
