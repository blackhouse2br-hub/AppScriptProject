'use strict';
// Allowlisted Monday.com updates. Each action names its board, the portal field (found on the board by column TITLE
// at write time, as reads do), the column types it accepts, the values it accepts and the permission it needs.
// Anything not described here can't be written. Values are never empty: an action can change a value, never delete one.
// The request carries only { action, itemId, value, confirm, expect }; the board, column and mutation are decided here.
// The Monday column must be titled exactly `label` (and be the column the portal reads that field from).
// `roles`, when set, limits an action to those roles on top of edit access to its module.
const SH = require('../../public/shared');
const { matchLeadCols, matchListingCols, labelsOf } = require('./monday');

const MANAGERS = Object.freeze(['Manager']);
const ACTIONS = Object.freeze({
  // Inventory Dashboard: the listing's Availability select (anyone with Inventory edit access)
  // `current` names the record field holding Monday's own text for the column (status labels, the Budget number as
  // typed), so "what Monday has now" is never a normalised portal value
  listingAvailability: { label: 'Availability', board: 'listings', field: 'status', types: ['status', 'color'], kind: 'status', current: 'availabilityLabel', module: 'invdash',
    warn: 'Changing Availability may trigger automations set up on the Monday Listings board.' },
  // Lead details (Monday leads): fields whose portal value and Monday column match one to one; Managers only for now
  leadBudget: { label: 'Budget', board: 'leads', field: 'budget', types: ['numbers', 'text'], kind: 'number', current: 'budgetText', module: 'leads', roles: MANAGERS },
  leadMoveIn: { label: 'Target Move-in Date', board: 'leads', field: 'moveIn', types: ['date'], kind: 'date', module: 'leads', roles: MANAGERS },
  leadInquiry: { label: 'Inquiry Type', board: 'leads', field: 'inquiry', types: ['status', 'color'], kind: 'status', current: 'inquiryLabel', module: 'leads', roles: MANAGERS },
  leadNationality: { label: 'Nationality', board: 'leads', field: 'nationality', types: ['text'], kind: 'text', max: 60, module: 'leads', roles: MANAGERS },
});
const mayUse = (user, a) => SH.access(user, a.module) === 'edit' && (!a.roles || a.roles.includes(user.role));

/**
 * Limits on Monday update attempts, in this process's memory: `perUser` per user and 3 × `perUser` for the whole
 * server, per rolling minute. take(userId) → 0 when allowed (and counted), else the seconds to wait.
 */
function createWriteLimiter(perUser, { now = Date.now, windowMs = 60e3 } = {}) {
  const byUser = new Map(); let all = [];
  return function take(userId) {
    const t = now(), k = String(userId), recent = (xs) => xs.filter((x) => t - x < windowMs);
    all = recent(all);
    const mine = recent(byUser.get(k) || []);
    const full = mine.length >= perUser ? mine : all.length >= perUser * 3 ? all : null;
    if (full) { byUser.set(k, mine); return Math.max(1, Math.ceil((full[0] + windowMs - t) / 1000)); }
    mine.push(t); all.push(t); byUser.set(k, mine);
    return 0;
  };
}

const fail = (msg, status, extra) => Object.assign(new Error(msg), { httpStatus: status, ...(extra || {}) });

/** The Monday column for an action on the board as it is now: { id, title, type, labels } or an error. */
async function resolveColumn(monday, a, boardCache) {
  const cols = boardCache ? (boardCache[a.board] = boardCache[a.board] || monday.boardColumns(a.board)) : monday.boardColumns(a.board);
  return pick(await cols, a);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function pick(cols, a) {
  // exactly one column titled `label`, and it is the column the portal reads the field from (so "current value" is right)
  const named = cols.filter((c) => norm(c.title) === norm(a.label));
  const id = (a.board === 'leads' ? matchLeadCols(cols) : matchListingCols(cols))[a.field];
  if (!named.length) throw fail(`The Monday ${a.board} board has no "${a.label}" column.`, 409);
  if (named.length > 1) throw fail(`The Monday ${a.board} board has more than one "${a.label}" column; nothing is written until there is one.`, 409);
  const col = named[0];
  if (col.id !== id) throw fail(`The portal reads ${a.label} from a different Monday column than "${col.title}"; nothing is written until they match.`, 409);
  if (!a.types.includes(col.type)) throw fail(`The Monday "${col.title}" column is a ${col.type} column, not the expected kind; nothing was changed.`, 409);
  return { id: col.id, title: col.title, type: col.type, labels: a.kind === 'status' ? labelsOf(col) : [] };
}

/** The value Monday will receive, or an error. Never empty. */
function checkValue(a, col, raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw fail(a.label + ': invalid value.', 400);
  const v = String(raw).trim();
  if (!v) throw fail(a.label + ': a value is required (the portal never clears Monday values).', 400);
  if (a.kind === 'status') { if (!col.labels.includes(v)) throw fail(`${a.label}: "${v}" is not one of the board's labels.`, 400); return v; }
  if (a.kind === 'number') { if (!/^\d{1,10}(\.\d{1,2})?$/.test(v) || !(Number(v) > 0)) throw fail(a.label + ' must be a positive number.', 400); return String(Number(v)); }
  if (a.kind === 'date') { if (!SH.isYmd(v)) throw fail(a.label + ' must be a date (YYYY-MM-DD).', 400); return v; }
  if (a.kind === 'text') { if (v.length > a.max || /[\u0000-\u001f]/.test(v)) throw fail(`${a.label}: one line, ${a.max} characters at most.`, 400); return v; }
  throw fail('Unknown value kind.', 400);
}

/** What Monday holds now for that field, from a record (to ask before overwriting). '' when empty. */
function currentValue(a, rec) {
  return rec ? String(rec[a.current || a.field] || '').trim() : '';
}
/** A Monday error for the audit, without a free-text, number or date value it may echo back. */
function auditError(a, value, err) {
  const m = String((err && err.message) || err);
  return (a.kind === 'status' ? m : [value, JSON.stringify(value).slice(1, -1)].reduce((s, x) => s.split(x).join('[value]'), m)).slice(0, 200);
}

/**
 * One allowlisted update for the signed-in user. Checks, in order: writes switched on, known action, module access
 * (edit) and role, rate limit, the record exists and is visible to this user, the column is the expected one, the value
 * is allowed; then reads the item's current value from Monday itself and refuses if it isn't what the page showed
 * (`expect`), or if it would be overwritten without an explicit confirm. The attempt is logged before it is sent.
 * `audit` is { start(entry) → id, finish(id, fields) }.
 */
async function performWrite({ integ, user, body, audit }) {
  const { monday } = integ;
  if (!monday) throw fail('Monday.com is not connected.', 409);
  if (!monday.writesEnabled) throw fail('Monday updates are switched off on this server. Ask the owner to set MONDAY_WRITES=on.', 409, { writesOff: true });
  const keys = Object.keys(body || {});
  if (!body || typeof body !== 'object' || keys.some((k) => !['action', 'itemId', 'value', 'confirm', 'expect'].includes(k))) throw fail('Invalid request.', 400);
  if (body.expect !== undefined && typeof body.expect !== 'string') throw fail('Invalid request.', 400);
  const def = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!def) throw fail('This change is not on the allowed list.', 400);
  const a = { ...def, key: body.action };
  if (SH.access(user, a.module) !== 'edit') throw fail(`You don't have edit access to ${a.module === 'invdash' ? 'the Inventory Dashboard' : 'Leads'}.`, 403);
  if (!mayUse(user, a)) throw fail(`Only ${a.roles.join(' or ')}s can update ${a.label} on Monday.`, 403);
  const itemId = String(body.itemId || '');
  if (!/^\d{1,20}$/.test(itemId)) throw fail('Not found.', 404);
  // counted before anything is read from or sent to Monday
  const wait = integ.writeLimit ? integ.writeLimit(user._id) : 0;
  if (wait) throw fail(`Too many Monday updates in a short time. Nothing was changed; try again in ${wait} s.`, 429, { retryAfter: wait });
  const rec = a.board === 'leads' ? await integ.visibleMondayLead(user, itemId) : await integ.mondayListing(itemId);
  if (!rec) throw fail('Not found.', 404);
  const col = await resolveColumn(monday, a);
  const value = checkValue(a, col, body.value);
  // what Monday holds right now (a one-item read), not the server's copy, decides whether this overwrites a value
  let live;
  try { live = await monday.refreshItem(a.board, itemId, { remember: false }); } catch (e) { throw fail('Could not read the current value from Monday.com, so nothing was changed.' + (e.integration ? ' ' + e.message : ''), 502); }
  if (!live) throw fail('Not found.', 404);
  const before = currentValue(a, live);
  // the server's copy is brought up to date too, so the page shows Monday's value right away
  const remember = () => monday.refreshItem(a.board, itemId).catch(() => null);
  if (before === value) return { unchanged: true, record: (await remember()) || live, action: a, col };
  if (body.expect !== undefined && body.expect.trim() !== before) throw fail(`${a.label} on Monday has changed since this page loaded. Nothing was changed; the page now shows Monday's current value.`, 409, { stale: true, record: (await remember()) || live });
  if (before && body.confirm !== true) throw fail(`This replaces ${a.label} on Monday.${a.warn ? ' ' + a.warn : ''} Confirm to continue.`, 409, { needsConfirm: true });
  const entry = { action: a.key, board: a.board, itemId, column: col.title.slice(0, 80), by: { name: user.name, userId: user._id },
    // labels are board options, not personal data; free-text, number and date values are not stored in the audit
    ...(a.kind === 'status' ? { from: before.slice(0, 60), to: value.slice(0, 60) } : {}) };
  // logged first ("not confirmed yet"): a change that can't be logged is not sent
  let auditId;
  try { auditId = await audit.start(entry); } catch (e) { throw fail('The change could not be logged in the portal, so it was not sent to Monday.com.', 503); }
  // once Monday has answered, a logging problem must not turn the answer into a different one
  const finish = async (fields) => { try { await audit.finish(auditId, fields); } catch (e) { console.error('[monday-write] audit entry not updated:', e.name); } };
  try {
    await monday.writeColumn({ board: a.board, itemId, columnId: col.id, value });
  } catch (err) {
    if (!err.uncertain) { await finish({ ok: false, error: auditError(a, value, err) }); throw err; }
    // a timeout or server error: Monday itself says whether it was saved
    let check = null;
    try { check = await monday.refreshItem(a.board, itemId, { remember: false }); } catch (e) { /* still unknown */ }
    if (!check) { await finish({ ok: false, error: 'Outcome unknown: ' + auditError(a, value, err) }); throw fail(`Monday.com didn't answer clearly, so it may or may not have saved ${a.label}. Reload the lead to check before trying again.`, 502, { uncertain: true }); }
    if (currentValue(a, check) !== value) { await finish({ ok: false, error: auditError(a, value, err) }); throw fail(`Monday.com did not save ${a.label} (checked again just now). Nothing was changed.`, 502); }
    // it was saved after all
  }
  await finish({ ok: true, error: '' });
  let fresh = null;
  try { fresh = await monday.refreshItem(a.board, itemId); } catch (e) { /* the write succeeded; the page reloads the item later */ }
  return { record: fresh || live, action: a, col, refreshed: !!fresh };
}

/** For the page: which actions exist, which this user may use, and the board's labels for the status ones. */
async function writeOptions(integ, user) {
  const { monday } = integ;
  if (!monday || !monday.writesEnabled) return { enabled: false, actions: {} };
  const out = {}, boards = {};   // each board's columns are read once per call
  for (const [key, def] of Object.entries(ACTIONS)) {
    let allowed = mayUse(user, def), labels = [], error = '';
    // an action is offered only when its column exists on the board with the expected kind
    if (allowed) { try { labels = (await resolveColumn(monday, def, boards)).labels; } catch (e) { allowed = false; error = e.message; } }
    out[key] = { label: def.label, board: def.board, field: def.field, kind: def.kind, allowed, labels, ...(def.warn ? { warn: def.warn } : {}), ...(error ? { error } : {}) };
  }
  return { enabled: true, actions: out };
}

module.exports = { ACTIONS, performWrite, writeOptions, checkValue, createWriteLimiter, pickColumn: pick };
