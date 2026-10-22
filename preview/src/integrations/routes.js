'use strict';
// Read-only integration endpoints (MongoDB mode, signed in). Every route is GET except the Manager-only
// connection test, which itself only reads. Lead visibility rules are the same as for MongoDB records.
const SH = require('../../public/shared');
const { need, findVisibleLead, scopeExternal } = require('../access');
const { createStatus } = require('./status');
const { createMonday } = require('./monday');
const { createRespond } = require('./respondio');
const { computeLead, replyState } = require('./pipeline');

/** One set of clients + status per server (shared by the integration routes and Team & Access). */
function createIntegrations(config) {
  const ic = config.integrations;
  const mondayMissing = [!ic.monday.token && 'MONDAY_TOKEN', !Object.values(ic.monday.boards).some(Boolean) && 'MONDAY_LEADS_BOARD_ID'].filter(Boolean);
  const status = {
    monday: createStatus(!mondayMissing.length, mondayMissing),
    respond: createStatus(!!ic.respond.token, ic.respond.token ? [] : ['RESPOND_TOKEN']),
  };
  const monday = mondayMissing.length ? null : createMonday(ic.monday, status.monday);
  const respond = ic.respond.token ? createRespond(ic.respond, status.respond) : null;
  const leadsBoard = !!ic.monday.boards.leads;

  /** VA Assigned / Salesperson labels: from the Monday board when connected, else the preview's fictional lists. */
  async function teamLabels() {
    if (!monday || !leadsBoard) return { source: 'preview', va: SH.LISTS.vas, salesperson: SH.LISTS.brokers };
    const all = await monday.loadAll(false);
    if (all.errors.leads || !all.labels) return { source: 'error', error: all.errors.leads || 'Leads board not loaded.', va: [], salesperson: [] };
    return { source: 'monday', va: all.labels.va, salesperson: all.labels.salesperson, vaColumn: all.labels.vaColumn, salespersonColumn: all.labels.salespersonColumn };
  }
  /** VA labels a team member may be given (preview list plus the Monday board's labels when available). */
  async function allowedVaLabels() {
    const t = await teamLabels().catch(() => ({ va: [] }));
    return [...new Set(SH.LISTS.vas.concat(t.va || []))];
  }
  const rsFor = (l) => { if (!respond) return null; const h = respond.cachedState(String(l.contactId || '').replace(/\D/g, '')); return h ? h.st : null; };
  /** Adds AI Status / Temperature / reply state / Days in Stage (pipeline.js) to Monday leads. */
  function enrich(all, leads) {
    const now = Date.now();
    return leads.map((l) => ({ ...l, ...computeLead(l, all.lm[l.id], rsFor(l), now) }));
  }
  return { status, monday, respond, ic, teamLabels, allowedVaLabels, enrich };
}

function integrationRoutes(r, integ) {
  const { status, monday, respond, ic } = integ;
  const notConnected = (res, name, vars) => res.status(409).json({ error: `${name} is not connected. Set ${vars.join(' and ')} in preview/.env and restart.`, notConnected: true });
  const failed = (res, err) => {
    if (!err.integration) throw err;
    res.status(err.httpStatus || 502).json({ error: err.message, integration: err.integration });
  };

  r.get('/integrations/status', (req, res) => res.json({
    readOnly: true,
    monday: { ...status.monday.snapshot(), boards: Object.fromEntries(Object.entries(ic.monday.boards).map(([k, v]) => [k, !!v])) },
    respond: { ...status.respond.snapshot(), inboxLinks: !!ic.respond.spaceId },
  }));

  r.post('/integrations/monday/test', need('team', 'edit'), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    try { res.json(await monday.test()); } catch (err) { failed(res, err); }
  });

  r.get('/monday/bootstrap', need('leads', 'view'), async (req, res) => {
    if (!monday) return notConnected(res, 'Monday.com', status.monday.snapshot().missing);
    const all = await monday.loadAll(req.query.refresh === '1');
    const scoped = scopeExternal(req.user, { leads: integ.enrich(all, all.leads), viewings: all.viewings, listings: all.listings });
    res.json({ ...scoped, errors: all.errors, notConfigured: all.notConfigured, calendarOk: all.calendarOk, fetchedAt: all.fetchedAt });
  });

  async function visibleMondayLead(user, id) {
    if (!/^\d{1,20}$/.test(String(id))) return null;
    const all = await monday.loadAll(false);
    if (all.errors.leads) { const e = new Error(all.errors.leads); e.integration = 'monday'; throw e; }
    return scopeExternal(user, all).leads.find((l) => l.id === id) || null;
  }

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
    try {
      const all = await monday.loadAll(false);
      if (all.errors.leads) return res.status(502).json({ error: all.errors.leads, integration: 'monday' });
      const visible = scopeExternal(req.user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads;
      const cids = visible.map((l) => String(l.contactId || '').replace(/\D/g, '')).filter(Boolean);
      const run = await respond.replyStates(cids, { compute: replyState });
      const enriched = integ.enrich(all, visible), pick = ['ai', 'aiSub', 'aiSource', 'temp', 'tempWhy', 'waiting', 'since', 'lastText', 'replyChecked', 'onRespond', 'daysInStage', 'stageDays'];
      res.json({ leads: Object.fromEntries(enriched.map((l) => [l.id, Object.fromEntries(pick.map((k) => [k, l[k]]))])),
        checked: run.checked, pending: run.pending, errors: run.errors, linked: cids.length, checkedAt: new Date().toISOString() });
    } catch (err) { failed(res, err); }
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
      res.json(await respond.chat(cid));
    } catch (err) { failed(res, err); }
  });

  // labels for Settings → Team & Access (VA Assigned / Salesperson values on the Monday board)
  r.get('/team/labels', need('team', 'view'), async (req, res) => res.json(await integ.teamLabels()));
}

module.exports = { integrationRoutes, createIntegrations };
