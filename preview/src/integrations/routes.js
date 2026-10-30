'use strict';
// Integration endpoints (MongoDB mode, signed in). All read only, except POST /monday/write: the allowlisted,
// confirmed Monday updates in mondayWrite.js (off unless MONDAY_WRITES=on). The POST connection test only reads.
// Lead visibility rules are the same as for MongoDB records.
const SH = require('../../public/shared');
const { need, findVisibleLead, scopeExternal, brokerLabelOf } = require('../access');
const { createStatus } = require('./status');
const { createMonday } = require('./monday');
const { createRespond } = require('./respondio');
const { computeLead, replyState } = require('./pipeline');
const { LeadOverride, MondayWrite } = require('../models');
const { performWrite, writeOptions, createWriteLimiter } = require('./mondayWrite');
const { mondayResults, feedbackColumnCheck } = require('./viewingResult');

/** One set of clients + status per server (shared by the integration routes and Team & Access). */
function createIntegrations(config) {
  const ic = config.integrations;
  const mondayMissing = [!ic.monday.token && 'MONDAY_TOKEN', !Object.values(ic.monday.boards).some(Boolean) && 'MONDAY_LEADS_BOARD_ID'].filter(Boolean);
  const status = {
    monday: createStatus(!mondayMissing.length, mondayMissing, [ic.monday.token]),
    respond: createStatus(!!ic.respond.token, ic.respond.token ? [] : ['RESPOND_TOKEN'], [ic.respond.token]),
  };
  const monday = mondayMissing.length ? null : createMonday(ic.monday, status.monday);
  const respond = ic.respond.token ? createRespond(ic.respond, status.respond) : null;
  const leadsBoard = !!ic.monday.boards.leads;

  /** VA Assigned / Salesperson labels: from the Monday board when connected, else the preview's fictional lists. */
  async function teamLabels() {
    if (!monday || !leadsBoard) return { source: 'preview', va: SH.LISTS.vas, salesperson: SH.LISTS.brokers };
    const all = await monday.loadAll(false);
    if (all.errors.leads || !all.labels) return { source: 'error', error: all.errors.leads || 'Leads board not loaded.', va: [], salesperson: [] };
    // Salesperson: the Leads board's labels plus the Calendar board's (viewings are matched on the Calendar's)
    const salesperson = [...new Set(all.labels.salesperson.concat(all.calendarSalesperson || []))];
    return { source: 'monday', va: all.labels.va, salesperson, vaColumn: all.labels.vaColumn, salespersonColumn: all.labels.salespersonColumn };
  }
  /** VA labels a team member may be given: the Monday board's labels when connected (the preview list only without Monday). */
  async function allowedVaLabels() {
    const t = await teamLabels().catch(() => ({ va: [] }));
    return t.va || [];
  }
  /** Exact Salesperson labels a Broker may be given; null when Monday is connected but its labels can't be read. */
  async function allowedSalesLabels() {
    const t = await teamLabels().catch(() => ({ source: 'error' }));
    return t.source === 'error' ? null : t.salesperson;
  }
  const rsFor = (l) => (respond ? respond.cachedState(String(l.contactId || '').replace(/\D/g, '')) : null);
  /**
   * Adds AI Status / Temperature / reply state / Days in Stage (pipeline.js) to Monday leads, then any portal override
   * (MongoDB, e.g. "Failed"), which is labelled as an override and never written back to Monday.
   */
  function enrich(all, leads, overrides) {
    const now = Date.now();
    return leads.map((l) => {
      const h = rsFor(l), out = { ...l, ...computeLead(l, all.lm[l.id], h && h.st, now, h && h.error) };
      // read, but nothing to go on: an empty chat, or no such contact on respond.io; checked all the same (not "unchecked")
      // (no reply state is invented: waiting stays empty; a missing contact is what respond.io said, so Temperature says so too)
      if (h && !h.st && !h.error) Object.assign(out, h.missing && out.temp === 'Unchecked' ? { replyChecked: true, temp: 'Not on Respond.io', tempWhy: 'respond.io has no contact with this Respond ID.' }
        : { replyChecked: true, ...(out.temp === 'Unchecked' ? { tempWhy: 'No messages in the respond.io chat yet.' } : {}) });
      return SH.applyOverride(out, overrides && overrides.get(l.id));
    });
  }
  /** Portal overrides for Monday leads, by lead ID. */
  async function mondayOverrides() {
    const rows = await LeadOverride.find({ source: 'monday', failed: { $ne: null } }).limit(20000).lean();
    return new Map(rows.map((o) => [o.leadId, o]));
  }
  /** A Monday lead (and its listings) this user may see, or null. Throws when the leads board can't be read. */
  async function visibleMondayLead(user, id) {
    if (!monday || !/^\d{1,20}$/.test(String(id))) return null;
    const all = await monday.loadAll(false);
    if (all.errors.leads) { const e = new Error(all.errors.leads); e.integration = 'monday'; throw e; }
    return scopeExternal(user, all).leads.find((l) => l.id === id) || null;
  }
  async function mondayListing(id) {
    if (!monday) return null;
    const all = await monday.loadAll(false);
    return all.listings.find((x) => x.id === String(id)) || null;
  }
  // rate limit for allowlisted Monday updates (MONDAY_WRITE_LIMIT per user per minute)
  const writeLimit = monday && monday.writesEnabled ? createWriteLimiter(ic.monday.writeLimit) : null;
  return { status, monday, respond, ic, teamLabels, allowedVaLabels, allowedSalesLabels, enrich, mondayOverrides, visibleMondayLead, mondayListing, statusFields, writeLimit };
}

const STATUS_FIELDS = ['ai', 'aiSub', 'aiSource', 'workStage', 'temp', 'tempWhy', 'waiting', 'since', 'lastText', 'replyChecked', 'replyError', 'onRespond', 'daysInStage', 'stageDays', 'override'];
function statusFields(l) { return Object.fromEntries(STATUS_FIELDS.map((k) => [k, l[k]])); }

function integrationRoutes(r, integ) {
  const { status, monday, respond, ic } = integ;
  const notConnected = (res, name, vars) => res.status(409).json({ error: `${name} is not connected. Set ${vars.join(' and ')} in preview/.env and restart.`, notConnected: true });
  const failed = (res, err) => {
    if (!err.integration) throw err;
    res.status(err.httpStatus || 502).json({ error: err.message, integration: err.integration });
  };

  r.get('/integrations/status', (req, res) => res.json({
    readOnly: !(monday && monday.writesEnabled), mondayWrites: !!(monday && monday.writesEnabled),
    // whether a Calendar column also receives broker feedback (MONDAY_CALENDAR_FEEDBACK_COLUMN); the id is not sent
    calendarFeedbackColumn: !!(monday && ic.monday.calFeedbackColumn),
    monday: { ...status.monday.snapshot(), boards: Object.fromEntries(Object.entries(ic.monday.boards).map(([k, v]) => [k, !!v])) },
    respond: { ...status.respond.snapshot(), inboxLinks: !!ic.respond.spaceId, listChecks: ic.respond.listChecks },
  }));

  r.post('/integrations/monday/test', need('team', 'edit'), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    try {
      const out = await monday.test();
      // the optional broker-feedback column, checked the same way a save checks it (read-only; never created)
      if (ic.monday.calFeedbackColumn && ic.monday.boards.calendar) out.calendarFeedback = feedbackColumnCheck(await monday.boardColumns('calendar'), ic.monday.calFeedbackColumn);
      res.json(out);
    } catch (err) { failed(res, err); }
  });

  r.get('/monday/bootstrap', need('leads', 'view'), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    const all = await monday.loadAll(req.query.refresh === '1');
    const scoped = scopeExternal(req.user, { leads: integ.enrich(all, all.leads, await integ.mondayOverrides()), viewings: all.viewings, listings: all.listings });
    // results saved for Calendar-board viewings (broker feedback is kept in the portal unless a Monday column is configured)
    const results = await mondayResults(scoped.viewings.map((v) => v.id));
    scoped.viewings = scoped.viewings.map((v) => { const r = results.get(v.id); return r ? { ...v, feedback: r.feedback, result: r } : v; });
    const b = brokerLabelOf(req.user);
    res.json({ ...scoped, ...(req.user.role === 'Broker' && b.notice ? { scopeNotice: b.notice } : {}), errors: all.errors, notConfigured: all.notConfigured, calendarOk: all.calendarOk,
      fetchedAt: all.fetchedAt, boards: all.boards, refreshing: all.refreshing, staleAfterMs: all.staleAfterMs });
  });

  /**
   * Calendar-board deals / leases (amounts, dates, statuses; no client names) for Leads Report, Renewals, P&L and Broker
   * Management. Read only. Managers: every row; others: rows of clients they can see (brokers also their own label).
   */
  const DEAL_SCREENS = ['ldash', 'pl', 'brokers', 'renewals'];
  r.get('/monday/deals', (req, res, next) => (DEAL_SCREENS.some((m) => SH.access(req.user, m) !== 'none') ? next() : res.status(403).json({ error: 'You don\'t have access to these reports.' })), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    const all = await monday.loadAll(false);
    if (all.errors.viewings) return res.status(502).json({ error: 'The Monday Calendar board could not be read: ' + all.errors.viewings });
    let deals = all.deals || [];
    if (req.user.role !== 'Manager') {
      const ids = new Set(scopeExternal(req.user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads.map((l) => l.id));
      const label = req.user.role === 'Broker' ? brokerLabelOf(req.user).label : '';
      deals = deals.filter((d) => ids.has(d.leadId) || (label && d.sp === label));
    }
    res.json({ deals, fetchedAt: all.fetchedAt });
  });

  // how old each board's in-memory copy is and whether a refresh is running or failed (no Monday data in the reply)
  r.get('/monday/freshness', need('leads', 'view'), (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    res.json(monday.freshness());
  });

  const visibleMondayLead = integ.visibleMondayLead;

  r.get('/monday/leads/:id/notes', need('leads', 'view'), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    try {
      if (!(await visibleMondayLead(req.user, req.params.id))) return res.status(404).json({ error: 'Lead not found.' });
      res.json({ notes: await monday.notes(req.params.id) });
    } catch (err) { failed(res, err); }
  });

  // listing photos, proxied so the page only loads same-origin images and never sees Monday file links
  r.get('/monday/photo/:assetId', async (req, res) => {
    if (!['leads', 'invdash', 'calendar'].some((m) => SH.access(req.user, m) !== 'none')) return res.status(403).json({ error: 'No access to listings.' });
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    if (!/^\d{1,20}$/.test(req.params.assetId)) return res.status(404).json({ error: 'Photo not found.' });
    try {
      const p = await monday.photo(req.params.assetId, req.query.thumb === '1');
      if (!p) return res.status(404).json({ error: 'Photo not found.' });
      res.set({ 'Content-Type': p.type, 'Cache-Control': 'private, max-age=1800', 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.send(p.body);
    } catch (err) { failed(res, err); }
  });

  // Needs VA Reply / Waiting on Client for visible Monday leads, checked in bounded batches (call again while pending > 0)
  r.get('/respond/reply-states', need('leads', 'view'), async (req, res) => {
    if (!respond) return notConnected(res, 'respond.io', ['RESPOND_TOKEN']);
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    if (!ic.respond.listChecks) return res.status(409).json({ error: 'List-wide respond.io checks are switched off. Open a lead\'s Chat tab to check that lead.', listChecksOff: true });
    try {
      const all = await monday.loadAll(false);
      if (all.errors.leads) return res.status(502).json({ error: all.errors.leads, integration: 'monday' });
      const visible = scopeExternal(req.user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads;
      const cids = visible.map((l) => String(l.contactId || '').replace(/\D/g, '')).filter(Boolean);
      const run = await respond.replyStates(cids, { compute: replyState });
      const enriched = integ.enrich(all, visible, await integ.mondayOverrides());
      res.json({ leads: Object.fromEntries(enriched.map((l) => [l.id, statusFields(l)])),
        checked: run.checked, pending: run.pending, errors: run.errors, retryAfterMs: run.retryAfterMs || 0, linked: cids.length, checkedAt: new Date().toISOString() });
    } catch (err) { failed(res, err); }
  });

  // "Message Lead" / "Call on respond.io": the address of this lead's conversation in respond.io, for a lead the user can
  // see. Nothing is read from or sent to respond.io (no token needed); the contact ID comes from the lead, never the
  // request; no other contact is ever used instead. A call is started by a person, inside respond.io.
  r.get('/respond/link/:source/:id', need('leads', 'view'), async (req, res) => {
    let lead = null;
    try {
      if (req.params.source === 'mongo') lead = await findVisibleLead(req.user, req.params.id);
      else if (req.params.source === 'monday' && monday) lead = await visibleMondayLead(req.user, req.params.id);
    } catch (err) { return failed(res, err); }
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const raw = String(lead.contactId || '').trim(), phone = String(lead.phone || '').replace(/[^\d+]/g, '');
    const tel = /^\+?\d{7,15}$/.test(phone) ? phone : '';
    if (lead.contactIdInvalid || (raw && !/^\d{1,20}$/.test(raw))) return res.status(422).json({ error: 'The Respond ID on Monday for this lead isn\'t a single number, so the portal won\'t guess which contact it is. Fix it on the Monday board.', problem: 'badContact', tel });
    if (!raw) return res.status(404).json({ error: 'This lead has no respond.io contact ID (the Respond ID column on Monday). Add it there; the portal doesn\'t create or look up contacts.', problem: 'noContact', tel });
    if (!ic.respond.spaceId) return res.status(409).json({ error: ic.respond.spaceIdInvalid ? 'RESPOND_SPACE_ID on the server isn\'t a number. Set it to the number in your respond.io address (app.respond.io/space/<number>/…).' : 'Links into respond.io need RESPOND_SPACE_ID on the server: the number in your respond.io address (app.respond.io/space/<number>/…).', problem: 'noSpace', tel });
    res.json({ url: `https://app.respond.io/space/${ic.respond.spaceId}/inbox/${raw}`, name: lead.name || '', tel });
  });

  // chat history for a lead the user can see; the contact ID always comes from the lead, never from the request
  r.get('/respond/chat/:source/:id', need('leads', 'view'), async (req, res) => {
    if (!respond) return notConnected(res, 'respond.io', ['RESPOND_TOKEN']);
    try {
      let lead = null;
      if (req.params.source === 'mongo') lead = await findVisibleLead(req.user, req.params.id);
      else if (req.params.source === 'monday' && monday) lead = await visibleMondayLead(req.user, req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });
      const cid = String(lead.contactId || '').replace(/\D/g, '');
      if (!cid) return res.status(404).json({ error: 'This lead has no respond.io contact ID (Respond ID).', noContact: true });
      const chat = await respond.chat(cid);
      if (req.params.source !== 'monday') return res.json(chat);
      // the chat just read also gives this one lead its reply state and Temperature (newest 15, as the original used)
      respond.remember(cid, chat.messages.length ? replyState(chat.messages.slice(-15), Date.now()) : null);
      const all = await monday.loadAll(false);
      res.json({ ...chat, lead: statusFields(integ.enrich(all, [lead], await integ.mondayOverrides())[0]) });
    } catch (err) { failed(res, err); }
  });

  // ----- allowlisted Monday updates (mondayWrite.js); off unless MONDAY_WRITES=on -----
  // which updates this user may make, and the board's own labels for the status ones (no client data)
  r.get('/monday/write-options', async (req, res) => {
    try { res.json(await writeOptions(integ, req.user)); } catch (err) { failed(res, err); }
  });
  // one explicit change by the signed-in user; the reply says plainly whether Monday accepted it (never a MongoDB fallback)
  const audit = {
    start: async (e) => (await MondayWrite.create({ ...e, ok: false, error: 'Not confirmed by Monday.com yet.' }))._id,
    finish: (id, fields) => MondayWrite.updateOne({ _id: id }, { $set: fields }),
  };
  r.post('/monday/write', async (req, res) => {
    try {
      const out = await performWrite({ integ, user: req.user, body: req.body, audit });
      // the change is done at this point: adding AI Status etc. must not turn the reply into an error
      let rec = out.record;
      if (rec && out.action.board === 'leads') { try { rec = integ.enrich(await monday.loadAll(false), [rec], await integ.mondayOverrides())[0]; } catch (e) { /* shown as read */ } }
      res.json({ ok: true, unchanged: !!out.unchanged, action: out.action.key, column: out.col.title, board: out.action.board, record: rec, refreshed: !!out.refreshed });
    } catch (err) {
      const code = err.httpStatus || (err.integration ? 502 : 500);
      if (code === 500 && !err.integration) throw err;
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      // stale: Monday's current record, so the page shows it at once (leads get their AI Status etc. as usual)
      let rec = err.stale && err.record ? err.record : null;
      if (rec && rec.board !== 'listings' && integ.enrich && /^lead/.test(String((req.body || {}).action))) { try { rec = integ.enrich(await monday.loadAll(false), [rec], await integ.mondayOverrides())[0]; } catch (e) { /* shown as read */ } }
      res.status(code).json({ error: err.message, ...(err.needsConfirm ? { needsConfirm: true } : {}), ...(err.writesOff ? { writesOff: true } : {}), ...(err.stale ? { stale: true } : {}), ...(rec ? { record: rec } : {}), ...(err.uncertain ? { uncertain: true } : {}), ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) });
    }
  });

  // labels for Settings → Team & Access (VA Assigned / Salesperson values on the Monday board)
  r.get('/team/labels', need('team', 'view'), async (req, res) => res.json(await integ.teamLabels()));
}

module.exports = { integrationRoutes, createIntegrations };
