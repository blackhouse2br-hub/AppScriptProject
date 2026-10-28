/*
 * Blackhouse Leads Portal: local preview.
 * Labels, stages and screen layout follow the original src/Index.html.
 * Two explicit modes, chosen by the server (window.BH_CONFIG.mode):
 *   demo  - fictional data, edits kept in this browser's localStorage, no network requests (CSP connect-src 'none')
 *   mongo - records come from the local Express API + MongoDB after signing in (api-client.js)
 */
(function () {
  'use strict';
  const SH = window.BH_SHARED, { LISTS } = SH, { generate, ymd } = window.BH_DEMO, API = window.BH_API;
  const DEMO = !(window.BH_CONFIG && window.BH_CONFIG.mode === 'mongo');
  const GOOGLE = !DEMO && window.BH_CONFIG.auth === 'google';   // hosted portal: Google sign-in, no passwords
  const where = () => (DEMO ? 'in this browser (demo)' : 'in MongoDB');
  const SRC = DEMO ? 'demo data' : 'MongoDB';
  const STORE = 'bh_preview_demo_v1', PREF = 'bh_preview_prefs_v1';

  // ---------- constants copied from the original Index.html ----------
  const AI_STAGES = ['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection', 'Active', 'For Renewal', 'Failed', 'Not on Respond.io'];
  const AI_COLORS = { 'Property Matching': '#2f81f7', 'Scheduling': '#bf8700', 'LOI': '#8250df', 'Contract': '#0969da', 'Collection': '#e36209', 'Active': '#1a7f37', 'For Renewal': '#116329', 'Failed': '#6e7781', 'Not on Respond.io': '#57606a' };
  const TEMPS = SH.TEMPS;
  const TEMP_STYLE = { Hot: ['#ff6b6b', '🔥'], Warm: ['#f0883e', '☀️'], Cold: ['#58a6ff', '❄️'], Lost: ['#8b949e', '⌛'], Dead: ['#6e7681', '✝'], Active: ['#3fb950', '✓'], 'Not on Respond.io': ['#8b949e', '○'], Unchecked: ['#8b949e', '?'] };
  const DEAL_TABS = { loic: 'LOI (Client)', loio: 'LOI (Owner)', contract: 'Contract', collection: 'Collection', active: 'Active', renewal: 'For Renewal' };
  const VSTAT_COLORS = { Proposed: '#d29922', Confirmed: '#4c8dff', Done: '#3fb950', Cancelled: '#8b949e' };
  const LEAD_PLUS = ['LOI', 'Contract', 'Collection', 'Active', 'For Renewal'];
  const P = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${d}</svg>`;
  const VIEWS = [
    ['leads', 'Leads', P('<path d="M4 6h16M4 12h16M4 18h10"/>')],
    ['vaportal', 'VA Portal', P('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>')],
    ['monitor', 'VA Management', P('<path d="M3 12h4l3 8 4-16 3 8h4"/>')],
    ['calendar', 'Calendar', P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')],
    ['invdash', 'Inventory Dashboard', P('<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>')],
    ['ldash', 'Leads Report', P('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>')],
    ['brokers', 'Broker Management', P('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>')],
    ['renewals', 'Renewals', P('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>')],
    ['upsell', 'Upselling', P('<path d="M3 11l18-8-8 18-2-8-8-2z"/>')],
    ['daily', 'Daily Report', P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>')],
    ['propreq', 'Property Requirements', P('<path d="M3 21h18M6 21V10l6-5 6 5v11"/><circle cx="17" cy="16" r="3"/><path d="m21 20-1.8-1.8"/>')],
    ['clientreq', 'Client Requirements', P('<circle cx="8" cy="7" r="3"/><path d="M3 20a5 5 0 0 1 10 0M15 8h6M15 12h6M15 16h4"/>')],
    ['services', 'Service Requests', P('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>')],
    ['pages', 'Project Pages', P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>')],
    ['pl', 'P&L', P('<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>')],
    ['team', 'Settings', P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>')],
  ];
  const VIEW_LABEL = Object.fromEntries(VIEWS.map((v) => [v[0], v[1]]));
  const TITLES = { leads: 'Blackhouse Leads', calendar: 'Viewing calendar' };
  // screens that exist in the original but are not rebuilt in this preview yet (descriptions from the original README)
  const LATER = {
    upsell: 'Concierge broadcasts to active clients, with images, sent through respond.io.',
    services: 'Supplier jobs and service requests detected from client chats.',
    pages: 'Developer project pages with a public inquiry form.',
    pl: 'Profit & loss, commissions collected/pending and the Data Check rules, read from the Monday Calendar board.',
  };
  const LATER_TAB = {
    approval: 'Owner-confirmed units waiting for the client, and the “send confirmed units” chat pop-up.',
    loic: 'LOI created from the Lease/Sale templates, sent for e-signature, and the signed copy returned.',
    loio: 'Owner side of the LOI.', contract: 'Contract stage, with the 5-day owner-signing rule.',
    collection: 'Payments and commission collection.', active: 'Active lease with lease-term tracking.', renewal: 'Leases coming up for renewal.',
  };

  // ---------- storage (all wrapped: storage can be blocked or full) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  // demo only: ?leads=3000 loads a larger fictional set to check list performance (not saved)
  const BIG = DEMO ? Math.min(10000, Math.max(0, parseInt(new URLSearchParams(location.search).get('leads'), 10) || 0)) : 0;
  function loadData() {
    if (BIG) return generate(new Date(), { leads: BIG });
    const raw = store.get(STORE);
    if (raw) { try { const d = JSON.parse(raw); if (d && d.version === 1 && Array.isArray(d.leads)) return d; } catch (e) { /* regenerate */ } }
    return generate(new Date());
  }
  const EMPTY = () => ({ leads: [], listings: [], calendar: [], users: [], templates: [] });
  let D = DEMO ? loadData() : EMPTY();
  let prefs = {}; try { prefs = JSON.parse(store.get(PREF) || '{}') || {}; } catch (e) { prefs = {}; }

  const S = {
    user: null,   // mongo mode: the signed-in user from the server session
    view: VIEW_LABEL[prefs.view] ? prefs.view : 'leads', as: prefs.as || 'manager@example.com', theme: prefs.theme === 'light' ? 'light' : 'dark',
    q: '', va: '', ai: [], temp: [], type: '', from: '', wait: '', sort: 'new', sortCol: '', sortDir: 'asc',
    list: null, limit: 150, open: null, tab: 'details', draft: {}, calMonth: null, calBroker: '', setTab: 'team',
    inv: { q: '', city: '', type: '', beds: '', avail: '' }, modal: null, returnFocus: null,
    // mongo mode: which records are shown (MongoDB, or live read-only Monday.com), integration status, chat cache
    // mongo mode: leads/listings/calendar come from Monday.com (read-only) by default; MongoDB only if chosen by hand in this browser
    source: SH.defaultSource(prefs.source), integ: null, srcErrors: {}, srcNotConfigured: [], srcFetchedAt: '', srcBoards: {}, srcLive: null, srcNewer: false, srcBusy: false, chat: {}, mTest: null,
    mongoRecords: null,
    srcToken: 0, rsInfo: null, teamLabels: null, teamLabelsBusy: false,
    ephemeral: !!BIG,
  };
  function persist() { if (DEMO && !S.ephemeral && !store.set(STORE, JSON.stringify(D))) toast('This browser blocked saving: changes last until you reload.', true); }
  // `source` is stored only when chosen by hand (Data source switch), so the default stays Monday.com
  function savePrefs() { store.set(PREF, JSON.stringify({ view: S.view, as: S.as, theme: S.theme, ...(prefs.source ? { source: prefs.source } : {}) })); }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const money = (n) => !n ? '' : '₱' + (n >= 1e6 ? (+(n / 1e6).toFixed(1)) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : n);
  const parseYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const fmtDate = (v) => { const d = typeof v === 'string' && v.length === 10 ? parseYmd(v) : v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };
  const fmtShort = (v) => { const d = parseYmd(v); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'; };
  const today = () => ymd(new Date());
  const daysUntil = (s) => { const d = parseYmd(s); if (!d) return null; const t = parseYmd(today()); return Math.round((d - t) / 864e5); };
  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000; if (!iso || isNaN(s)) return '—';
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 2600); }
  const pill = (text, color) => text ? `<span class="pill" style="--c:${color || '#8b949e'}">${color ? '<span class="dot" style="background:' + color + '"></span>' : ''}${esc(text)}</span>` : '<span class="muted">—</span>';
  // guess = stage inferred only from the status text (shown dotted, like the original's unconfirmed AI guesses)
  const aiPill = (l, guess) => pill(l.ai + (l.override ? ' · override' : ''), AI_COLORS[l.ai]).replace('class="pill"', `class="pill${guess ? ' guess' : ''}${l.override ? ' ovr' : ''}"`);
  const AI_SRC = { proof: 'Proof: Calendar board / Client Status', monday: 'Monday AI STATUS (last set by the live portal)', rules: 'Inferred from the Next Action / Status text',
    override: 'Portal override, saved in the portal only (not on Monday.com)' };
  const aiTip = (l) => [l.ai, l.aiSub, AI_SRC[l.aiSource]].filter(Boolean).join(' · ');
  const tempChip = (t) => t ? `<span class="tchip" style="--c:${TEMP_STYLE[t][0]}">${TEMP_STYLE[t][1]} ${esc(t)}</span>` : '<span class="muted">—</span>';
  const leadById = (id) => D.leads.find((l) => l.id === id);
  const listingById = (id) => D.listings.find((x) => x.id === id);
  // Leads Report rule from docs/data-points.xlsx: rent < ₱200k/month or sale < ₱20M is not counted; unknown budget is counted
  const countsInReports = (l) => !l.budget || (l.inquiry === 'Rent' ? l.budget >= 200000 : l.budget >= 20e6);

  // ---------- identity + permissions ----------
  // demo: "View as" picks a fictional user (a preview switch, not authentication).
  // mongo: the user comes from the server session, and the server has already limited the records to what they may see.
  const NOBODY = { name: '', email: '', role: '', vaLabel: '', modules: {} };
  function me() {
    if (!DEMO) return S.user || NOBODY;
    return D.users.find((u) => u.email === S.as) || D.users.find((u) => u.role === 'Manager') || D.users[0] || NOBODY;
  }
  const isManager = () => me().role === 'Manager';
  // screens that share another module's permission (same data, same people): no separate Team & Access setting
  const MOD_ALIAS = { clientreq: 'propreq' };
  const access = (mod) => SH.access(me(), MOD_ALIAS[mod] || mod);
  const canSee = (mod) => access(mod) !== 'none';
  // records read live from Monday.com are read-only in this phase, whatever the user's role
  const canEdit = (mod) => access(mod) === 'edit' && !(!DEMO && S.source === 'monday' && ['leads', 'calendar', 'invdash'].includes(mod));
  function visibleLeads() {
    const u = me();
    if (!DEMO || u.role === 'Manager') return D.leads;
    if (u.role === 'VA') return u.vaLabel ? D.leads.filter((l) => l.va === u.vaLabel) : [];
    const mine = new Set(D.calendar.filter((v) => v.broker === u.name).map((v) => v.leadId));
    return D.leads.filter((l) => l.salesperson === u.name || mine.has(l.id));
  }
  function visibleViewings() {
    const u = me();
    if (!DEMO || u.role === 'Manager') return D.calendar;
    if (u.role === 'Broker') return D.calendar.filter((v) => v.broker === u.name);
    const ids = new Set(visibleLeads().map((l) => l.id));
    return D.calendar.filter((v) => ids.has(v.leadId));
  }

  // ---------- lead filtering ----------
  const TEMP_RANK = { Hot: 0, Warm: 1, Cold: 2, Active: 3, Lost: 4, Dead: 5, 'Not on Respond.io': 6, Unchecked: 7 };
  const toggle = (arr, v) => { const i = arr.indexOf(v); if (i < 0) arr.push(v); else arr.splice(i, 1); };

  // ---------- shell ----------
  // The page frame is drawn once per view. Filter changes, saves and counters update only the parts that changed
  // (list rows, tiles, chips, sidebar), so large lists stay responsive and focus/scroll positions are kept.
  function render() {
    if (!canSee(S.view)) S.view = VIEWS.map((v) => v[0]).find(canSee) || 'leads';
    document.documentElement.dataset.theme = S.theme;
    $('#app').innerHTML = `<div class="shell"><div id="side">${sidebar()}</div><div class="side-scrim" data-act="navclose" aria-hidden="true"></div><main class="wrap" id="main">
      ${headerHtml()}<div id="modebar">${demoBar()}</div><div id="view">${viewHtml()}</div></main></div>`;
    afterView();
  }
  function afterView() { if (S.view === 'leads') refreshLeads(true); if (S.view === 'invdash') renderInventory(); }
  /** Redraws the current view and sidebar only (header and mode bar stay). */
  function renderView() { const y = window.scrollY; renderSide(); $('#view').innerHTML = viewHtml(); afterView(); window.scrollTo(0, y); }
  function renderSide() { const box = $('#side'); if (!box) return; const top = box.firstElementChild ? box.firstElementChild.scrollTop : 0; box.innerHTML = sidebar(); if (box.firstElementChild) box.firstElementChild.scrollTop = top; }
  const renderModeBar = () => { const b = $('#modebar'); if (b) b.innerHTML = demoBar(); };
  function headerHtml() {
    const u = me();
    return `<header>
        <button type="button" class="btn ghost nav-burger" data-act="navopen" aria-label="Open menu" aria-controls="side" aria-expanded="${document.body.classList.contains('nav-open')}">${P('<path d="M4 6h16M4 12h16M4 18h16"/>')}</button>
        <div class="brand"><div><h1 class="ptitle">${esc(TITLES[S.view] || VIEW_LABEL[S.view])}</h1><small>Main Database BH · ${esc(sourceLabel())}</small></div></div>
        <div class="spacer"></div>
        <button class="btn ghost" data-act="refresh" title="Refresh">${P('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>')}<span>Refresh</span></button>
        <div class="me" title="${esc(u.name)} · ${esc(u.role)}"><div class="avatar">${esc(initials(u.name))}</div>
          <div><div style="font-weight:600;font-size:13px">${esc(u.name)}</div><div class="role">${esc(u.role)}${u.vaLabel ? ' · ' + esc(u.vaLabel) : ''}</div></div></div>
      </header>`;
  }
  // the server says whether its allowlisted Monday updates are switched on (MONDAY_WRITES); the labels say which applies
  const mondayWritesOn = () => !DEMO && !!(S.integ && S.integ.mondayWrites);
  const sourceLabel = () => (DEMO ? 'Demo data' : S.source === 'monday' ? (mondayWritesOn() ? 'Monday.com (live)' : 'Monday.com (live, read-only)') : 'MongoDB (local backend)');
  const IST = { not_configured: ['off', 'Not connected'], not_checked: ['idle', 'Configured'], ok: ['ok', 'Connected'], error: ['err', 'Error'] };
  function istChip(name, s) {
    if (!s) return '';
    const [cls, label] = IST[s.state] || IST.not_configured;
    const tip = s.state === 'error' ? s.lastError : s.state === 'not_configured' ? 'Set ' + (s.missing || []).join(', ') + ' in preview/.env' : s.lastOkAt ? 'Last success ' + ago(s.lastOkAt) : 'Not used yet';
    return `<span class="ist ${cls}" title="${esc(tip)}"><span class="dot"></span>${esc(name)}: ${label}</span>`;
  }
  const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /**
   * How old the Monday data on screen is (time its read started), whether a newer copy is loading, and any refresh
   * failure. Old data is always labelled as old; nothing else is shown in its place.
   */
  function mondayDataNote() {
    const shown = S.srcBoards || {}, live = (S.srcLive && S.srcLive.boards) || {}, staleMs = S.srcStaleMs || 300e3;
    const old = !!S.srcFetchedAt && Date.now() - new Date(S.srcFetchedAt).getTime() > staleMs;
    const refreshing = Object.values(live).some((b) => b.refreshing);
    const failed = Object.entries(live).filter(([k, b]) => b.refreshError && shown[k] && shown[k].loaded);
    let h = `<div class="src-note${old ? ' stale' : ''}" role="status">${mondayWritesOn()
      ? 'Live Monday.com data. Only the changes you confirm (Availability in the Inventory Dashboard, “Update on Monday” in a lead\'s details, a viewing\'s result in the Calendar) are written to Monday; nothing else is, and Monday data isn\'t saved to MongoDB or this browser.'
      : 'Live Monday.com data, read-only: nothing is written to Monday or saved to MongoDB or this browser.'}`;
    if (S.srcFetchedAt) h += ` Data on screen was read from Monday at <b>${esc(hhmm(S.srcFetchedAt))}</b> (${esc(ago(S.srcFetchedAt))}).${old ? ' <b>It may be out of date.</b>' : ''}`;
    if (refreshing) h += ' Refreshing in the background… the data on screen stays until the new copy is ready.';
    if (S.srcNewer) h += ' <b>Newer data is ready</b> and appears when you close the open panel.';
    h += '</div>';
    if (failed.length) {
      h += `<div class="src-err" role="alert">${failed.map(([k, b]) => `<div><b>Monday ${esc(k)}: refresh failed at ${esc(hhmm(b.refreshFailedAt))}.</b> ${esc(b.refreshError)} Still showing the last successful copy, read at ${esc(hhmm(shown[k].fetchedAt))} (${esc(ago(shown[k].fetchedAt))}); it is not up to date.</div>`).join('')}
        <div class="sub">No MongoDB or demo data is used instead. It retries on its own; Refresh tries again now.</div></div>`;
    }
    if (S.srcLive && S.srcLive.checkError) h += `<div class="src-err" role="alert"><b>Couldn't check Monday.com for newer data:</b> ${esc(S.srcLive.checkError)} The data on screen was read ${esc(ago(S.srcFetchedAt))}.</div>`;
    return h;
  }
  function demoBar() {
    if (!DEMO) {
      const m = S.integ && S.integ.monday, canMonday = !!(m && m.configured);
      const errs = S.source === 'monday' ? Object.entries(S.srcErrors || {}) : [];
      const nc = S.source === 'monday' ? (S.srcNotConfigured || []) : [];
      return `<div class="demo-bar live-bar ${S.source === 'monday' ? 'ext' : ''}"><span class="demo-tag live">MongoDB</span>
        <div class="seg" role="group" aria-label="Data source">
          <button data-act="source" data-v="mongo" aria-pressed="${S.source === 'mongo'}">MongoDB</button>
          <button data-act="source" data-v="monday" aria-pressed="${S.source === 'monday'}" title="${canMonday ? (mondayWritesOn() ? 'Show live Monday.com data (only confirmed, allowlisted updates are written) — the default' : 'Show live Monday.com data (read-only) — the default') : 'Monday.com is not connected: set MONDAY_TOKEN and the board IDs in preview/.env'}">${mondayWritesOn() ? 'Monday.com · live' : 'Monday.com · read-only'}</button></div>
        ${S.srcBusy ? '<span class="muted">Loading from Monday.com…</span>' : ''}
        ${S.source === 'monday' && S.rsInfo ? (S.rsInfo.busy ? `<span class="muted" role="status">Checking respond.io chats… ${Math.max(0, (S.rsInfo.linked || 0) - (S.rsInfo.pending || 0))} of ${S.rsInfo.linked || '?'}</span>`
          : S.rsInfo.error ? '' : `<span class="muted" role="status">Reply states checked ${S.rsInfo.at ? esc(ago(S.rsInfo.at)) : ''}</span>`)
          : S.source === 'monday' && S.integ && S.integ.respond && S.integ.respond.configured && !S.integ.respond.listChecks ? '<span class="muted">respond.io: read per lead when you open its Chat tab; other reply statuses show as unchecked</span>' : ''}
        ${istChip('Monday.com', m)}${istChip('respond.io', S.integ && S.integ.respond)}
        <span class="spacer"></span><span class="mb-text">Signed in as <b>${esc(me().name)}</b> (${esc(me().role)})</span>
        <button class="btn sm" data-act="logout">Sign out</button></div>
        ${S.source === 'monday' ? mondayDataNote() : ''}
        ${errs.length ? `<div class="src-err" role="alert">${errs.map(([k, v]) => `<div><b>${esc(k === 'all' ? 'Monday.com' : 'Monday ' + k)}:</b> ${esc(v)}</div>`).join('')}<div class="sub">No substitute data is shown for these.${S.srcErrors.viewings ? ' Without the Calendar board, AI Status uses Monday AI STATUS / status rules only, and Days in Stage starts from the inquiry date.' : ''}</div></div>` : ''}
        ${S.source === 'monday' && S.rsInfo && S.rsInfo.error ? `<div class="src-err" role="alert"><b>respond.io:</b> ${esc(S.rsInfo.error)} <span class="sub">Reply state and Temperature for those leads stay unchecked (no substitute data).${S.rsInfo.retryAt ? ' Trying again at ' + esc(hhmm(new Date(S.rsInfo.retryAt).toISOString())) + '.' : ' Failed chats are tried again automatically.'}</span></div>` : ''}
        ${nc.length ? `<div class="src-note">Not configured: ${nc.map((k) => esc(k)).join(', ')} (set the board IDs in preview/.env).</div>` : ''}`;
    }
    return `<div class="demo-bar"><span class="demo-tag">Demo data</span>
      <span class="mb-text" title="Fictional sample leads, listings and viewings. Not connected to Monday.com, respond.io or Google. Changes are saved only in this browser.">Fictional sample data · saved only in this browser · not connected to Monday.com, respond.io or Google${S.ephemeral ? ' · <b>large test set, not saved</b>' : ''}</span>
      <span class="spacer"></span>
      <label class="muted">View as <select data-ch="as">${D.users.map((x) => `<option value="${esc(x.email)}" ${x.email === me().email ? 'selected' : ''}>${esc(x.name)} · ${esc(x.role)}</option>`).join('')}</select></label>
      <button class="btn sm" data-act="reset">Reset demo data</button></div>`;
  }
  function sidebar() {
    const vis = visibleLeads();
    // Calendar: viewings waiting for broker feedback (the Pending Broker Feedback panel), once loaded
    const cnt = { leads: vis.length, vaportal: vaPending().length, calendar: S.pend && S.pend.at ? S.pend.rows.length : 0,
      renewals: vis.filter((l) => l.ai === 'For Renewal').length, propreq: PR.sourcingLeads(vis).length, clientreq: CR.clients(vis).length };
    const hot = { vaportal: 1 };
    const by = (k) => { const m = {}; vis.forEach((l) => { m[l[k]] = (m[l[k]] || 0) + 1; }); return m; };
    const aiN = by('ai'), tempN = by('temp');
    const navOn = (k) => S.view === k && !(k === 'leads' && (S.wait || S.ai.length || S.temp.length));
    const views = VIEWS.filter(([k]) => canSee(k)).map(([k, label, icon]) => `<button class="nav ${navOn(k) ? 'on' : ''}" data-act="nav" data-v="${k}" ${navOn(k) ? 'aria-current="page"' : ''}>${icon}<span class="nl">${esc(label)}</span>${cnt[k] ? `<span class="cnt ${hot[k] ? 'hot' : ''}">${cnt[k]}</span>` : ''}</button>`).join('');
    const waitN = (w) => vis.filter((l) => l.onRespond && l.waiting === w).length;
    const navWait = (k, label, color) => `<button class="nav ${S.view === 'leads' && S.wait === k ? 'on' : ''}" data-act="navwait" data-v="${k}" aria-pressed="${S.view === 'leads' && S.wait === k}"><span class="dot" style="background:${color}"></span><span class="nl">${label}</span><span class="cnt">${waitN(k)}</span></button>`;
    return `<aside class="side" id="sideNav" aria-label="Main navigation">
      <div class="brand"><div class="logo">BH</div><div>Blackhouse<small>Leads Portal</small></div><button type="button" class="btn ghost side-close" data-act="navclose" aria-label="Close menu">${P('<path d="M18 6 6 18M6 6l12 12"/>')}</button></div>
      <h4>Views</h4>${views}
      ${canSee('leads') ? `<h4>Response</h4>${navWait('va', 'Needs VA Reply', 'var(--danger)')}${navWait('client', 'Waiting on Client', 'var(--muted)')}
      <h4>AI Status</h4>${AI_STAGES.map((st) => `<button class="nav ${S.view === 'leads' && S.ai.includes(st) ? 'on' : ''}" data-act="navai" data-v="${esc(st)}" aria-pressed="${S.view === 'leads' && S.ai.includes(st)}"><span class="dot" style="background:${AI_COLORS[st]}"></span><span class="nl">${esc(st)}</span><span class="cnt">${aiN[st] || ''}</span></button>`).join('')}
      <h4>Temperature</h4>${TEMPS.map((t) => `<button class="nav ${S.view === 'leads' && S.temp.includes(t) ? 'on' : ''}" data-act="navtemp" data-v="${esc(t)}" aria-pressed="${S.view === 'leads' && S.temp.includes(t)}"><span style="width:16px;text-align:center" aria-hidden="true">${TEMP_STYLE[t][1]}</span><span class="nl">${esc(t)}</span><span class="cnt">${tempN[t] || ''}</span></button>`).join('')}` : ''}
      <div class="side-note">${DEMO ? 'Local preview · demo data' : 'Local backend · ' + esc(S.source === 'monday' ? (mondayWritesOn() ? 'Monday.com (confirmed updates only)' : 'Monday.com (read-only)') : 'MongoDB')}<br>
        <button class="linkbtn" data-act="theme">${S.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</button><br>
        <span class="keys">Keys: <kbd>/</kbd> search · <kbd>↑</kbd><kbd>↓</kbd> rows · <kbd>Enter</kbd> open · <kbd>B</kbd> book · <kbd>[</kbd><kbd>]</kbd> prev/next</span></div>
    </aside>`;
  }
  function viewHtml() {
    const fn = { leads: leadsView, vaportal: vaPortalView, monitor: monitorView, calendar: calendarView, invdash: invView, ldash: ldashView,
      brokers: brokersView, renewals: renewalsView, daily: dailyView, propreq: propReqView, clientreq: clientReqView, team: settingsView }[S.view];
    return fn ? fn() : laterView(S.view);
  }
  const laterBox = (title, what) => `<div class="later-box"><b>${esc(title)} isn't in this preview yet.</b><br>In the live portal: ${esc(what)}<br><span class="sub">It will be built in a later migration phase. Nothing here connects to the live system.</span></div>`;
  const laterView = (k) => `<div class="panel"><div class="pad">${laterBox(VIEW_LABEL[k], LATER[k] || '')}</div></div>`;

  // ---------- Leads ----------
  const PAGE_ROWS = 150;
  const TYPE_COLORS = { Rent: '#3fb950', Buy: '#f0883e' };
  const typePill = (t) => t ? `<span class="tpill" style="--c:${TYPE_COLORS[t] || '#8b949e'}">${t === 'Buy' ? 'SALE' : esc(t.toUpperCase())}</span>` : '<span class="muted">—</span>';
  const vaHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
  const vaPill = (va) => va ? `<span class="vpill" style="--h:${vaHue(va)}">${esc(va)}</span>` : '<span class="muted">Unassigned</span>';
  const bedsTxt = (b) => !b ? '' : b === 'Studio' ? 'Studio' : b + ' BR';
  const daysTxt = (l) => (l.daysInStage == null ? '' : l.daysInStage + ' d in stage');
  // every linked lead ends in one state: a reply status, "Check failed" (retried by itself), "Checking…" while a round
  // runs, or "Reply unchecked" when list checks are off / done without reaching it
  const replyBadge = (l) => l.onRespond && l.waiting ? `<span class="wait ${l.waiting}">${l.waiting === 'va' ? 'Needs VA Reply' : 'Waiting on Client'}</span>`
    : l.onRespond && l.replyError ? `<span class="wait err" title="${esc('respond.io check failed: ' + l.replyError + ' It is tried again automatically; the Chat tab reads it now.')}">Check failed</span>`
    : l.onRespond && l.replyChecked === false ? (S.rsInfo && S.rsInfo.busy ? '<span class="wait unk" title="Reading this lead\'s respond.io chat…">Checking…</span>'
      : '<span class="wait unk" title="respond.io chat not read yet. Open the Chat tab to check it.">Reply unchecked</span>') : '';
  const COLS = [   // [key, header, sortable]
    ['id', 'Lead ID', 1], ['name', 'Client', 1], ['ai', 'AI Status', 1], ['temp', 'Temperature', 1], ['va', 'VA', 1], ['type', 'Type', 1],
    ['look', 'Looking For', 0], ['movein', 'Move-in', 1], ['source', 'Source', 1], ['added', 'Added', 1]];
  const SORTS = [['new', 'Newest First'], ['old', 'Oldest First'], ['updated', 'Recently Updated'], ['hot', 'Hottest First'], ['value', 'Highest Lead Value'], ['waiting', 'Needs Reply First']];

  const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // search index per lead object (dropped when a lead is saved)
  const IDX = new WeakMap();
  const indexOf = (l) => { let s = IDX.get(l); if (!s) { s = [l.code, l.name, l.email, l.city, l.requirements, l.va].join(' ').toLowerCase(); IDX.set(l, s); } return s; };
  function filtered(skip) {
    const q = S.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    const list = visibleLeads().filter((l) =>
      (!q || indexOf(l).includes(q) || (qd.length >= 3 && String(l.phone || '').replace(/\D/g, '').includes(qd))) &&
      (!S.va || (S.va === '__none' ? !l.va : l.va === S.va)) &&
      (skip === 'ai' || !S.ai.length || S.ai.includes(l.ai)) &&
      (skip === 'temp' || !S.temp.length || S.temp.includes(l.temp)) &&
      (!S.type || l.inquiry === S.type) && (!S.from || l.source === S.from) &&
      (skip === 'wait' || !S.wait || (l.onRespond && l.waiting === S.wait)));
    if (skip) return list;
    const str = (a, b) => COLLATOR.compare(String(a || ''), String(b || ''));
    const by = {
      new: (a, b) => str(b.createdAt, a.createdAt), old: (a, b) => str(a.createdAt, b.createdAt),
      updated: (a, b) => str(b.updatedAt, a.updatedAt), hot: (a, b) => (TEMP_RANK[a.temp] ?? 9) - (TEMP_RANK[b.temp] ?? 9),
      value: (a, b) => (b.budget || 0) - (a.budget || 0), waiting: (a, b) => (a.waiting === 'va' ? 0 : 1) - (b.waiting === 'va' ? 0 : 1),
      id: (a, b) => str(a.code, b.code), name: (a, b) => str(a.name, b.name), va: (a, b) => str(a.va || '~', b.va || '~'),
      ai: (a, b) => AI_STAGES.indexOf(a.ai) - AI_STAGES.indexOf(b.ai), temp: (a, b) => (TEMP_RANK[a.temp] ?? 9) - (TEMP_RANK[b.temp] ?? 9),
      type: (a, b) => str(a.inquiry, b.inquiry), source: (a, b) => str(a.source, b.source), added: (a, b) => str(a.createdAt, b.createdAt),
      movein: (a, b) => str(a.moveIn || '9999', b.moveIn || '9999'),
    };
    const fn = by[S.sortCol || S.sort] || by.new, dir = S.sortCol && S.sortDir === 'desc' ? -1 : 1;
    return list.sort((a, b) => dir * fn(a, b));
  }

  /** The filter selects; used in the toolbar (desktop/tablet) and in the Filters sheet (phones). */
  function filterControls() {
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label || v)}</option>`;
    const fsel = (key, cap, cur, options, all) => `<label class="fsel ${cur ? 'on' : ''}"><span class="cap">${cap}</span><select data-ch="${key}" aria-label="${cap}">${opt('', cur, all)}${options}</select></label>`;
    const vas = isManager() ? fsel('va', 'VA', S.va, opt('__none', S.va, 'Unassigned') + LISTS.vas.concat(uniqueVals('va')).filter((v, i, a) => a.indexOf(v) === i).map((v) => opt(v, S.va)).join(''), 'All') : '';
    return `${vas}
        ${fsel('ai1', 'AI Status', S.ai.length === 1 ? S.ai[0] : S.ai.length ? '__multi' : '', (S.ai.length > 1 ? opt('__multi', '__multi', S.ai.length + ' selected') : '') + AI_STAGES.map((s) => opt(s, S.ai.length === 1 ? S.ai[0] : '')).join(''), 'Any')}
        ${fsel('temp1', 'Temperature', S.temp.length === 1 ? S.temp[0] : S.temp.length ? '__multi' : '', (S.temp.length > 1 ? opt('__multi', '__multi', S.temp.length + ' selected') : '') + TEMPS.map((s) => opt(s, S.temp.length === 1 ? S.temp[0] : '')).join(''), 'Any')}
        ${fsel('type', 'Type', S.type, opt('Rent', S.type) + opt('Buy', S.type, 'Buy (Sale)'), 'Any')}
        ${fsel('from', 'Source', S.from, LISTS.sources.concat(uniqueVals('source')).filter((v, i, a) => a.indexOf(v) === i).map((s) => opt(s, S.from)).join(''), 'All')}
        <label class="fsel ${S.sortCol ? 'on' : ''}"><span class="cap">Sort</span><select data-ch="sort" aria-label="Sort">${S.sortCol ? `<option value="" selected>${esc(COLS.find((c) => c[0] === S.sortCol)[1])} ${S.sortDir === 'desc' ? '↓' : '↑'}</option>` : ''}${SORTS.map(([v, l]) => opt(v, S.sortCol ? '' : S.sort, l)).join('')}</select></label>`;
  }
  const activeFilters = () => (S.va ? 1 : 0) + S.ai.length + S.temp.length + (S.wait ? 1 : 0) + (S.type ? 1 : 0) + (S.from ? 1 : 0);
  /** Phones: all filters (plus the Response shortcuts) in a bottom sheet. */
  function filterSheetHtml() {
    const n = S.list ? S.list.length : 0, wait = (k, label) => `<button type="button" class="btn ${S.wait === k ? 'on' : ''}" data-act="navwait" data-v="${k}" aria-pressed="${S.wait === k}">${label}</button>`;
    return `<div class="sheet-grip" aria-hidden="true"></div><h3 id="modalTitle">Filters${activeFilters() ? ` <span class="fcount">${activeFilters()}</span>` : ''}</h3>
      <div class="fsheet">${filterControls()}</div>
      <div class="section-title">Response</div><div class="fsheet-row">${wait('va', 'Needs VA Reply')}${wait('client', 'Waiting on Client')}</div>
      <div class="actions"><button type="button" class="btn" data-act="clearall" ${activeFilters() || S.q ? '' : 'disabled'}>Clear all</button><span class="spacer"></span>
        <button type="button" class="btn primary" data-act="mclose">Show ${n.toLocaleString()} lead${n === 1 ? '' : 's'}</button></div>`;
  }
  function leadsView() {
    const nf = activeFilters();
    return `<div class="stats" role="group" aria-label="Filter by AI Status">
        <button class="stat" data-act="tile" data-k="" data-v=""><div class="n" id="nAll">0</div><div class="l">All Leads</div></button>
        ${AI_STAGES.map((st) => `<button class="stat" style="--c:${AI_COLORS[st]}" data-act="tile" data-k="ai" data-v="${esc(st)}"><div class="n" data-tn="ai:${esc(st)}">0</div><div class="l"><span class="dot" style="background:${AI_COLORS[st]}"></span>${esc(st)}</div></button>`).join('')}
      </div>
      <div class="stats" role="group" aria-label="Filter by Temperature">${TEMPS.map((t) => `<button class="stat" style="--c:${TEMP_STYLE[t][0]}" data-act="tile" data-k="temp" data-v="${esc(t)}"><div class="n" data-tn="temp:${esc(t)}">0</div><div class="l"><span aria-hidden="true">${TEMP_STYLE[t][1]}</span> ${esc(t)}</div></button>`).join('')}</div>
      <div class="toolbar" id="toolbar">
        <div class="search">${P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<input id="q" type="search" data-in="q" placeholder="Search name, phone, lead ID, location…" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search leads (press / to focus)"><kbd class="kq" aria-hidden="true">/</kbd></div>
        <button type="button" class="btn fbtn ${nf ? 'on' : ''}" data-act="filtersheet" aria-haspopup="dialog">${P('<path d="M3 5h18M6 12h12M10 19h4"/>')}Filters${nf ? ` <span class="fcount">${nf}</span>` : ''}</button>
        <div class="fctl">${filterControls()}</div>
      </div>
      <div class="chips" id="chips"></div>
      <div class="list" id="list" role="table" aria-label="Leads" aria-rowcount="0"></div>
      <div class="foot-note" id="footnote"></div>`;
  }
  /** Distinct non-empty values of a lead field (adds real Monday labels to the fictional picklists). */
  const uniqueVals = (k) => [...new Set(D.leads.map((l) => l[k]).filter(Boolean))].sort();

  function headRow() {
    return `<div class="row head" role="row">${COLS.map(([k, label, sortable]) => {
      const on = S.sortCol === k, dir = on ? (S.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<div class="hcell c-${k}" role="columnheader" aria-sort="${dir}">${sortable ? `<button class="hsort ${on ? 'on' : ''}" data-act="sortcol" data-v="${k}" title="Sort by ${esc(label)}">${esc(label)}<span aria-hidden="true">${on ? (S.sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span></button>` : esc(label)}</div>`;
    }).join('')}</div>`;
  }
  function rowHtml(l) {
    const mi = l.moveIn ? daysUntil(l.moveIn) : null;
    const look = [money(l.budget), l.city, bedsTxt(l.bedrooms), l.occupants ? l.occupants + ' pax' : '', l.pets === 'With Pets' ? 'Pets' : ''].filter(Boolean).join(' · ');
    const late = l.daysInStage != null && l.daysInStage > 14;
    const book = canEdit('calendar') ? `<button class="qb" data-act="openbook" data-id="${esc(l.id)}" title="Book a viewing (B)" aria-label="Book a viewing for ${esc(l.name)}" tabindex="-1">📅</button>` : '';
    return `<div class="row" role="row" tabindex="0" data-act="open" data-id="${esc(l.id)}" aria-label="${esc(l.code + ' ' + l.name)}">
      <div class="cell c-id id" role="cell">${esc(l.code)}</div>
      <div class="cell c-name" role="cell"><div class="name">${esc(l.name)}</div><div class="sub">${esc(l.phone)}</div>${book}</div>
      <div class="cell c-ai" role="cell" title="${esc(aiTip(l))}">${l.ai ? aiPill(l, l.aiSource === 'rules') : '<span class="muted">—</span>'}${daysTxt(l) ? `<div class="sub days ${late ? 'late' : ''}">${daysTxt(l)}</div>` : ''}</div>
      <div class="cell c-temp" role="cell" title="${esc(l.tempWhy || '')}">${tempChip(l.temp)}${replyBadge(l) ? '<div>' + replyBadge(l) + '</div>' : ''}</div>
      <div class="cell c-va" role="cell">${vaPill(l.va)}</div>
      <div class="cell c-type" role="cell">${typePill(l.inquiry)}</div>
      <div class="cell c-look wrap2" role="cell" title="${esc(look + (l.requirements ? ' · ' + l.requirements : ''))}">${esc(look) || '<span class="muted">Not stated yet</span>'}${l.requirements ? '<br><span class="muted">' + esc(l.requirements) + '</span>' : ''}</div>
      <div class="cell c-movein" role="cell">${l.moveIn ? esc(fmtDate(l.moveIn).replace(/, \d{4}$/, '')) + `<div class="sub">${mi < 0 ? Math.abs(mi) + ' d ago' : mi + ' d left'}</div>` : '<span class="muted">—</span>'}</div>
      <div class="cell c-source" role="cell">${esc(l.source || '—')}<div class="sub">${l.origin === 'respond.io' ? '<span class="org org-r">respond.io</span>' : '<span class="org">Monday</span>'}</div></div>
      <div class="cell c-added sub" role="cell">${esc(fmtDate(l.createdAt))}</div></div>`;
  }

  /** Updates tiles, filter controls, chips, count and the list. `reset` jumps back to the first page of rows. */
  function refreshLeads(reset) {
    const box = $('#list'); if (!box) return;
    updateCounts();
    // tiles + selects reflect the filters
    $$('.stat[data-act=tile]').forEach((b) => {
      const k = b.dataset.k, on = !k ? !S.ai.length && !S.temp.length && !S.wait : S[k].includes(b.dataset.v);
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    // rebuild the filter bar so each control shows its state; keep focus on the control that was used (not while typing a search)
    const tb = $('#toolbar'), act = document.activeElement;
    if (tb && act !== $('#q')) {
      const key = act && tb.contains(act) && act.dataset ? act.dataset.ch : '';
      const tmp = document.createElement('div'); tmp.innerHTML = leadsView(); tb.replaceWith(tmp.querySelector('#toolbar'));
      if (key) { const el = $('#toolbar [data-ch="' + key + '"]'); if (el) el.focus(); }
    }
    renderChips();
    S.list = filtered();
    if (reset) { S.limit = PAGE_ROWS; box.scrollTop = 0; }
    box.setAttribute('aria-rowcount', S.list.length + 1);
    const fr = document.activeElement && document.activeElement.closest && document.activeElement.closest('#list .row[data-id]');
    const keepFocus = fr ? fr.dataset.id : '', keepScroll = box.scrollTop;
    if (!visibleLeads().length) box.innerHTML = `<div class="empty">${emptyLeadsMsg()}</div>`;
    else if (!S.list.length) box.innerHTML = '<div class="empty">No leads match these filters. <button class="linkbtn" data-act="clearall">Clear all filters</button></div>';
    else box.innerHTML = headRow() + S.list.slice(0, S.limit).map(rowHtml).join('') + moreRow();
    if (!reset) { box.scrollTop = keepScroll; if (keepFocus) { const r = rowEl(keepFocus); if (r) r.focus({ preventScroll: true }); } }
    if (S.open) { const r = rowEl(S.open); if (r) r.classList.add('sel'); }
    observeMore();
    const total = S.list.reduce((a, l) => a + (l.budget || 0), 0);
    $('#footnote').textContent = `${S.list.length.toLocaleString()} of ${visibleLeads().length.toLocaleString()} leads · total lead value ${money(total) || '₱0'} · ${S.list.filter((l) => l.onRespond).length.toLocaleString()} linked to Respond.io · ${sourceLabel()}`;
  }
  /** Items read so far per board during a long first load (from /api/monday/freshness; counts only). */
  function loadProgressHtml() {
    const b = S.srcProgress;
    if (!b) return '<div class="load-prog sub" role="status">Checking progress…</div>';
    const name = { leads: 'Leads', listings: 'Listings', viewings: 'Calendar' };
    const rows = Object.entries(b).map(([k, x]) => {
      const p = x.progress;
      const state = x.error ? `<span class="hotnum">failed: ${esc(x.error)}</span>`
        : x.loaded && !p ? 'done'
        : p ? `${p.read.toLocaleString()}${p.total ? ' of ' + p.total.toLocaleString() : ''} read${p.startedAt ? ' · ' + esc(elapsed(p.startedAt)) : ''}`
        : 'waiting';
      return `<div>${esc(name[k] || k)}: ${state}</div>`;
    });
    return `<div class="load-prog sub" role="status">${rows.join('')}</div>`;
  }
  const elapsed = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };
  /** While the first Monday load runs: show per-board progress every 3 s (this check never starts another fetch). */
  async function watchFirstLoad() {
    const id = S.loadPoll = (S.loadPoll || 0) + 1;
    const alive = () => S.loadPoll === id && S.srcBusy && S.source === 'monday' && !!S.user;
    while (alive()) {
      try { S.srcProgress = (await API.get('/api/monday/freshness')).boards; } catch (e) { if (signedOut(e)) return; }
      if (!alive()) return;
      const box = $('#list .empty'); if (box) box.innerHTML = emptyLeadsMsg();
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  function emptyLeadsMsg() {
    if (!DEMO && S.source === 'monday') {
      if (S.srcBusy || !S.srcFetchedAt && !Object.keys(S.srcErrors || {}).length) return `Loading leads from Monday.com (read-only)…${loadProgressHtml()}<br><span class="sub">The first load after the app starts can take a few minutes. No other data is shown meanwhile.</span>`;
      if (S.scopeNotice) return esc(S.scopeNotice);   // a broker without a (unique) Salesperson label: a setup step, not an error
      return S.srcErrors && Object.keys(S.srcErrors).length ? 'Monday.com leads could not be loaded (see the error above). No MongoDB or demo records are shown in their place.<br><span class="sub">Fix the problem and press Refresh, or choose <b>MongoDB</b> under Data source to work with MongoDB records.</span>' : 'Monday.com returned no leads you can see.';
    }
    return (isManager() ? 'No leads on the board yet.' : 'No leads are assigned to you yet.') + (!DEMO && isManager() ? '<br><span class="sub">MongoDB has no leads. Importing from Monday.com is a later phase; for fictional sample records run <b>npm run seed:demo</b> on an empty database.</span>' : '');
  }
  const moreRow = () => S.list.length > S.limit ? `<div class="more-row" id="moreRow"><button class="btn sm" data-act="more">Show ${Math.min(PAGE_ROWS, S.list.length - S.limit)} more</button><span class="muted">Showing ${S.limit.toLocaleString()} of ${S.list.length.toLocaleString()}</span></div>` : '';
  /** Appends the next page of rows without redrawing the existing ones. */
  function appendRows() {
    const box = $('#list'), more = $('#moreRow'); if (!box || !more) return;
    const next = S.list.slice(S.limit, S.limit + PAGE_ROWS); S.limit += next.length;
    more.insertAdjacentHTML('beforebegin', next.map(rowHtml).join(''));
    more.outerHTML = moreRow();
    observeMore();
  }
  let moreObs = null;
  function observeMore() {
    if (moreObs) moreObs.disconnect();
    const m = $('#moreRow'); if (!m || !('IntersectionObserver' in window)) return;
    // desktop: the table scrolls inside #list; phones: the page itself scrolls (cards), so watch the viewport
    const list = $('#list'), inner = getComputedStyle(list).overflowY !== 'visible' && list.scrollHeight > list.clientHeight;
    moreObs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) appendRows(); }, { root: inner ? list : null, rootMargin: '400px' });
    moreObs.observe(m);
  }
  function updateCounts() {
    const forAi = filtered('ai'), forTemp = filtered('temp');
    const count = (list, k) => { const m = {}; list.forEach((l) => { m[l[k]] = (m[l[k]] || 0) + 1; }); return m; };
    const ai = count(forAi, 'ai'), temp = count(forTemp, 'temp');
    const all = $('#nAll'); if (all) all.textContent = forAi.length.toLocaleString();
    $$('[data-tn]').forEach((n) => { const [k, v] = n.dataset.tn.split(/:(.*)/); n.textContent = ((k === 'ai' ? ai : temp)[v] || 0).toLocaleString(); });
  }
  function renderChips() {
    const chips = [];
    if (S.q.trim()) chips.push(['q', '', `Search: “${S.q.trim()}”`]);
    if (S.va) chips.push(['va', '', 'VA: ' + (S.va === '__none' ? 'Unassigned' : S.va)]);
    S.ai.forEach((v) => chips.push(['ai', v, 'AI: ' + v]));
    S.temp.forEach((v) => chips.push(['temp', v, v]));
    if (S.wait) chips.push(['wait', '', S.wait === 'va' ? 'Needs VA Reply' : 'Waiting on Client']);
    if (S.type) chips.push(['type', '', 'Type: ' + (S.type === 'Buy' ? 'Sale' : S.type)]);
    if (S.from) chips.push(['from', '', 'Source: ' + S.from]);
    $('#chips').innerHTML = chips.length ? '<span class="muted">Filters:</span>' + chips.map(([k, v, label]) => `<span class="fchip">${esc(label)}<button data-act="unchip" data-k="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(label)}">×</button></span>`).join('')
      + '<button class="linkbtn" data-act="clearall">Clear all filters</button>' : '';
  }
  /** After a filter change: update the list area and the sidebar highlights only. */
  function filtersChanged() {
    refreshLeads(true); renderSide();
    // keep the phone Filters sheet in step (and keep focus on the control that was used)
    if (S.modal && S.modal.kind === 'filters') {
      const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ch || document.activeElement.dataset.act : '';
      $('#modal .box').innerHTML = filterSheetHtml();
      const el = key && ($(`#modal [data-ch="${key}"]`) || $(`#modal [data-act="${key}"]`)); if (el) el.focus();
    }
  }

  // ---------- Lead drawer ----------
  const FIELDS = [
    ['status', 'Client Status', 'select', LISTS.clientStatuses], ['va', 'VA Assigned', 'select', [''].concat(LISTS.vas)],
    ['source', 'Source', 'select', LISTS.sources], ['inquiry', 'Inquiry Type', 'select', ['Rent', 'Buy']],
    ['name', 'Contact Name', 'text'], ['phone', 'Phone', 'text'], ['email', 'Email', 'email'],
    ['budget', 'Budget (₱)', 'number'], ['city', 'City', 'select', LISTS.cities], ['bedrooms', 'No. of Bedrooms', 'select', LISTS.bedrooms],
    ['occupants', 'No. of Occupants', 'select', LISTS.occupants], ['pets', 'Pets', 'select', LISTS.pets], ['moveIn', 'Target Move-in Date', 'date'],
    ['nationality', 'Nationality', 'text'], ['requirements', 'Client Requirements', 'textarea'],
    ['building', 'Specific Building', 'text'], ['sqm', 'SQM', 'text'], ['bathrooms', 'No. of Bathrooms', 'select', [''].concat(LISTS.bathrooms)],
    ['parking', 'Parking', 'select', [''].concat(LISTS.parking)], ['furnishing', 'Furnishing', 'select', [''].concat(LISTS.furnishing)],
  ];
  const FIELD_GROUPS = [['', ['status', 'va', 'source', 'inquiry']], ['Contact', ['name', 'phone', 'email']], ['Requirements', ['budget', 'city', 'bedrooms', 'occupants', 'pets', 'moveIn', 'nationality', 'requirements']],
    ['Unit Preferences', ['building', 'sqm', 'bathrooms', 'parking', 'furnishing']]];
  function openLead(id, tab) {
    const l = leadById(id); if (!l || !visibleLeads().includes(l)) return toast('You don\'t have access to this lead.', true);
    if (S.open && S.open !== id && Object.keys(S.draft).length && !confirm('Discard unsaved changes?')) return;
    if (!S.open) S.returnFocus = document.activeElement;
    S.open = id; S.tab = tab || 'details'; S.draft = {};
    if (!DEMO) {   // notes are loaded per lead from the API (MongoDB or Monday updates)
      l.notes = null;
      const url = S.source === 'monday' ? `/api/monday/leads/${encodeURIComponent(id)}/notes` : `/api/leads/${encodeURIComponent(id)}/notes`;
      API.get(url).then((r) => { l.notes = r.notes; if (S.open === id && S.tab === 'details') renderDrawerBody(); })
        .catch((e) => { l.notes = []; l.notesError = e.message; if (!signedOut(e) && S.open === id) renderDrawerBody(); });
    }
    renderDrawer();
    const d = $('#drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('open');
    $$('#list .row.sel').forEach((r) => r.classList.remove('sel'));
    const row = rowEl(id); if (row) row.classList.add('sel');
    focusIn(d, tab === 'props' ? '[data-act=book]' : 'h2');
  }
  function closeDrawer() {
    if (Object.keys(S.draft).length && !confirm('Discard unsaved changes?')) return;
    const id = S.open;
    S.open = null; S.draft = {}; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('open');
    $$('#list .row.sel').forEach((r) => r.classList.remove('sel'));
    const back = (id && rowEl(id)) || S.returnFocus; S.returnFocus = null;
    if (back && document.contains(back)) back.focus();
  }
  const rowEl = (id) => $(`#list .row[data-id="${CSS.escape(String(id))}"]`);
  /** Moves to the previous/next lead in the current filtered list. */
  function stepLead(d) {
    const list = S.list || filtered(), i = list.findIndex((l) => l.id === S.open), next = list[i + d];
    if (!next) return toast(d > 0 ? 'This is the last lead in the list.' : 'This is the first lead in the list.');
    if (S.limit && list.indexOf(next) >= S.limit) appendRows();
    openLead(next.id, S.tab === 'props' ? 'props' : undefined);
    const row = rowEl(next.id); if (row) row.scrollIntoView({ block: 'nearest' });
  }
  const leadViewings = (l, sts) => visibleViewings().filter((v) => v.leadId === l.id && sts.includes(v.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  /** Unit details for a viewing: a MongoDB/demo listing, or the building/city read from the Monday Calendar board. */
  const unitOf = (v) => { const x = listingById(v.listingId); return x ? { building: x.building, code: x.code, city: x.city, price: x.price } : { building: v.building || '—', code: '', city: v.city || '', price: 0 }; };
  const readOnlySource = () => !DEMO && S.source === 'monday';
  function renderDrawer() {
    const l = leadById(S.open); if (!l) return;
    const nS = leadViewings(l, ['Proposed']).length, nC = leadViewings(l, ['Confirmed']).length, nD = leadViewings(l, ['Done', 'Cancelled']).length;
    const tab = (k, label, later) => `<button class="tab ${S.tab === k ? 'on' : ''} ${later ? 'later' : ''}" role="tab" aria-selected="${S.tab === k}" data-act="tab" data-v="${k}">${label}</button>`;
    const pos = (S.list || []).findIndex((x) => x.id === l.id);
    const mi = l.moveIn ? daysUntil(l.moveIn) : null;
    $('#drawer').innerHTML = `<div class="d-head"><div style="flex:1;min-width:0">
        <div class="sub">${esc(l.code)} · ${esc(sourceLabel())}${pos >= 0 ? ` · ${pos + 1} of ${S.list.length.toLocaleString()}` : ''}</div>
        <h2 id="drawerTitle" tabindex="-1">${esc(l.name)}</h2>
        <div class="dsum" aria-label="Lead summary">
          ${l.ai ? aiPill(l) : ''}${daysTxt(l) ? `<span class="sub">${daysTxt(l)}</span>` : ''}
          ${l.temp ? tempChip(l.temp) : ''}${replyBadge(l)}
          <span class="sumi"><span class="d-lbl">VA</span>${vaPill(l.va)}</span>
          <span class="sumi">${typePill(l.inquiry)}</span>
          ${l.budget ? `<span class="sumi"><b>${esc(money(l.budget))}</b></span>` : ''}
          ${l.moveIn ? `<span class="sumi sub">Move-in ${esc(fmtDate(l.moveIn))}${mi != null ? ` (${mi < 0 ? Math.abs(mi) + ' d ago' : mi + ' d'})` : ''}</span>` : ''}
        </div>
        <div class="quick"><span class="muted">${esc(l.phone)}</span>
          ${canEdit('calendar') ? '<button class="btn sm primary" data-act="gobook">📅 Book Viewing</button>' : ''}
          <button class="linkbtn" data-act="notwired" data-v="Message Lead">✉ Message Lead</button>
          <button class="linkbtn" data-act="notwired" data-v="Call on respond.io">📞 Call on respond.io</button>
          <span class="muted sub">Added ${esc(fmtDate(l.createdAt))} · updated ${esc(ago(l.updatedAt))}</span></div></div>
        <div class="d-nav">
          <button class="btn ghost sm" data-act="prevlead" title="Previous lead ( [ )" aria-label="Previous lead">‹</button>
          <button class="btn ghost sm" data-act="nextlead" title="Next lead ( ] )" aria-label="Next lead">›</button>
          <button class="btn ghost" data-act="close" aria-label="Close (Esc)">${P('<path d="M18 6 6 18M6 6l12 12"/>')}</button></div></div>
      <div class="tabs" role="tablist" aria-label="Lead sections">${tab('details', 'Details')}${tab('props', 'Properties')}${tab('asking', askTabLabel(l))}${tab('approval', 'For Client Approval', 1)}
        ${tab('viewings', 'For Scheduling' + (nS ? ` (${nS})` : ''))}${tab('confirmed', 'Confirmed Schedule' + (nC ? ` (${nC})` : ''))}${tab('done', 'Done' + (nD ? ` (${nD})` : ''))}
        ${Object.entries(DEAL_TABS).map(([k, v]) => tab(k, v, 1)).join('')}${tab('chat', 'Respond.io Chat')}</div>
      <div class="d-body" id="dbody" role="tabpanel"></div><div id="dfoot"></div>`;
    renderDrawerBody();
  }
  /** Redraws only the open tab's content and footer (header and tabs stay, so focus is kept). */
  function renderDrawerBody() {
    const l = leadById(S.open), body = $('#dbody'); if (!l || !body) return;
    const panel = { details: detailsPanel, props: propsPanel, asking: askingPanel, viewings: () => viewingsPanel(l, ['Proposed']), confirmed: () => viewingsPanel(l, ['Confirmed']), done: () => viewingsPanel(l, ['Done', 'Cancelled']), chat: chatPanel }[S.tab];
    body.innerHTML = panel ? panel(l) : laterBox(DEAL_TABS[S.tab] || 'For Client Approval', LATER_TAB[S.tab] || '');
    loadAsking(l);
    $('#dfoot').innerHTML = S.tab === 'details' ? footHtml()
      : S.tab === 'chat' ? `<div class="composer"><input disabled aria-label="Message" placeholder="Sending is switched off in the preview (read-only)"><button class="btn primary" disabled>Send</button></div>` : '';
    if (S.tab === 'chat' && !DEMO) loadChat(l);
  }
  function footHtml() {
    const dirty = Object.keys(S.draft).length;
    const ro = readOnlySource() ? (mondayWritesOn() ? 'Monday.com: only the fields under "Update on Monday" can be changed' : 'Read-only (Monday.com)') : !canEdit('leads') ? 'View-only access' : '';
    return `<div class="d-foot"><span class="muted" style="font-size:12px" id="dirtyNote">${ro || (dirty ? dirty + ' Unsaved Change' + (dirty > 1 ? 's' : '') : 'No Changes')}</span><div class="spacer"></div>
      <button class="btn" data-act="discard" ${dirty ? '' : 'disabled'}>Discard</button><button class="btn primary" data-act="save" ${dirty && canEdit('leads') ? '' : 'disabled'} title="Save (Ctrl+S)">Save Changes</button></div>`;
  }
  function fieldInput(key) {
    const [, label, type, opts0] = FIELDS.find((f) => f[0] === key), l = leadById(S.open);
    const val = key in S.draft ? S.draft[key] : l[key], ro = canEdit('leads') ? '' : 'disabled', cls = key in S.draft ? 'dirty' : '';
    // a value read from Monday that isn't in the preview's picklist is still shown
    const sv = val == null ? '' : String(val);
    const opts = type !== 'select' || opts0.includes(sv) ? opts0 : sv ? opts0.concat([sv]) : [''].concat(opts0);
    const attrs = `data-field="${key}" class="${cls}" ${ro}`;
    const ctl = type === 'select' ? `<select ${attrs}>${opts.map((o) => `<option value="${esc(o)}" ${String(val == null ? '' : val) === o ? 'selected' : ''}>${esc(o || '(none)')}</option>`).join('')}</select>`
      : type === 'textarea' ? `<textarea ${attrs} maxlength="500">${esc(val)}</textarea>`
      : `<input type="${type}" ${attrs} value="${esc(val || '')}" ${type === 'number' ? 'min="0" step="1000"' : ''}>`;
    return `<label class="${type === 'textarea' ? 'full' : ''}">${esc(label)}${ctl}</label>`;
  }
  function detailsPanel(l) {
    return `<div class="aicard">
        <div><span class="d-lbl">AI Status</span>${l.ai ? aiPill(l, l.aiSource === 'rules') : '<span class="muted">—</span>'}${l.override ? ' <span class="ovr-tag" title="Stored in the portal only; Monday.com still shows its own status">Portal override</span>' : ''}<div class="sub" style="margin-top:4px">${esc(l.aiSub || '')}${l.aiSub && daysTxt(l) ? ' · ' : ''}${daysTxt(l)}${!l.aiSub && l.failReason ? ' · ' + esc(l.failReason) : ''}</div>${l.aiSource ? `<div class="sub" style="font-size:11px">${esc(AI_SRC[l.aiSource])}</div>` : ''}
          ${l.override ? `<div class="sub" style="font-size:11px">Set by ${esc(l.override.by || '—')} ${esc(ago(l.override.at))}. Monday.com is not changed.</div>${isManager() ? '<button class="linkbtn" data-act="unfail">Remove override</button>' : ''}`
            : isManager() && l.ai !== 'Failed' ? '<button class="linkbtn" data-act="failmodal" style="margin-top:4px">Mark as Failed (portal override)…</button>' : ''}</div>
        <div><span class="d-lbl">Temperature</span>${tempChip(l.temp)}<div class="sub" style="margin-top:4px">${l.tempWhy ? esc(l.tempWhy) : l.onRespond ? (l.waiting === 'va' ? 'Needs VA reply' : l.waiting === 'client' ? 'Waiting on client' : 'Respond ID ' + esc(l.contactId || '')) : 'No respond.io chat'}</div>
          ${l.lastText ? `<div class="sub" style="font-size:11px">Last message: “${esc(l.lastText)}”</div>` : ''}</div>
        <div><span class="d-lbl">Lead Value</span><b style="font-size:16px">${esc(money(l.budget) || '—')}</b><div class="sub" style="margin-top:4px">Client's budget${countsInReports(l) ? '' : ' · below report minimum'}</div></div>
        ${l.stageDays ? `<div style="grid-column:1/-1"><span class="d-lbl">Days in Stage</span><div class="dboxes">${['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection'].map((s) => `<span class="dbox ${l.ai === s ? 'on' : ''}" style="--c:${AI_COLORS[s]}" title="${esc(s)}"><b>${l.stageDays[s] != null ? Math.round(l.stageDays[s]) : '–'}</b><small>${esc(s === 'Property Matching' ? 'Matching' : s)}</small></span>`).join('')}</div></div>` : ''}</div>
      ${FIELD_GROUPS.map(([t, keys]) => (t ? `<div class="section-title">${t}</div>` : '') + `<div class="grid">${keys.map(fieldInput).join('')}</div>`).join('')}
      ${readOnlySource() ? mondayUpdateBox(l) : ''}
      <div class="section-title">Notes${readOnlySource() ? ' <span class="muted" style="text-transform:none;font-weight:400">(Monday updates, read-only)</span>' : ''}</div>
      ${canEdit('leads') ? `<textarea id="noteText" maxlength="2000" aria-label="New note" placeholder="Add a note (saved ${DEMO ? 'in this browser only' : 'to MongoDB'}, not to Monday)"></textarea>
      <div style="display:flex;justify-content:flex-end;margin:8px 0 14px"><button class="btn" data-act="addnote">Add Note</button></div>` : ''}
      ${l.notes == null ? '<div class="muted">Loading notes…</div>' : l.notesError ? `<div class="src-err">${esc(l.notesError)}</div>` : l.notes.length ? l.notes.slice().reverse().map((n) => `<div class="note"><div class="meta">${esc(n.by)} · ${esc(ago(n.at))}</div><div>${esc(n.text)}</div></div>`).join('') : '<div class="muted">No notes yet.</div>'}`;
  }
  async function saveDraft() {
    if (!canEdit('leads')) return toast(readOnlySource() ? 'Monday.com data is read-only in this phase.' : 'You have view-only access to Leads.', true);
    const l = leadById(S.open), { value, errors } = SH.validateLeadPatch(S.draft);
    if (errors.length) return toast(errors[0], true);
    if (!(await attempt(() => backend.saveLead(l, value)))) return;
    IDX.delete(l); S.draft = {}; renderDrawer(); rerenderMain();
    toast('Saved ' + where() + '. Nothing was written to Monday.com.');
  }

  // Property matching: hard rules hide units; soft rules rank (budget band ±15%, per data-points.xlsx).
  // fb: rules from the client's viewing feedback (SH.feedbackPrefs) hide or move units, as the Apps Script suggestions did.
  function matchListing(l, x, anyType, fb) {
    if (x.availability === 'Not Available' || (!anyType && x.type !== (l.inquiry === 'Rent' ? 'For Rent' : 'For Sale'))) return null;
    const chips = [];
    // "BGC", "Taguig" and "Taguig (BGC)" are the same place; a lead may name several areas
    chips.push(['Location', x.city === l.city || SH.citiesIn(l.city + ' ' + (l.location || '')).includes(x.city)]);
    chips.push(['Bedrooms', x.bedrooms === l.bedrooms]);
    if (l.budget) chips.push(['Budget', x.price <= l.budget * 1.15]);
    if (l.pets === 'With Pets') chips.push(['Pets', x.petFriendly]);
    let score = chips.reduce((s, [k, hit]) => s + (hit ? (k === 'Location' || k === 'Budget' ? 3 : 2) : 0), 0);
    if (fb && fb.rules.length) {
      const a = SH.applyFeedback({ price: x.price, sqm: x.sizeSqm, bedrooms: x.bedrooms, building: x.building, location: x.city }, fb);
      if (a.hide) return null;
      score += a.boost;
      a.chips.forEach((c) => chips.push([c, !/disliked/.test(c)]));
    }
    return { score, chips };
  }
  function listingCard(x, extra) {
    const cls = { Available: 'av', Reserved: 'rs', 'Not Available': 'na' }[x.availability];
    const where1 = [x.code, [x.tower, x.floor != null ? 'floor ' + x.floor : ''].filter(Boolean).join(', '), x.city].filter(Boolean).join(' · ');
    // Monday photos come through the server (/api/monday/photo/<asset>), so the page only loads images from its own API
    const photoUrl = (id, thumb) => API.url(`/api/monday/photo/${encodeURIComponent(id)}${thumb ? '?thumb=1' : ''}`);
    const ph = !DEMO && x.photos && x.photos.length ? x.photos : null;
    const photo = ph ? `<a class="phl" href="${esc(photoUrl(ph[0]))}" target="_blank" rel="noopener" data-pid="${esc(x.id)}" aria-label="Open photo of ${esc(x.building)}"><img class="lphoto" src="${esc(photoUrl(ph[0], true))}" alt="Photo of ${esc(x.building)}" loading="lazy" decoding="async"></a>
      ${ph.length > 1 ? `<button type="button" class="pnav prev" data-act="photonav" data-id="${esc(x.id)}" data-v="-1" aria-label="Previous photo">‹</button><button type="button" class="pnav next" data-act="photonav" data-id="${esc(x.id)}" data-v="1" aria-label="Next photo">›</button><span class="count" data-pc="${esc(x.id)}">1/${ph.length}</span>` : ''}` : '';
    return `<div class="lcard"><div class="lph ${ph ? 'has-photo' : ''}" style="--h:${x.hue}">${photo}<span class="badge ${cls}" title="${esc(x.availabilityLabel || x.availability)}">${esc(x.availability)}</span>${extra && extra.score != null ? `<span class="score">Match ${extra.score}</span>` : ''}<span class="ini">${esc(initials(x.building))}</span></div>
      <div class="lbody"><div><div class="lt">${esc(x.building)}</div><div class="sub">${esc(where1)}</div></div>
        <div class="lprice">${esc(money(x.price) || '—')}<small>${x.type === 'For Rent' ? ' / month' : ' · for sale'}</small></div>
        <div class="lspecs"><span>🛏 ${esc(bedsTxt(x.bedrooms) || '—')}</span><span>🛁 ${x.bathrooms || '—'} bath</span><span>📐 ${x.sizeSqm || '—'} sqm</span><span>🪑 ${esc(x.furnishing || '—')}</span>
          <span>${x.parking ? '🚗 Parking' : 'No parking'}</span><span>${x.petFriendly ? '🐾 Pet-friendly' : 'No pets'}</span></div>
        ${extra && extra.chips ? `<div class="mchips">${extra.chips.map(([k, hit]) => `<span class="mchip ${hit ? 'hit' : 'miss'}">${hit ? '✓' : '✗'} ${esc(k)}</span>`).join('')}</div>` : ''}
        ${extra && extra.action || ''}</div></div>`;
  }
  // ---- Properties tab: the client's matches plus the VA's own search (filters kept per open lead) ----
  const PF0 = () => ({ q: '', cities: [], beds: [], type: '', priceMin: '', priceMax: '', furnishing: '', pets: false, all: false });
  function pfFor(l) { if (!S.pf || S.pf.lead !== l.id) { S.pf = { lead: l.id, f: PF0(), limit: 24 }; } return S.pf.f; }
  const pfCount = (f) => f.cities.length + f.beds.length + ['q', 'type', 'priceMin', 'priceMax', 'furnishing'].filter((k) => f[k]).length + (f.pets ? 1 : 0) + (f.all ? 1 : 0);
  /** Cities that listings are in, most listings first (Taguig (BGC) etc. are already one label each). */
  function listingCities() { const n = {}; D.listings.forEach((x) => { n[x.city] = (n[x.city] || 0) + 1; }); return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b)); }
  /** Matches for the lead, narrowed by the VA's filters. f.all = ignore the client's requirements (any available unit). */
  function propResults(l) {
    const f = pfFor(l), fb = f.all ? null : leadFeedback(l);   // "ignore the client's requirements" also ignores feedback
    const scored = D.listings.map((x) => [x, matchListing(l, x, f.all || !!f.type, fb)]).filter(([, m]) => m);
    const xs = SH.filterListings(scored.map(([x]) => x), { ...f, available: true }), keep = new Set(xs);
    return scored.filter(([x]) => keep.has(x)).sort((a, b) => b[1].score - a[1].score);
  }
  function propsPanel(l) {
    const f = pfFor(l), req = [l.inquiry, l.city, bedsTxt(l.bedrooms), l.budget ? 'up to ' + money(l.budget) : 'budget unknown', l.pets === 'With Pets' ? 'with pets' : ''].filter(Boolean);
    const chip = (k, v, label) => `<button type="button" class="gchip ${f[k].includes(v) ? 'on' : ''}" data-act="pfchip" data-k="${k}" data-v="${esc(v)}" aria-pressed="${f[k].includes(v)}">${esc(label || v)}</button>`;
    const n = pfCount(f);
    return `<div class="reqbar" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"><b class="sub" style="align-self:center">Client wants:</b>${req.map((r) => `<span class="fchip" style="padding-right:10px">${esc(r)}</span>`).join('')}</div>
      <details class="pfbox" ${n || S.pfOpen ? 'open' : ''}><summary>🔎 <b>Search properties yourself</b>${n ? ` <span class="pill" style="--c:var(--accent)">${n} filter${n === 1 ? '' : 's'} on</span>` : ''}</summary>
        <div class="pf-row"><span class="pf-l">Search</span><input type="search" data-in="pfq" value="${esc(f.q)}" placeholder="Building, unit or listing ID…" aria-label="Search listings" autocomplete="off"></div>
        <div class="pf-row"><span class="pf-l">City</span><div class="gchips">${listingCities().slice(0, 14).map((c) => chip('cities', c)).join('')}</div></div>
        <div class="pf-row"><span class="pf-l">Bedrooms</span><div class="gchips">${LISTS.bedrooms.map((b) => chip('beds', b, b === 'Studio' ? 'Studio' : b + ' BR')).join('')}</div></div>
        <div class="pf-row pf-g">
          <label>Rent / sale<select data-ch="pftype"><option value="">Client's (${esc(l.inquiry === 'Rent' ? 'for rent' : 'for sale')})</option><option value="For Rent" ${f.type === 'For Rent' ? 'selected' : ''}>For rent</option><option value="For Sale" ${f.type === 'For Sale' ? 'selected' : ''}>For sale</option></select></label>
          <label>Min price<input type="number" min="0" step="1000" inputmode="numeric" data-in="pfmin" value="${esc(f.priceMin)}" placeholder="₱"></label>
          <label>Max price<input type="number" min="0" step="1000" inputmode="numeric" data-in="pfmax" value="${esc(f.priceMax)}" placeholder="₱"></label>
          <label>Furnishing<select data-ch="pffurn"><option value="">Any</option>${LISTS.furnishing.map((x) => `<option ${f.furnishing === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>
        <div class="pf-row pf-ck"><label><input type="checkbox" data-ch="pfpets" ${f.pets ? 'checked' : ''}> Pet-friendly</label>
          <label><input type="checkbox" data-ch="pfall" ${f.all ? 'checked' : ''}> Ignore the client's requirements</label>
          ${n ? '<button type="button" class="btn sm" data-act="pfclear">Clear all filters</button>' : ''}</div>
      </details>
      <div id="propsResults">${propsResultsHtml(l)}</div>`;
  }
  function propsResultsHtml(l) {
    const f = pfFor(l), matches = propResults(l), lim = S.pf.limit, book = canEdit('calendar'), ask = canAsk();
    const asked = new Set((askState(l).list || []).map((a) => a.listingId)), fb = f.all ? null : leadFeedback(l);
    return `${fb && fb.summary.length ? `<div class="fbhint" role="note"><b>From viewing feedback:</b> ${fb.summary.map(esc).join(' · ')} <span class="sub">(units that don't fit are hidden)</span></div>` : ''}
      <div class="sub" style="margin:10px 0 12px" role="status">${matches.length} ${f.all ? 'available' : 'matching'} ${DEMO ? 'demo ' : ''}listing${matches.length === 1 ? '' : 's'}${pfCount(f) ? ' with your filters' : ''}, best match first. Hidden: not available${f.all || f.type ? '' : `, and ${l.inquiry === 'Rent' ? 'for sale' : 'for rent'} units`}. Ranked by location, budget (±15%), bedrooms and pets.${readOnlySource() ? ' Booking is off for read-only Monday data.' : ''}</div>
      ${matches.length ? `<div class="lgrid">${matches.slice(0, lim).map(([x, m]) => listingCard(x, { score: m.score, chips: m.chips,
        action: [book ? `<button class="btn sm" data-act="book" data-id="${esc(x.id)}">📅 Book Viewing</button>` : '',
          ask ? (asked.has(x.id) ? `<button class="btn sm ghost" data-act="tab" data-v="asking">✓ In Asking for Availability</button>` : `<button class="btn sm" data-act="askadd" data-id="${esc(x.id)}">❓ Ask availability</button>`) : ''].join(' ') })).join('')}</div>
        ${matches.length > lim ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="pfmore">Show more (${matches.length - lim} left)</button></div>` : ''}`
        : `<div class="empty">No listings match.${pfCount(f) ? ' <button class="linkbtn" data-act="pfclear">Clear all filters</button>' : ''}</div>`}`;
  }
  const renderPropsResults = () => { const l = leadById(S.open), box = $('#propsResults'); if (l && box) box.innerHTML = propsResultsHtml(l); };
  const PF_IN = { pfq: 'q', pfmin: 'priceMin', pfmax: 'priceMax' };
  /** Redraws the Properties tab and puts focus back on the control that changed. */
  function refreshPropsPanel(l, focusSel) {
    if (S.open !== l.id || S.tab !== 'props') return;
    const b = $('#dbody'), y = b ? b.scrollTop : 0;
    renderDrawerBody(); if (b) b.scrollTop = y;
    const el = focusSel && $('#dbody ' + focusSel); if (el) el.focus({ preventScroll: true });
  }
  /** One filter changed. Typed fields redraw only the results, so the cursor stays where it is. */
  function pfSet(k, v, typed) {
    const l = leadById(S.open); if (!l) return;
    const f = pfFor(l); f[k] = v; S.pf.limit = 24; S.pfOpen = true;
    if (typed) { renderPropsResults(); const s = $('#dbody .pfbox summary'); if (s) { const n = pfCount(f); s.innerHTML = `🔎 <b>Search properties yourself</b>${n ? ` <span class="pill" style="--c:var(--accent)">${n} filter${n === 1 ? '' : 's'} on</span>` : ''}`; } }
    else refreshPropsPanel(l, `[data-ch="${{ type: 'pftype', furnishing: 'pffurn', pets: 'pfpets', all: 'pfall' }[k]}"]`);
  }

  // ---- Asking for Availability: units the VA is checking with owners (MongoDB / this browser; nothing is sent) ----
  const canAsk = () => access('leads') === 'edit';
  const leadSrc = () => (DEMO ? 'demo' : S.source === 'monday' ? 'monday' : 'mongo');
  const askKey = (l) => leadSrc() + ':' + l.id;
  function askState(l) { S.asking = S.asking || {}; return S.asking[askKey(l)] || {}; }
  async function loadAsking(l, force) {
    const k = askKey(l), cur = (S.asking = S.asking || {})[k];
    // after an error only "Try again" (force) loads again; redraws never refetch in a loop. A forced load always runs and
    // the newest one wins, so a slower earlier reply can't overwrite it
    if (cur && !force && (cur.loading || cur.list || cur.error)) return;
    const seqs = S.askSeq = S.askSeq || {}, seq = seqs[k] = (seqs[k] || 0) + 1;   // per lead
    S.asking[k] = { loading: true, list: cur && cur.list };
    let next;
    try { next = { list: await backend.askList(l) }; } catch (e) { if (signedOut(e)) return; next = { error: e.message }; }
    if (seq !== seqs[k]) return;
    S.asking[k] = next;
    if (S.open === l.id) { if (S.tab === 'asking') renderDrawerBody(); else if (S.tab === 'props') renderPropsResults(); updateAskTab(l); }
  }
  function updateAskTab(l) { const t = $('#drawer .tab[data-v="asking"]'); if (t) t.textContent = askTabLabel(l); }
  const askTabLabel = (l) => { const n = (askState(l).list || []).filter((a) => a.status === 'asking').length; return 'Asking for Availability' + (n ? ` (${n})` : ''); };
  const ASK_ST = { asking: ['Asking owner', '#d29922'], available: ['Owner confirmed available', '#3fb950'], unavailable: ['Not available', '#8b949e'] };
  const VIA_LABEL = { call: 'Call', whatsapp: 'WhatsApp', viber: 'Viber' };
  function askingPanel(l) {
    const st = askState(l);
    if (!st.list) return st.error ? `<div class="src-err" role="alert">${esc(st.error)} <button class="linkbtn" data-act="askreload">Try again</button></div>` : '<div class="muted">Loading…</div>';
    const intro = `<div class="sub" style="margin-bottom:12px">Units you're checking with owners for this client. Saved ${DEMO ? 'in this browser (demo)' : 'in the portal (MongoDB)'}: nothing is written to Monday.com, and no message is sent. The Call / WhatsApp / Viber buttons open on your own device only when you tap them.</div>`;
    if (!st.list.length) return intro + `<div class="empty">No units here yet. On the Properties tab, press <b>❓ Ask availability</b> on a unit.${canAsk() ? ' <button class="linkbtn" data-act="tab" data-v="props">Go to Properties</button>' : ''}</div>`;
    const edit = canAsk();
    return intro + `<div class="asklist">${st.list.map((a) => {
      const x = listingById(a.listingId), links = x && SH.contactLinks(x.contactPhone), log = a.contacts || [], last = log[log.length - 1];
      const [label, color] = ASK_ST[a.status] || ASK_ST.asking;
      const via = (k, icon) => links ? `<a class="btn sm" href="${esc(links[k])}" ${k === 'whatsapp' ? 'target="_blank" rel="noopener noreferrer"' : ''} data-act="askcontact" data-rid="${esc(a.id)}" data-via="${k}" aria-label="${esc(VIA_LABEL[k] + ' the owner of ' + (x ? x.building : a.listingName))}">${icon} ${VIA_LABEL[k]}</a>` : '';
      return `<div class="askcard"><div class="ask-h"><div style="min-width:0"><b>${esc(x ? x.building : a.listingName || 'Listing ' + a.listingId)}</b>
          <div class="sub">${esc([x && x.code, x && x.city, x && money(x.price)].filter(Boolean).join(' · ') || 'This listing is no longer on the board')}</div></div>${pill(label, color)}</div>
        <div class="ask-owner"><span class="sub">Owner: ${esc((x && x.contact) || '—')}${links ? ' · ' + esc(links.number) : ''}</span>
          ${links ? `<div class="ask-links">${via('call', '📞')}${via('whatsapp', '💬')}${via('viber', '📳')}</div>` : '<div class="sub">No owner number on this listing, so there are no call / WhatsApp / Viber links. Add it on the Listings board.</div>'}
          ${last ? `<div class="sub" style="font-size:11.5px">Last contact: ${esc(VIA_LABEL[last.via])} · ${esc(last.by || '')} · ${esc(ago(last.at))}</div>` : ''}</div>
        ${edit ? `<div class="ask-act">${a.status !== 'available' ? `<button class="btn sm primary" data-act="askstatus" data-rid="${esc(a.id)}" data-v="available">✓ Owner confirmed available</button>` : ''}
          ${a.status !== 'unavailable' ? `<button class="btn sm" data-act="askstatus" data-rid="${esc(a.id)}" data-v="unavailable">✕ Not available</button>` : ''}
          ${a.status !== 'asking' ? `<button class="btn sm ghost" data-act="askstatus" data-rid="${esc(a.id)}" data-v="asking">↺ Still asking</button>` : ''}
          <button class="linkbtn" data-act="askdel" data-rid="${esc(a.id)}">Remove</button></div>` : ''}</div>`; }).join('')}</div>
      <div class="foot-note">Up to ${SH.ASK.maxPerLead} units per lead; each unit is listed once.</div>`;
  }
  async function askDo(l, fn, okMsg) {
    const k = askKey(l);
    try { await fn(); } catch (e) { if (!signedOut(e)) toast(e.message || 'Something went wrong.', true); return; }
    if (okMsg) toast(okMsg);
    if (S.open === l.id) { if (S.tab === 'asking') renderDrawerBody(); else if (S.tab === 'props') renderPropsResults(); updateAskTab(l); }
    return S.asking[k];
  }
  function viewingsPanel(l, sts) {
    const list = leadViewings(l, sts), edit = canEdit('calendar');
    if (!list.length) return `<div class="empty">${sts[0] === 'Proposed' ? `Nothing to schedule yet.${canEdit('calendar') ? ' <button class="linkbtn" data-act="gobook">Book a viewing from Properties</button>' : ''}` : 'No viewings here yet.'}</div>`;
    return `<div class="panel"><table class="t"><thead><tr><th>Date</th><th>Time</th><th>Unit</th><th>Broker</th><th>Status</th><th>${sts[0] === 'Done' ? 'Broker feedback' : ''}</th></tr></thead><tbody>
      ${list.map((v) => { const x = unitOf(v); return `<tr><td>${esc(fmtShort(v.date))}</td><td>${esc(v.time || '—')}</td><td>${esc(x.building)}<div class="sub">${esc([x.code, x.city].filter(Boolean).join(' · '))}</div></td><td>${esc(v.broker || '—')}</td><td>${pill(v.status, VSTAT_COLORS[v.status])}${v.statusLabel && v.statusLabel !== v.status ? `<div class="sub">${esc(v.statusLabel)}</div>` : ''}</td>
        <td>${!edit ? esc(v.feedback || '') : v.status === 'Proposed' ? `<button class="btn sm" data-act="vstatus" data-id="${esc(v.id)}" data-v="Confirmed">Confirm Schedule</button> <button class="btn sm ghost danger" data-act="vstatus" data-id="${esc(v.id)}" data-v="Cancelled">Cancel</button>`
          : v.status === 'Confirmed' ? `<button class="btn sm" data-act="vstatus" data-id="${esc(v.id)}" data-v="Done">Mark Done</button> <button class="btn sm ghost danger" data-act="vstatus" data-id="${esc(v.id)}" data-v="Cancelled">Cancel</button>`
          : `<button class="linkbtn" data-act="viewing" data-id="${esc(v.id)}">${v.feedback ? esc(v.feedback.slice(0, 40)) : v.status === 'Done' ? 'Add feedback' : 'Details'}</button>`}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  function chatBubbles(msgs) {
    return `<div class="chat">${msgs.map((m) => `<div class="bub ${m.from === 'client' ? 'client' : 'va'}${m.failed ? ' failed' : ''}">${esc(m.text)}${m.url ? `<div><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(m.fileType || 'attachment')}</a></div>` : ''}<div class="meta">${esc(m.who || (m.from === 'client' ? 'Client' : 'VA'))} · ${esc(m.at ? ago(m.at) : '')}${m.failed ? ' · failed' : ''}</div></div>`).join('')}</div>`;
  }
  function chatPanel(l) {
    if (DEMO) {
      if (!l.onRespond) return '<div class="empty">No respond.io chat for this lead yet. (Creating chats is not connected in the preview.)</div>';
      return `<div class="sub" style="margin-bottom:10px">Sample conversation (demo). Live chat, translation, attachments and WhatsApp templates come from respond.io in the real portal.</div>${chatBubbles(l.chat)}`;
    }
    const r = S.integ && S.integ.respond;
    if (!r || !r.configured) return laterBox('Respond.io Chat', 'the conversation from respond.io. It is not connected: set RESPOND_TOKEN in preview/.env and restart to read chat history (read-only).');
    const c = S.chat[l.id];
    if (!c || c.loading) return '<div class="muted">Loading the respond.io conversation…</div>';
    if (c.error) return `<div class="src-err" role="alert">${esc(c.error)}</div>`;
    const ct = c.data.contact || {};
    return `<div class="sub" style="margin-bottom:10px">respond.io · read-only. ${esc([ct.name, ct.lifecycle, ct.assignee ? 'assigned to ' + ct.assignee : ''].filter(Boolean).join(' · '))}
        ${c.data.openUrl ? ` · <a href="${esc(c.data.openUrl)}" target="_blank" rel="noopener noreferrer">Open in respond.io</a>` : ''}${c.data.more ? ' · showing the latest 300 messages' : ''}</div>
      ${c.data.messages.length ? chatBubbles(c.data.messages) : '<div class="muted">No messages in this conversation.</div>'}`;
  }
  async function loadChat(l) {
    const r = S.integ && S.integ.respond; if (!r || !r.configured) return;
    if (S.chat[l.id] && !S.chat[l.id].error) return;
    if (!String(l.contactId || '').replace(/\D/g, '')) { S.chat[l.id] = { error: 'This lead has no respond.io contact ID (Respond ID).' }; return renderDrawerBody(); }
    S.chat[l.id] = { loading: true };
    try { S.chat[l.id] = { data: await API.get(`/api/respond/chat/${S.source === 'monday' ? 'monday' : 'mongo'}/${encodeURIComponent(l.id)}`) }; }
    catch (e) { if (signedOut(e)) return; S.chat[l.id] = { error: e.message }; }
    // the chat just read gives this lead (only) its reply status and Temperature
    const st = S.chat[l.id].data && S.chat[l.id].data.lead;
    if (st && S.source === 'monday') {
      Object.assign(l, st); IDX.delete(l);
      if (S.view === 'leads' && $('#list')) { const row = rowEl(l.id); if (row) { row.outerHTML = rowHtml(l); const r2 = rowEl(l.id); if (r2) r2.classList.add('sel'); } updateCounts(); renderSide(); }
    }
    refreshStatus();
    if (S.open === l.id && S.tab === 'chat') { renderDrawerBody(); const b = $('#dbody'); if (b) b.scrollTop = b.scrollHeight; }
  }

  // ---------- VA Portal / VA Management / Brokers / Renewals ----------
  function vaPending() {
    const out = [], vis = visibleLeads(), vv = visibleViewings();
    vis.filter((l) => l.onRespond && l.waiting === 'va' && !['Failed'].includes(l.ai)).forEach((l) => out.push([l, 'Reply to client', 'Needs VA Reply']));
    vv.filter((v) => v.status === 'Proposed').forEach((v) => { const l = leadById(v.leadId); if (l) out.push([l, 'Confirm schedule', fmtShort(v.date) + ' ' + v.time]); });
    vis.filter((l) => l.ai === 'Property Matching' && l.daysInStage > 14).forEach((l) => out.push([l, 'Send more units', l.daysInStage + ' days in Property Matching']));
    return out;
  }
  function vaPortalView() {
    const rows = vaPending();
    return `<div class="cards">${['Reply to client', 'Confirm schedule', 'Send more units'].map((k) => `<div class="card"><div class="n">${rows.filter((r) => r[1] === k).length}</div><div class="l">${k}</div></div>`).join('')}</div>
      <div class="panel"><h3>Pending actions <span class="muted">${rows.length} items · ${SRC}</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Lead</th><th>Client</th><th>VA</th><th>Action</th><th>Detail</th><th>AI Status</th></tr></thead><tbody>
      ${rows.map(([l, a, d]) => `<tr class="click" data-act="open" data-id="${esc(l.id)}"><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.va || 'Unassigned')}</td><td><b>${esc(a)}</b></td><td>${esc(d)}</td><td>${aiPill(l)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing pending.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function monitorView() {
    const vis = visibleLeads(), vv = visibleViewings(), vas = isManager() ? LISTS.vas : [me().vaLabel].filter(Boolean);
    const rows = vas.map((va) => { const ls = vis.filter((l) => l.va === va), ids = new Set(ls.map((l) => l.id));
      return [va, ls.length, ls.filter((l) => l.waiting === 'va' && l.onRespond).length, ls.filter((l) => l.temp === 'Hot').length,
        vv.filter((v) => ids.has(v.leadId) && v.status !== 'Cancelled').length, ls.filter((l) => LEAD_PLUS.includes(l.ai)).length, ls.filter((l) => l.ai === 'Failed').length]; });
    const needs = vis.filter((l) => l.onRespond && l.waiting === 'va').length;
    return `<div class="cards"><div class="card"><div class="n">${needs}</div><div class="l">Needs VA Reply</div></div><div class="card"><div class="n">${vis.filter((l) => l.onRespond && l.waiting === 'client').length}</div><div class="l">Waiting on Client</div></div>
        <div class="card"><div class="n">${vis.filter((l) => !l.va).length}</div><div class="l">Unassigned leads</div></div><div class="card"><div class="n">${vis.filter((l) => l.temp === 'Hot').length}</div><div class="l">🔥 Hot leads</div></div></div>
      <div class="panel"><h3>Response monitor &amp; KPIs per VA <span class="muted">${SRC} · response times and scores come from respond.io in the live portal</span></h3>
      <div class="scroll-x"><table class="t"><thead><tr><th>VA</th><th class="num">Leads</th><th class="num">Needs reply</th><th class="num">Hot</th><th class="num">Viewings</th><th class="num">LOI or later</th><th class="num">Failed</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" data-act="filterva" data-v="${esc(r[0])}"><td><b>${esc(r[0])}</b></td>${r.slice(1).map((n, i) => `<td class="num ${i === 1 && n ? 'hotnum' : ''}">${n}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function brokersView() {
    const rows = LISTS.brokers.map((b) => { const vs = D.calendar.filter((v) => v.broker === b), ids = new Set(vs.map((v) => v.leadId)), ls = D.leads.filter((l) => ids.has(l.id));
      return [b, vs.filter((v) => v.status !== 'Cancelled').length, ids.size, vs.filter((v) => v.status === 'Done' && !v.feedback).length, ls.filter((l) => LEAD_PLUS.includes(l.ai)).length, ls.filter((l) => ['Active', 'For Renewal'].includes(l.ai)).length]; });
    return `<div class="panel"><h3>Brokers <span class="muted">${SRC}</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Broker</th><th class="num">Viewings</th><th class="num">Unique clients</th><th class="num">Pending feedback</th><th class="num">LOIs or later</th><th class="num">Closed</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r[0])}</b></td>${r.slice(1).map((n, i) => `<td class="num ${i === 2 && n ? 'hotnum' : ''}">${n}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }
  function renewalsView() {
    const rows = visibleLeads().filter((l) => l.leaseEnd).sort((a, b) => a.leaseEnd.localeCompare(b.leaseEnd));
    return `<div class="cards"><div class="card"><div class="n">${rows.filter((l) => daysUntil(l.leaseEnd) <= 30).length}</div><div class="l">Due within 30 days (or overdue)</div></div><div class="card"><div class="n">${rows.length}</div><div class="l">Active leases</div></div></div>
      <div class="panel"><h3>Leases &amp; due dates <span class="muted">renewal messaging is not connected in the preview</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Lead</th><th>Client</th><th>AI Status</th><th>Lease end</th><th class="num">Days left</th><th class="num">Monthly</th><th>VA</th></tr></thead><tbody>
      ${rows.map((l) => { const d = daysUntil(l.leaseEnd); return `<tr class="click" data-act="open" data-id="${esc(l.id)}"><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${aiPill(l)}</td><td>${esc(fmtDate(l.leaseEnd))}</td><td class="num ${d <= 30 ? 'hotnum' : ''}">${d}</td><td class="num">${esc(money(l.budget) || '—')}</td><td>${esc(l.va || '—')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No active leases.</td></tr>'}
      </tbody></table></div></div>`;
  }

  // ---------- Calendar ----------
  function calendarView() {
    const m = S.calMonth || (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
    S.calMonth = m;
    const start = new Date(m); start.setDate(1 - m.getDay());
    let vv = visibleViewings(); if (S.calBroker) vv = vv.filter((v) => v.broker === S.calBroker);
    const byDay = {}; vv.forEach((v) => { (byDay[v.date] = byDay[v.date] || []).push(v); });
    const t = today(); let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d);
      const evs = (byDay[k] || []).sort((a, b) => String(a.time).localeCompare(String(b.time)));
      cells += `<div class="day ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${k === t ? 'today' : ''}"><span class="dn">${d.getDate()}</span>
        ${evs.slice(0, 4).map((v) => { const l = leadById(v.leadId) || {}, x = unitOf(v); return `<button class="ev" style="--c:${VSTAT_COLORS[v.status]}" data-act="viewing" data-id="${esc(v.id)}" title="${esc([v.time, l.name, x.building, v.status].filter(Boolean).join(' · '))}">${esc(v.time)} ${esc(l.code || x.building || '')}</button>`; }).join('')}
        ${evs.length > 4 ? `<span class="sub">+${evs.length - 4} more</span>` : ''}</div>`;
    }
    const inMonth = vv.filter((v) => { const d = parseYmd(v.date); return d && d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); });
    if (!S.pend || (!S.pend.loading && Date.now() - S.pend.at > 60e3)) setTimeout(loadPending, 0);
    return `<div class="cal-layout"><div class="cal-main"><div class="cal-head"><h2>${m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <button class="btn sm" data-act="calmove" data-v="-1" aria-label="Previous month">‹</button><button class="btn sm" data-act="calmove" data-v="0">Today</button><button class="btn sm" data-act="calmove" data-v="1" aria-label="Next month">›</button>
        ${me().role !== 'Broker' ? `<select data-ch="calbroker" style="padding:5px 8px"><option value="">All brokers</option>${LISTS.brokers.map((b) => `<option ${S.calBroker === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : ''}
        <span class="spacer"></span><span class="legend">${LISTS.viewingStatuses.map((s) => `<span><span class="dot" style="background:${VSTAT_COLORS[s]}"></span> ${s} ${inMonth.filter((v) => v.status === s).length}</span>`).join('')}</span></div>
      <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>
      <div class="agenda" aria-label="Viewings this month">${inMonth.length ? inMonth.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((v) => { const l = leadById(v.leadId) || {}, x = unitOf(v);
        return `<button type="button" class="ag-item ${v.date === t ? 'today' : ''}" data-act="viewing" data-id="${esc(v.id)}"><span class="ag-date">${esc(fmtShort(v.date))}<b>${esc(v.time || '—')}</b></span>
          <span class="ag-main"><b>${esc(l.code || '')} ${esc(l.name || '')}</b><span class="sub">${esc([x.building, x.city, v.broker].filter(Boolean).join(' · '))}</span></span>${pill(v.status, VSTAT_COLORS[v.status])}</button>`; }).join('') : '<div class="empty">No viewings this month.</div>'}</div>
      <div class="foot-note">${viewSrc() === 'monday' ? 'Viewings from the Monday Calendar board (Final Schedule). A result you record sets the viewing\'s Status on Monday; its reasons and broker feedback are kept in the portal.'
        : `Portal bookings (${SRC}). The live portal also shows the Monday Final Schedule for dates before 12 Oct 2026.`}</div></div>
      <aside class="pfb" id="pendingFb" aria-label="Pending broker feedback">${pendingHtml()}</aside></div>`;
  }

  // ---------- Pending Broker Feedback (Code.gs pendingFeedback_; server: src/integrations/viewingResult.js) ----------
  /** Where this page's viewings come from: a portal booking ('mongo'), the Monday Calendar board ('monday') or 'demo'. */
  const viewSrc = () => (DEMO ? 'demo' : S.source === 'monday' ? 'monday' : 'mongo');
  /** '' when this user may record a viewing's result here, else why not (shown in the dialog). */
  function resultBlock() {
    return access('calendar') !== 'edit' ? 'You have view-only access to the Calendar.' : '';
  }
  /** Create LOI on a Monday Calendar viewing sets its Status on Monday, so it needs Monday writes on. '' = allowed. */
  const loiBlock = () => (viewSrc() === 'monday' && !mondayWritesOn() ? 'Monday updates are switched off on this server, so Create LOI (which sets the Calendar Status on Monday) can\'t be saved; Failed can.' : '');
  // the Calendar Status Create LOI sets on Monday (server: viewingResult.js CAL.status.labels); Failed changes nothing there
  const MONDAY_RESULT = { loi: 'Under Negotiations' };
  const resultOf = (v) => v.result || (v.outcome ? { outcome: v.outcome, tags: v.feedbackTags || [], feedback: v.feedback || '', loiConf: v.loiConf || null, by: v.outcomeBy || '', at: v.outcomeAt || '' } : null);
  async function loadPending() {
    if ((!DEMO && !S.user) || !canSee('calendar')) return;
    const token = S.srcToken, src = viewSrc();
    S.pend = { ...(S.pend || { rows: [], errors: {}, at: 0 }), loading: true };
    try {
      if (DEMO) {
        const now = Date.now();
        S.pend = { rows: visibleViewings().filter((v) => SH.portalPending(v, now)).map((v) => { const x = unitOf(v); return { src: 'demo', id: v.id, leadId: v.leadId, date: v.date, time: v.time, when: SH.viewingAt(v), broker: v.broker, status: v.status, unit: { building: x.building, city: x.city, code: x.code } }; })
          .sort((a, b) => b.when - a.when), errors: {}, at: now, loading: false };
      } else {
        const r = await API.get('/api/calendar/pending');
        if (token !== S.srcToken || src !== viewSrc()) {
          // the data was reloaded meanwhile: never leave the panel "Loading…"; ask again for the data now on screen
          if (S.pend) S.pend.loading = false;
          if (src === viewSrc()) loadPending();
          return;
        }
        S.pend = { rows: r.rows || [], errors: r.errors || {}, notice: r.scopeNotice || '', at: Date.now(), loading: false };
      }
    } catch (e) { if (signedOut(e)) return; S.pend = { rows: [], errors: { all: e.message }, at: Date.now(), loading: false }; }
    const box = $('#pendingFb'); if (box) box.innerHTML = pendingHtml();
    renderSide();
  }
  function pendingHtml() {
    const p = S.pend || { rows: [], errors: {} }, rows = p.rows || [], here = viewSrc(), block = resultBlock();
    const errs = Object.values(p.errors || {});
    const head = `<div class="pfb-head"><h3>Pending Broker Feedback</h3>${p.at ? `<span class="pill" style="--c:${rows.length ? '#d29922' : '#3fb950'}">${rows.length}</span>` : ''}</div>
      <div class="sub">Viewings that happened (from 12 Oct 2026, the last 60 days) with no result yet.</div>`;
    if (!p.at) return head + '<div class="empty">Loading…</div>';
    const list = rows.map((r) => {
      const local = r.src === here, l = local ? leadById(r.leadId) : null, v = local ? D.calendar.find((x) => x.id === r.id) : null;
      const who = l ? `${esc(l.code || '')} · ${esc(l.name || '')}` : esc(r.src === 'monday' ? 'Monday Calendar viewing' : 'Portal booking');
      return `<div class="pfb-row" data-key="${esc(r.src + ':' + r.id)}"><div class="pfb-main"><b>${esc(fmtShort(r.date))} ${esc(r.time || '')}</b> · ${esc([r.unit.building, r.unit.city].filter(Boolean).join(', ') || 'Unit')}
          <div class="sub">${who}${r.broker ? ' · ' + esc(r.broker) : ''}${r.status ? ' · ' + esc(r.status) : ''}</div></div>
        <div class="pfb-act">${l ? `<button type="button" class="btn sm" data-act="pfbopen" data-id="${esc(l.id)}">Open client</button>` : ''}
          ${v && !block ? `${loiBlock() ? '' : `<button type="button" class="btn sm" data-act="pfbres" data-id="${esc(v.id)}" data-v="loi">📄 Create LOI</button>`}<button type="button" class="btn sm" data-act="pfbres" data-id="${esc(v.id)}" data-v="failed">✕ Failed</button>` : ''}
          ${!local ? `<span class="sub">Switch the data source to ${r.src === 'monday' ? 'Monday.com' : 'MongoDB'} to record it.</span>` : ''}</div></div>`;
    }).join('');
    return head + (errs.length ? `<div class="src-err" role="alert">${esc(errs[0])}</div>` : '') + (p.notice ? `<div class="sub vwhy" role="note">${esc(p.notice)}</div>` : '') + (block && rows.length ? `<div class="sub" role="note">${esc(block)}</div>` : '')
      + (rows.length ? `<div class="pfb-list">${list}</div>` : '<div class="empty">Nothing waiting for feedback.</div>');
  }
  /** Feedback from this client's viewings (results recorded on viewings that happened) → rules for the property suggestions. */
  function leadFeedback(l) {
    const entries = visibleViewings().filter((v) => v.leadId === l.id).map((v) => {
      const r = resultOf(v);
      if (v.result) return { tags: r.tags, feedback: r.feedback, name: v.building, building: v.building, location: SH.canonCity(v.city, v.building) || v.city };
      // portal bookings: every Done viewing with reasons or feedback (as Code.gs feedbackPrefs_ reads the portal viewings)
      const tags = (r && r.tags) || [], text = v.feedback || '';
      if (v.status !== 'Done' || (!tags.length && !text)) return null;
      const x = listingById(v.listingId) || {};
      return { tags, feedback: text, name: x.building, price: x.price, sqm: x.sizeSqm, bedrooms: x.bedrooms, building: x.building, location: x.city };
    }).filter(Boolean);
    return SH.feedbackPrefs(entries);
  }

  // ---------- Inventory Dashboard (also the property browser) ----------
  /**
   * Cities for the inventory: the usual ones first, then any other city the listings are in, then "City not set".
   * Each listing has exactly one city (set when it was read; BGC towers and "Taguig" are both "Taguig (BGC)"),
   * so the rows add up to the total and nothing is counted twice.
   */
  function invCities() {
    const n = {}; D.listings.forEach((x) => { const c = x.city || 'City not set'; n[c] = (n[c] || 0) + 1; });
    const extra = Object.keys(n).filter((c) => !LISTS.cities.includes(c) && c !== 'City not set').sort((a, b) => n[b] - n[a] || a.localeCompare(b));
    return LISTS.cities.concat(extra, n['City not set'] ? ['City not set'] : []);
  }
  function invView() {
    const L = D.listings, f = S.inv, opt = (v, cur) => `<option ${cur === v ? 'selected' : ''}>${esc(v)}</option>`, cityOf = (x) => x.city || 'City not set';
    const byCity = invCities().map((c) => { const xs = L.filter((x) => cityOf(x) === c); return [c, xs.length, xs.filter((x) => x.type === 'For Rent').length, xs.filter((x) => x.type === 'For Sale').length, xs.filter((x) => x.availability === 'Available').length]; });
    const tg = L.filter((x) => x.city === 'Taguig (BGC)');
    return `<div class="cards"><div class="card"><div class="n">${L.length}</div><div class="l">Listings</div></div>
        <div class="card" title="Listings whose City is Taguig or BGC, or with no City but a BGC building; each listing counted once"><div class="n">${tg.length}</div><div class="l">Taguig (BGC) · ${tg.filter((x) => x.availability === 'Available').length} available</div></div>
        ${LISTS.availability.map((a) => `<div class="card"><div class="n">${L.filter((x) => x.availability === a).length}</div><div class="l">${a}</div></div>`).join('')}
        <div class="card"><div class="n">${L.filter((x) => x.type === 'For Rent').length} / ${L.filter((x) => x.type === 'For Sale').length}</div><div class="l">For rent / for sale</div></div></div>
      <div class="panel"><h3>By city <span class="muted">${SRC}</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>City</th><th class="num">Listings</th><th class="num">For rent</th><th class="num">For sale</th><th class="num">Available</th></tr></thead><tbody>
        ${byCity.map((r) => `<tr class="click" data-act="invcity" data-v="${esc(r[0])}"><td>${esc(r[0])}</td>${r.slice(1).map((n) => `<td class="num ${n ? '' : 'zero'}">${n}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="panel"><h3>Listings</h3><div class="pad">
        <div class="toolbar"><div class="search">${P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<input data-in="invq" value="${esc(f.q)}" placeholder="Search building or listing ID…" autocomplete="off"></div>
          <select data-ch="invcity"><option value="">All cities</option>${invCities().map((c) => opt(c, f.city)).join('')}</select>
          <select data-ch="invtype"><option value="">Rent &amp; sale</option>${opt('For Rent', f.type)}${opt('For Sale', f.type)}</select>
          <select data-ch="invbeds"><option value="">Bedrooms</option>${LISTS.bedrooms.map((b) => opt(b, f.beds)).join('')}</select>
          <select data-ch="invavail"><option value="">Any availability</option>${LISTS.availability.map((a) => opt(a, f.avail)).join('')}</select></div>
        <div class="sub" id="invCount" style="margin-bottom:10px"></div><div class="lgrid" id="invGrid"></div></div></div>`;
  }
  function renderInventory() {
    const f = S.inv, q = f.q.trim().toLowerCase();
    const xs = D.listings.filter((x) => (!q || (x.building + ' ' + x.code).toLowerCase().includes(q)) && (!f.city || (x.city || 'City not set') === f.city) && (!f.type || x.type === f.type) && (!f.beds || x.bedrooms === f.beds) && (!f.avail || x.availability === f.avail));
    const edit = canEdit('invdash');
    $('#invCount').textContent = `${xs.length} of ${D.listings.length} ${DEMO ? 'demo ' : ''}listings`;
    // drawn in pages, so a board with thousands of listings doesn't ask for thousands of photos at once
    const lim = S.inv.limit || 120, mwa = mwAction('listingAvailability');
    // Monday listings: the board's own Availability labels, updated on Monday after a confirmation (when switched on)
    const mwSelect = (x) => `<label class="mwavail"><span class="sub">Availability on Monday</span><select data-ch="mwavail" data-id="${esc(x.id)}" aria-label="Availability on Monday">${x.availabilityLabel && !mwa.labels.includes(x.availabilityLabel) ? `<option selected value="">${esc(x.availabilityLabel)} (current)</option>` : !x.availabilityLabel ? '<option selected value="">(not set)</option>' : ''}${mwa.labels.map((a) => `<option ${x.availabilityLabel === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>`;
    $('#invGrid').innerHTML = (xs.slice(0, lim).map((x) => listingCard(x, { action: mwa ? mwSelect(x) : edit ? `<select data-ch="avail" data-id="${esc(x.id)}" style="padding:5px 8px;font-size:12.5px" aria-label="Availability">${LISTS.availability.map((a) => `<option ${x.availability === a ? 'selected' : ''}>${a}</option>`).join('')}</select>` : '' })).join('') || '<div class="empty">No listings match.</div>')
      + (xs.length > lim ? `<div style="grid-column:1/-1;text-align:center"><button class="btn" data-act="invmore">Show more (${xs.length - lim} left)</button></div>` : '');
  }

  // ---------- Leads Report / Daily Report ----------
  function ldashView() {
    const vis = visibleLeads(), counted = vis.filter(countsInReports);
    const table = (title, keys, keyOf) => `<div class="panel"><h3>${title}</h3><table class="t"><thead><tr><th></th><th class="num">Leads</th><th class="num">Counted</th><th class="num">LOI or later</th><th class="num">Failed</th></tr></thead><tbody>
      ${keys.map((k) => { const ls = vis.filter((l) => keyOf(l) === k); return `<tr><td>${esc(k || 'Unassigned')}</td><td class="num">${ls.length}</td><td class="num">${ls.filter(countsInReports).length}</td><td class="num">${ls.filter((l) => LEAD_PLUS.includes(l.ai)).length}</td><td class="num">${ls.filter((l) => l.ai === 'Failed').length}</td></tr>`; }).join('')}</tbody></table></div>`;
    return `<div class="cards"><div class="card"><div class="n">${vis.length}</div><div class="l">All leads</div></div>
        <div class="card"><div class="n">${counted.length}</div><div class="l">Counted in reports</div></div>
        <div class="card"><div class="n">${vis.filter((l) => Date.now() - new Date(l.createdAt) < 7 * 864e5).length}</div><div class="l">New in the last 7 days</div></div>
        <div class="card"><div class="n">${vis.filter((l) => ['Active', 'For Renewal'].includes(l.ai)).length}</div><div class="l">Active clients</div></div>
        <div class="card"><div class="n">${money(counted.reduce((a, l) => a + (l.budget || 0), 0)) || '₱0'}</div><div class="l">Counted lead value</div></div></div>
      <div class="sub" style="margin-bottom:12px">Minimum budget rule: rent below ₱200k/month or sale below ₱20M is not counted; unknown budgets are counted.</div>
      <div class="cols2">${table('By AI Status', AI_STAGES, (l) => l.ai)}${table('By source', LISTS.sources, (l) => l.source)}</div>
      ${isManager() ? table('By VA', LISTS.vas.concat(['']), (l) => l.va) : ''}`;
  }
  // client names, codes, phones, emails and free-text notes never go in broker-group messages: numeric lead IDs only (daily-report.js)
  const dailyText = () => window.BH_DAILY.buildDaily({ leads: visibleLeads(), viewings: visibleViewings(), listings: D.listings,
    today: today(), tomorrow: ymd(new Date(Date.now() + 864e5)), demo: DEMO });
  function dailyView() {
    return `<div class="panel"><h3>Daily Report <span class="muted">for the broker group · numeric lead IDs only, no client names, numbers or notes</span><span class="spacer"></span><button class="btn sm" data-act="copydaily">Copy text</button></h3><pre class="report" id="drText">${esc(dailyText())}</pre></div>
      <div class="sub">Posting to the broker group is not connected in the preview.</div>`;
  }
  // ---------- Property Requirements (read-only text for the broker channel; rules in prop-report.js) ----------
  const PR = window.BH_PROPREPORT;
  const prDate = () => (SH.isYmd(S.prDate) ? S.prDate : today());
  const propReqText = () => PR.buildReport(visibleLeads(), prDate());
  function propReqView() {
    const list = PR.sourcingLeads(visibleLeads()), rent = list.filter((l) => l.inquiry === 'Rent').length, sale = list.filter((l) => l.inquiry === 'Buy').length;
    return `<div class="cards"><div class="card"><div class="n">${list.length}</div><div class="l">Active leads in Property Matching</div></div>
        <div class="card"><div class="n">${rent}</div><div class="l">Rent</div></div><div class="card"><div class="n">${sale}</div><div class="l">Sale</div></div></div>
      <div class="panel"><h3>Property Requirements <span class="muted">preview of the text to paste in Viber · no client names, numbers or lead IDs</span></h3>
        <div class="pr-bar"><label class="pr-date">Report date <input type="date" data-ch="prdate" value="${esc(prDate())}" required></label>
          ${prDate() !== today() ? '<button type="button" class="btn" data-act="prtoday">Today</button>' : ''}<span class="spacer"></span>
          <button type="button" class="btn primary" id="prCopy" data-act="copypropreq">Copy report</button></div>
        <pre class="report" id="prText" aria-label="Report preview">${esc(propReqText())}</pre></div>
      <div class="sub">Included: leads you can see whose stage is <b>Property Matching</b> (from the Calendar, Monday AI STATUS and Next Action/Status, with or without a respond.io chat), unless the Temperature is Lost or Dead or the Client Status says closed/failed. The date only sets the heading; the leads are today's records.
        Missing details, including a pet preference that was never given, show “${esc(PR.NA)}”. Building, SQM, bathrooms, parking and furnishing are edited under <b>Unit Preferences</b> in each lead's details.${DEMO ? ' <b>This is fictional demo data.</b>' : ''} Nothing is sent to Viber.</div>`;
  }
  // ---------- Client Requirements (read-only daily message; rules in client-req.js, eligibility shared with prop-report.js) ----------
  const CR = window.BH_CLIENTREQ;
  const clientReqText = () => CR.buildMessage(visibleLeads(), CR.businessYmd());
  function clientReqView() {
    const list = CR.clients(visibleLeads()), rent = list.filter((l) => l.inquiry === 'Rent').length, sale = list.filter((l) => l.inquiry === 'Buy').length;
    return `<div class="cards"><div class="card"><div class="n">${list.length}</div><div class="l">Active clients in Property Sourcing</div></div>
        <div class="card"><div class="n">${rent}</div><div class="l">Rent</div></div><div class="card"><div class="n">${sale}</div><div class="l">Sale</div></div></div>
      <div class="panel"><h3>Client Requirements <span class="muted">today's message · clients are numbered, no names, numbers, emails or lead IDs</span></h3>
        <div class="pr-bar"><span class="sub">For ${esc(PR.dateLabel(CR.businessYmd()))} (Manila time)</span><span class="spacer"></span>
          <button type="button" class="btn primary" id="crCopy" data-act="copyclientreq">Copy message</button></div>
        <pre class="report" id="crText" aria-label="Message preview">${esc(clientReqText())}</pre></div>
      <div class="sub">Included: clients you can see who are active and in <b>Property Sourcing</b> (stage Property Matching, with or without a respond.io chat), the same clients as Property Requirements. Excluded: Lost or Dead Temperature, and closed / failed Client Status, including a portal Failed override.
        Building Name appears only when one was given; other missing details show “${esc(CR.NA)}”. Furnishing and pets are listed for rentals only.${DEMO ? ' <b>This is fictional demo data.</b>' : ''} Nothing is sent anywhere: copy the message and paste it yourself.</div>`;
  }
  /** Copies with the Clipboard API; falls back to a hidden textarea where that API isn't available. */
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { if (!document.execCommand('copy')) throw new Error('copy refused'); } finally { ta.remove(); }
  }

  // ---------- Settings ----------
  function settingsView() {
    const tabs = [['team', 'Team & Access'], ['files', 'Files'], ['wa', 'WhatsApp Templates'], ['integ', 'Integrations'], ['sync', 'Monday Sync']];
    const body = S.setTab === 'wa' ? waView() : S.setTab === 'files' ? laterBox('Files (LOI templates)', 'upload the Lease and Sale LOI templates, stored in Google Drive.')
      : S.setTab === 'integ' ? integView()
      : S.setTab === 'sync' ? laterBox('Monday Sync', 'AI STATUS write-back and client subitem sync to Monday.com. All Monday writes are switched off in this preview.') : teamView();
    return `<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button class="btn ${S.setTab === k ? 'on' : ''}" role="tab" aria-selected="${S.setTab === k}" data-act="settab" data-v="${k}">${esc(l)}</button>`).join('')}</div>${body}`;
  }
  function integView() {
    if (DEMO) return `<div class="panel"><div class="pad"><div class="later-box"><b>Integrations are off in demo mode.</b><br>Demo mode only uses fictional data in this browser.
      Read-only Monday.com and respond.io access is available in MongoDB mode after signing in, once the tokens are set in preview/.env (see README).</div></div></div>`;
    const st = S.integ || {}, m = st.monday || {}, r = st.respond || {};
    const when = (x) => (x ? esc(ago(x)) : '—');
    const row = (name, s, vars, reads) => `<tr><td><b>${name}</b></td><td>${istChip('', s).replace('>: ', '>')}</td><td style="white-space:normal">${reads}</td>
      <td><code>${vars.join('</code><br><code>')}</code></td><td>${when(s.lastOkAt)}</td><td style="white-space:normal;max-width:280px" class="${s.lastError ? 'hotnum' : ''}">${esc(s.lastError || '—')}${s.lastErrorAt ? `<div class="sub">${when(s.lastErrorAt)}</div>` : ''}</td></tr>`;
    const boards = m.boards || {};
    const t = S.mTest;
    return `<div class="panel"><h3>Integrations <span class="muted">${mondayWritesOn() ? 'reads, plus the allowlisted Monday updates you confirm' : 'read-only'} · credentials are read from preview/.env on the server and never sent to the browser</span><span class="spacer"></span>
        <button class="btn sm" data-act="integstatus">Refresh status</button>${canEdit('team') && m.configured ? ' <button class="btn sm" data-act="mtest">Test Monday connection</button>' : ''}</h3>
      <div class="scroll-x"><table class="t"><thead><tr><th>Service</th><th>Status</th><th>Reads (this phase)</th><th>Environment variables</th><th>Last success</th><th>Last error</th></tr></thead><tbody>
        ${row('Monday.com', m, ['MONDAY_TOKEN', 'MONDAY_LEADS_BOARD_ID', 'MONDAY_LISTINGS_BOARD_ID', 'MONDAY_CALENDAR_BOARD_ID'], `Leads ${boards.leads ? '✓' : '✗'} · Listings ${boards.listings ? '✓' : '✗'} · Calendar ${boards.calendar ? '✓' : '✗'}<div class="sub">Lead fields and notes (updates), listings, calendar viewings</div>`)}
        ${row('respond.io', r, ['RESPOND_TOKEN', 'RESPOND_SPACE_ID (optional)'], 'Contact details and chat history for a lead\'s Respond ID')}
      </tbody></table></div>
      ${t ? `<div class="pad">${t.error ? `<div class="src-err" role="alert">${esc(t.error)}</div>` : `<div>Monday token user: <b>${esc(t.user || '—')}</b></div>${Object.entries(t.boards || {}).map(([k, b]) => `<div class="sub">${esc(k)} board: ${b == null ? 'not set' : b.found ? '✓ ' + esc(b.name) : '✗ not found or no access'}</div>`).join('')}
          <div class="sub">Broker feedback column (MONDAY_CALENDAR_FEEDBACK_COLUMN): ${!t.calendarFeedback ? 'not set — broker feedback stays in the portal' : t.calendarFeedback.valid ? `✓ “${esc(t.calendarFeedback.title)}” (text) — feedback is also copied there` : `✗ ${esc(t.calendarFeedback.problem)} Broker feedback stays in the portal.`}</div>`}</div>` : ''}
      <div class="pad sub">${mondayWritesOn() ? 'Monday updates are limited to listing Availability (Inventory edit access), four lead fields (Budget, Target Move-in Date, Inquiry Type, Nationality; Managers only), one confirmed field at a time, and a viewing\'s result in the Calendar (Calendar edit access: the Calendar item\'s Status, plus LOI Creation Date for an LOI). Still switched off: other Monday writes (AI STATUS, Client Status, subitems, new items, deleting), sending' : 'Switched off in this phase: Monday writes (AI STATUS, subitems, statuses, availability, new listings), sending'} respond.io messages or templates, creating contacts, webhooks and background jobs.
        Monday data is held in server memory for up to 5 minutes and is not saved to MongoDB.</div></div>`;
  }
  const MOD_KEYS = VIEWS.map((v) => v[0]).filter((k) => !MOD_ALIAS[k]);
  /** VA Assigned / Salesperson labels: from the Monday board when connected (mongo mode), else the preview's lists. */
  function loadTeamLabels() {
    if (DEMO || S.teamLabels || S.teamLabelsBusy) return;
    S.teamLabelsBusy = true;
    API.get('/api/team/labels').then((r) => { S.teamLabels = r; }, (e) => { if (!signedOut(e)) S.teamLabels = { source: 'error', error: e.message, va: [], salesperson: [] }; })
      .finally(() => { S.teamLabelsBusy = false; if (S.view === 'team' && (S.setTab || 'team') === 'team') renderView(); });
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const vaChoices = () => [...new Set(LISTS.vas.concat(!DEMO && S.teamLabels ? S.teamLabels.va || [] : []))];
  // a Broker's exact Monday Salesperson label (Leads and Calendar boards); the preview's fictional list when not connected
  const salesChoices = () => (!DEMO && S.teamLabels && S.teamLabels.source !== 'error' ? S.teamLabels.salesperson || [] : LISTS.brokers);
  /** Does this member match a label on the Monday board (the visibility rules depend on it)? */
  function boardMatch(u) {
    const t = S.teamLabels; if (DEMO || !t || t.source !== 'monday') return '';
    const has = (list, v) => (list || []).some((x) => norm(x) === norm(v));
    if (u.role === 'VA') return !u.vaLabel ? '<span class="hotnum">No VA label: sees no leads</span>' : has(t.va, u.vaLabel) ? '<span class="okc">✓ on board</span>' : '<span class="hotnum">✗ not a VA Assigned label</span>';
    if (u.role === 'Broker') {
      if (!u.salesLabel) return '<span class="hotnum">No Salesperson label: sees no Monday viewings</span>';
      if (D.users.filter((x) => x.role === 'Broker' && x.active !== false && x.salesLabel === u.salesLabel).length > 1) return '<span class="hotnum">✗ label shared with another broker: sees none</span>';
      return (t.salesperson || []).includes(u.salesLabel) ? '<span class="okc">✓ Salesperson</span>' : '<span class="hotnum">✗ not a Salesperson label on the board</span>';
    }
    return '<span class="muted">all leads</span>';
  }
  function teamView() {
    const edit = canEdit('team'), t = S.teamLabels;
    loadTeamLabels();
    const note = DEMO ? '' : !t ? '<span class="muted">Loading Monday labels…</span>'
      : t.source === 'monday' ? `<span class="muted">VA labels and Salesperson names read from the Monday Leads board (${t.va.length} VA, ${t.salesperson.length} Salesperson labels).</span>`
      : t.source === 'error' ? `<span class="hotnum">Monday labels could not be loaded: ${esc(t.error)}. Only the preview's VA labels can be picked.</span>`
      : '<span class="muted">Monday is not connected: the preview\'s fictional VA labels are used.</span>';
    return `<div class="panel"><h3>Team &amp; Access <span class="muted">${DEMO ? 'demo members (example.com addresses)' : GOOGLE ? 'stored in MongoDB · members sign in with the Google account of this email' : 'stored in MongoDB · members sign in with their email and password'}</span><span class="spacer"></span>${edit ? '<button class="btn sm" data-act="user" data-v="">+ Add member</button>' : ''}</h3>
      ${note ? `<div class="pad" style="padding-bottom:0">${note}</div>` : ''}
      <div class="scroll-x"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Monday label</th>${t && t.source === 'monday' ? '<th>Monday match</th>' : ''}<th>Access</th></tr></thead><tbody>
      ${D.users.map((u) => `<tr class="${edit ? 'click' : ''}" ${edit ? `data-act="user" data-v="${esc(u.email)}"` : ''}><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc((u.role === 'Broker' ? u.salesLabel : u.vaLabel) || '—')}${u.role === 'Broker' && u.salesLabel ? ' <span class="sub">(Salesperson)</span>' : ''}</td>
        ${t && t.source === 'monday' ? `<td>${boardMatch(u)}</td>` : ''}
        <td class="sub">${u.role === 'Manager' ? 'Everything (edit)' : MOD_KEYS.filter((k) => (u.modules || {})[k] && u.modules[k] !== 'none').map((k) => VIEW_LABEL[k] + (u.modules[k] === 'view' ? ' (view)' : '')).join(', ') || 'No access'}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="sub">VAs see only leads assigned to their VA label; brokers see only the Monday viewings and clients of their own Salesperson label (set here; one broker per label). ${DEMO ? 'In the live portal, sign-in uses Google accounts listed here.' : 'Changes to role and access apply on the member\'s next request.' + (GOOGLE ? ' Removing a member, or changing their email, signs them out.' : ' On the hosted portal, members sign in with Google instead of a password.')}</div>`;
  }
  function userModal(email) {
    const u = D.users.find((x) => x.email === email) || { email: '', name: '', role: 'VA', vaLabel: '', modules: {} };
    S.modal = { kind: 'user', orig: email };
    openModal(`<h3 id="modalTitle">${email ? 'Edit member' : 'Add member'} <span class="muted" style="font-weight:400;font-size:12px">· ${DEMO ? 'demo' : 'MongoDB'}</span></h3>
      <div class="grid"><label>Name<input id="mName" value="${esc(u.name)}" maxlength="80"></label><label>Email<input id="mEmail" type="email" value="${esc(u.email)}" maxlength="120"></label>
        <label>Role<select id="mRole">${['Manager', 'VA', 'Broker'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label>VA label${!DEMO && S.teamLabels && S.teamLabels.source === 'monday' ? ' <span class="muted">(from Monday)</span>' : ''}<select id="mVa"><option value="">(none)</option>${vaChoices().concat(u.vaLabel && !vaChoices().includes(u.vaLabel) ? [u.vaLabel] : []).map((v) => `<option ${u.vaLabel === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Monday Salesperson label <span class="muted">(brokers)</span><select id="mSales"><option value="">(none: no Monday viewings)</option>${salesChoices().concat(u.salesLabel && !salesChoices().includes(u.salesLabel) ? [u.salesLabel] : []).map((v) => `<option ${u.salesLabel === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <div class="full sub">A broker sees only the Monday viewings and clients whose Salesperson is exactly this label. Each label can belong to one broker only.${!DEMO && S.teamLabels && S.teamLabels.source === 'error' ? ' <b>The Monday labels could not be loaded, so a label can\'t be picked right now.</b>' : ''}</div>
        ${DEMO ? '' : GOOGLE ? '<div class="full sub">They sign in with "Sign in with Google" using this email address. No password is needed.</div>' : `<label class="full">${email ? 'New password (leave blank to keep the current one)' : 'Temporary password'}<input id="mPass" type="password" autocomplete="new-password" minlength="${SH.MIN_PASSWORD}" maxlength="200" placeholder="At least ${SH.MIN_PASSWORD} characters"></label>`}</div>
      <div class="section-title">Module access <span class="muted" style="text-transform:none;font-weight:400">(Managers always have edit access)</span></div>
      <div class="grid">${MOD_KEYS.map((k) => `<label>${esc(VIEW_LABEL[k])}<select data-mod="${k}">${['none', 'view', 'edit'].map((a) => `<option value="${a}" ${((u.modules || {})[k] || 'none') === a ? 'selected' : ''}>${a === 'none' ? 'No access' : a === 'view' ? 'View' : 'Edit'}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="actions">${email && email !== me().email ? '<button type="button" class="btn danger" data-act="deluser">Remove</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary">Save</button></div>`, { form: 'user' });
  }
  async function saveUser() {
    if (!canEdit('team')) return toast('You don\'t have edit access to Settings.', true);
    const orig = S.modal.orig, modules = {};
    $$('[data-mod]').forEach((s) => { modules[s.dataset.mod] = s.value; });
    const input = { name: $('#mName').value, email: $('#mEmail').value, role: $('#mRole').value, vaLabel: $('#mVa').value, salesLabel: $('#mSales').value, modules };
    if (!DEMO && !GOOGLE) input.password = $('#mPass').value;
    const { value, errors } = SH.validateUser(input, { vaLabels: vaChoices(), salesLabels: salesChoices() });
    if (errors.length) return toast(errors[0], true);
    if (value.salesLabel && D.users.some((x) => x.email !== orig && x.role === 'Broker' && x.active !== false && x.salesLabel === value.salesLabel)) return toast(`The Salesperson label "${value.salesLabel}" is already set for another broker.`, true);
    if (!DEMO && !GOOGLE && !orig && !value.password) return toast(`Set a temporary password (at least ${SH.MIN_PASSWORD} characters).`, true);
    if (D.users.some((x) => x.email === value.email && x.email !== orig)) return toast('That email is already on the team.', true);
    const prev = D.users.find((x) => x.email === orig);
    if (prev && prev.role === 'Manager' && value.role !== 'Manager' && D.users.filter((x) => x.role === 'Manager').length < 2) return toast('Keep at least one Manager.', true);
    if (!(await attempt(() => backend.saveUser(prev, value)))) return;
    if (DEMO && orig === S.as) S.as = value.email;
    S.modalReturn = null; savePrefs(); closeModal(); if (DEMO && orig === S.as) render(); else renderView(); toast('Team saved ' + where() + '.');
  }
  function waView() {
    const edit = canEdit('team');
    return `<div class="panel"><h3>WhatsApp Templates <span class="muted">used to re-open chats after the 24-hour window</span><span class="spacer"></span>${edit ? '<button class="btn sm" data-act="tpl" data-v="">+ Add template</button>' : ''}</h3>
      <table class="t"><thead><tr><th>Name</th><th>Language</th><th>Body</th></tr></thead><tbody>
      ${D.templates.map((t) => `<tr class="${edit ? 'click' : ''}" ${edit ? `data-act="tpl" data-v="${esc(t.id)}"` : ''}><td><b>${esc(t.name)}</b></td><td>${esc(t.language)}</td><td style="white-space:normal">${esc(t.body)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No templates.</td></tr>'}
      </tbody></table></div><div class="sub">The name and language must match the template approved in WhatsApp Manager. Sending is not connected in the preview.</div>`;
  }
  function tplModal(id) {
    const t = D.templates.find((x) => x.id === id) || { name: '', language: 'en', body: '' };
    S.modal = { kind: 'tpl', id };
    openModal(`<h3 id="modalTitle">${id ? 'Edit template' : 'Add template'}</h3><div class="grid"><label>Name<input id="tName" value="${esc(t.name)}" maxlength="60" placeholder="lowercase_with_underscores"></label>
      <label>Language<input id="tLang" value="${esc(t.language)}" maxlength="10"></label><label class="full">Body<textarea id="tBody" maxlength="1024">${esc(t.body)}</textarea></label></div>
      <div class="actions">${id ? '<button type="button" class="btn danger" data-act="deltpl">Delete</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary">Save</button></div>`, { form: 'tpl' });
  }
  async function saveTpl() {
    if (!canEdit('team')) return toast('You don\'t have edit access to Settings.', true);
    const id = S.modal.id, { value, errors } = SH.validateTemplate({ name: $('#tName').value, language: $('#tLang').value, body: $('#tBody').value });
    if (errors.length) return toast(errors[0], true);
    if (D.templates.some((x) => x.name === value.name && x.id !== id)) return toast('A template with that name exists.', true);
    if (!(await attempt(() => backend.saveTemplate(id, value)))) return;
    S.modalReturn = null; closeModal(); renderView(); toast('Template saved ' + where() + '.');
  }

  // ---------- modals: viewing details + booking ----------
  // Modals take focus on open, keep Tab inside, close on Esc, and hand focus back to where it came from.
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusIn(root, prefer) {
    const pick = () => (prefer && root.querySelector(prefer)) || root.querySelector('[autofocus]') || root.querySelector(FOCUSABLE);
    const el = pick(); if (!el) return;
    el.focus();
    // panel still sliding in: try once more, unless something else has been focused meanwhile
    if (document.activeElement !== el) setTimeout(() => { const a = document.activeElement; if (a && a !== document.body && a !== root) return; const again = pick(); if (again) again.focus(); }, 60);
  }
  function openModal(html, opts) {
    S.modalReturn = document.activeElement;
    const m = $('#modal');
    m.innerHTML = `<div class="box ${opts && opts.sheet ? 'sheet' : ''}" role="document">${opts && opts.form ? `<form id="modalForm" data-submit="${opts.form}" novalidate>${html}</form>` : html}</div>`;
    m.classList.add('open'); m.setAttribute('aria-labelledby', 'modalTitle');
    focusIn(m);
  }
  /** "Mark as Failed": a portal override with a reason; Monday's Client Status / AI STATUS stay as they are. */
  function failModal() {
    const l = leadById(S.open); if (!l) return;
    S.modal = { kind: 'fail' };
    const onMonday = !DEMO && S.source === 'monday';
    openModal(`<h3 id="modalTitle">Mark ${esc(l.name)} as Failed</h3>
      <p class="sub">This is a <b>portal override</b>: AI Status shows <b>Failed</b> in the portal, labelled as an override, and it's saved ${DEMO ? 'in this browser (demo)' : 'in MongoDB'}.${onMonday ? ' <b>Nothing is written to Monday.com</b>: its Client Status and AI STATUS stay as they are until someone changes them there.' : ''} You can remove the override at any time.</p>
      <div class="grid"><label class="full">Reason<select id="failQuick"><option value="">Pick a reason…</option>${LISTS.failReasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
        <label class="full">Details (optional)<input id="failText" maxlength="200" placeholder="e.g. no reply after 3 follow-ups"></label></div>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary danger">Mark as Failed</button></div>`, { form: 'fail' });
    focusIn($('#modal'), '#failQuick');
  }
  async function saveFail() {
    const l = leadById(S.open); if (!l) return;
    const reason = [$('#failQuick').value, $('#failText').value.trim()].filter(Boolean).join(' · ');
    const { value, errors } = SH.validateFailOverride({ reason });
    if (errors.length) return toast(errors[0] === 'Give a reason (300 characters max).' ? 'Pick or type a reason.' : errors[0], true);
    if (!(await attempt(() => backend.setOverride(l, value.reason)))) return;
    IDX.delete(l); S.modalReturn = null; closeModal(); renderDrawer(); rerenderMain();
    toast('Marked as Failed in the portal (override).' + (!DEMO && S.source === 'monday' ? ' Monday.com was not changed.' : ''));
  }
  // ---------- allowlisted Monday updates (server: src/integrations/mondayWrite.js; off unless MONDAY_WRITES=on) ----------
  /** Which Monday updates this user may make, with the board's own labels (asked once per Monday load). */
  async function loadWriteOptions() {
    if (DEMO) return;
    try { S.mw = await API.get('/api/monday/write-options'); } catch (e) { if (signedOut(e)) return; S.mw = { enabled: false, actions: {}, error: e.message }; }
    if (S.view === 'invdash') renderInventory();
    if (S.open && S.tab === 'details') renderDrawerBody();
  }
  const mwAction = (k) => (!DEMO && S.source === 'monday' && S.mw && S.mw.enabled && S.mw.actions[k] && S.mw.actions[k].allowed ? S.mw.actions[k] : null);
  // the lead fields that can be updated on Monday, with the value Monday holds now (status fields: the board's own label)
  const MW_LEAD = [['leadBudget', (l) => (l.budgetText || '').trim()], ['leadMoveIn', (l) => l.moveIn || ''],
    ['leadInquiry', (l) => (l.inquiryLabel || '').trim()], ['leadNationality', (l) => l.nationality || '']];
  /** Details tab, Monday leads: the few fields that update the Direct Clients board, each saved on its own after a confirmation. */
  function mondayUpdateBox(l) {
    const rows = MW_LEAD.map(([k, cur]) => [k, mwAction(k), cur(l)]).filter(([, a]) => a);
    if (!rows.length) return '';
    const input = (k, a, v) => a.kind === 'status' ? `<select data-mwin="${k}" aria-label="${esc(a.label)}">${v && !a.labels.includes(v) ? `<option value="" selected>${esc(v)} (current)</option>` : !v ? '<option value="" selected>(not set)</option>' : ''}${a.labels.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
      : `<input data-mwin="${k}" aria-label="${esc(a.label)}" ${a.kind === 'number' ? 'type="number" min="1" step="1000" inputmode="numeric"' : a.kind === 'date' ? 'type="date"' : 'type="text" maxlength="60"'} value="${esc(v)}">`;
    return `<div class="section-title">Update on Monday <span class="muted" style="text-transform:none;font-weight:400">· saved straight to the Direct Clients board, one field at a time, after you confirm</span></div>
      <div class="mwbox">${rows.map(([k, a, v]) => `<label class="mwrow"><span>${esc(a.label)}</span>${input(k, a, v)}<button type="button" class="btn sm" data-act="mwsave" data-k="${k}">Save to Monday</button></label>`).join('')}</div>`;
  }
  // Monday's own text when it isn't a plain number (shown as it is, never "NaN")
  const mwShow = (a, v) => (!v ? '(empty)' : a.kind === 'number' && Number.isFinite(Number(v)) ? '₱' + Number(v).toLocaleString('en-PH') : v);
  /** Confirmation before any Monday change: board, field, old → new, and that it can't be undone from the portal. */
  function mwConfirm(key, itemId, value, before, title, onDone) {
    const a = S.mw.actions[key], board = a.board === 'leads' ? 'Direct Clients' : 'Listings';
    S.modal = { kind: 'mw', key, itemId, value, before, onDone };
    openModal(`<h3 id="modalTitle">Update Monday.com?</h3>
      <p>This changes <b>${esc(a.label)}</b> for <b>${esc(title)}</b> on the Monday <b>${esc(board)}</b> board:</p>
      <p class="mwchange"><span>${esc(mwShow(a, before))}</span> → <b>${esc(mwShow(a, value))}</b></p>
      <p class="sub">${before ? 'The current value on Monday is replaced. ' : ''}This is saved on Monday right away and can't be undone from the portal (change it back the same way). Only this one field is changed.</p>
      ${a.warn ? `<p class="sub" role="note"><b>⚠ ${esc(a.warn)}</b></p>` : ''}
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary">Update Monday</button></div>`, { form: 'mw' });
    focusIn($('#modal'), 'button[type=submit]');
  }
  async function mwSubmit() {
    const m = S.modal; if (!m || m.kind !== 'mw') return;
    const btn = $('#modal button[type=submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Updating Monday…'; }
    let r;
    // `expect`: the value this dialog showed; the server refuses if Monday holds something else by now
    try { r = await API.post('/api/monday/write', { action: m.key, itemId: m.itemId, value: m.value, expect: m.before || '', confirm: true }); }
    catch (e) {
      if (signedOut(e)) return;
      if (e.stale) { S.modalReturn = null; closeModal(); return toast('Monday was not updated: ' + e.message, true); }
      if (btn) { btn.disabled = false; btn.textContent = 'Update Monday'; } return toast('Monday was not updated: ' + e.message, true);
    }
    S.modalReturn = null; closeModal(); m.onDone(r);
    toast(r.unchanged ? 'Monday already had that value; nothing was changed.' : `Monday updated: ${S.mw.actions[m.key].label}${r.refreshed ? '' : ' (reload to see the board\'s copy)'}.`);
  }
  function closeModal() {
    const back = S.modalReturn; S.modal = null; S.modalReturn = null;
    $('#modal').classList.remove('open'); $('#modal').innerHTML = '';
    if (back && document.contains(back)) back.focus(); else if (S.open) focusIn($('#drawer'), 'h2');
  }
  /**
   * Viewing details. Portal bookings: the scheduling Status (Proposed / Confirmed / Done / Cancelled) and broker feedback,
   * as before. Every viewing: its result (Create LOI / Failed, reasons, LOI confidence) with the broker feedback; for a
   * Monday Calendar viewing the result sets its Status on Monday after a confirmation. preset: 'loi' | 'failed'.
   */
  function viewingModal(id, preset) {
    const v = visibleViewings().find((x) => x.id === id); if (!v) return toast('You don\'t have access to this viewing.', true);
    const l = leadById(v.leadId) || {}, x = unitOf(v), src = viewSrc(), mon = src === 'monday';
    const sched = !mon && canEdit('calendar'), why = resultBlock(), res = !why, r = resultOf(v), out = preset || (r && r.outcome) || '';
    // one line, 200 characters, only while the feedback can be copied to a configured Calendar column
    const fbMax = mon && S.integ && S.integ.calendarFeedbackColumn && mondayWritesOn() ? 200 : SH.RESULT.feedbackMax;
    S.modal = { kind: 'viewing', id, src, fbMax };
    const where1 = mon ? `Create LOI sets this viewing's Status on Monday to “${MONDAY_RESULT.loi}” (and LOI Creation Date, if empty); Failed changes nothing on Monday. The result, reasons, broker feedback and LOI confidence are kept in the portal${S.integ && S.integ.calendarFeedbackColumn ? ', and the feedback is also copied to the Calendar board\'s feedback column' : ''}.`
      : src === 'demo' ? 'Saved in this browser (demo).' : 'Saved in MongoDB (portal booking).';
    openModal(`<h3 id="modalTitle">${esc(fmtShort(v.date))} · ${esc(v.time || '—')} ${pill(v.status, VSTAT_COLORS[v.status])}</h3>
      <div class="grid"><div><span class="d-lbl">Client</span>${visibleLeads().includes(l) ? `<button type="button" class="linkbtn" data-act="openfrommodal" data-id="${esc(l.id)}">${esc(l.code)} · ${esc(l.name)}</button>` : esc(l.code || '—')}</div>
        <div><span class="d-lbl">Unit</span>${esc(x.building)}<div class="sub">${esc([x.code, x.city].filter(Boolean).join(' · '))}</div></div>
        <div><span class="d-lbl">Broker</span>${esc(v.broker || '—')}</div><div><span class="d-lbl">Price</span>${esc(money(x.price) || '—')}</div>
        ${v.statusLabel ? `<div class="full"><span class="d-lbl">Monday status</span><span id="vMonStatus">${esc(v.statusLabel)}</span></div>` : ''}
        ${!mon ? `<label>Status<select id="vStatus" ${sched ? '' : 'disabled'}>${LISTS.viewingStatuses.map((s) => `<option ${v.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}
        <fieldset class="full vres" ${res ? '' : 'disabled'}><legend>Result${r ? ` <span class="sub">· saved${r.by ? ' by ' + esc(r.by) : ''}${r.at ? ' ' + esc(ago(r.at)) : ''}</span>` : ''}</legend>
          <div class="vres-out" role="radiogroup" aria-label="Result">
            <label><input type="radio" name="vOutcome" value="loi" data-ch="vout" ${out === 'loi' ? 'checked' : ''} ${loiBlock() ? 'disabled' : ''}> 📄 Create LOI${mon ? ` <span class="sub">→ Monday Status “${MONDAY_RESULT.loi}”</span>` : ''}</label>
            <label><input type="radio" name="vOutcome" value="failed" data-ch="vout" ${out === 'failed' ? 'checked' : ''}> ✕ Failed${mon ? ' <span class="sub">→ kept in the portal; Monday unchanged</span>' : ''}</label></div>
          ${loiBlock() ? `<div class="sub" role="note">${esc(loiBlock())}</div>` : ''}
          <div class="vres-loi grid" ${out === 'loi' ? '' : 'hidden'}><label>LOI confidence (%)<input id="vConf" type="number" min="0" max="100" step="5" inputmode="numeric" value="${r && r.loiConf ? esc(r.loiConf.pct) : ''}"></label>
            <label>Current state<input id="vState" maxlength="500" value="${r && r.loiConf ? esc(r.loiConf.state || '') : ''}" placeholder="e.g. waiting for the owner"></label></div>
          <div class="vres-tags" role="group" aria-label="Reasons">${Object.entries(SH.FEEDBACK_TAGS).map(([k, t]) => `<label class="tagck"><input type="checkbox" name="vTag" value="${k}" ${r && r.tags.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
        </fieldset>
        <label class="full">Broker feedback<textarea id="vFeedback" maxlength="${fbMax}" ${res || sched ? '' : 'disabled'} placeholder="What the client said about the unit">${esc(v.feedback || '')}</textarea></label>
        <div class="full sub">${esc(where1)}${why ? `<div role="note" class="vwhy">${esc(why)}</div>` : ''}</div></div>
      <div id="vConfirm"></div>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Close</button>${res || sched ? '<button type="submit" class="btn primary" id="vSave">Save</button>' : ''}</div>`, { form: 'viewing' });
    if (preset) focusIn($('#modal'), preset === 'loi' ? '#vConf' : '.vres-tags input');
  }
  /** Reads the dialog: { outcome, body } for a result, or null when no result is chosen. */
  function viewingResultForm() {
    const out = ($('#modal input[name=vOutcome]:checked') || {}).value || '';
    if (!out) return null;
    const tags = [...document.querySelectorAll('#modal input[name=vTag]:checked')].map((i) => i.value);
    const body = { outcome: out, tags, feedback: $('#vFeedback') ? $('#vFeedback').value : '' };
    if (out === 'loi') { body.conf = $('#vConf').value; body.state = $('#vState').value; }
    return body;
  }
  /**
   * Save from the viewing dialog. A Monday Calendar viewing first shows what changes on Monday (old → new) and is
   * sent only after "Confirm & save"; the reply says what Monday accepted and where the feedback went.
   */
  async function saveViewing(confirmed) {
    const m = S.modal; if (!m || m.kind !== 'viewing') return;
    const v = visibleViewings().find((x) => x.id === m.id); if (!v) return;
    const body = viewingResultForm();
    // portal bookings: a result belongs to a viewing that happened (Done); any other Status is saved as a Status change
    const st = $('#vStatus') ? $('#vStatus').value : '';
    if (m.src !== 'monday' && (!body || st !== 'Done')) {
      return setViewing(m.id, st, $('#vFeedback').value).then((ok) => { if (ok) closeModal(); });
    }
    if (!body) return toast('Choose Create LOI or Failed.', true);
    if (resultBlock()) return toast(resultBlock(), true);
    if (body.outcome === 'loi' && loiBlock()) return toast(loiBlock(), true);
    const { errors } = SH.validateResult(body, m.fbMax);
    if (errors.length) return toast(errors[0], true);
    if (m.src === 'monday' && !confirmed) {
      const target = MONDAY_RESULT[body.outcome], cur = v.statusLabel || '', changes = [];
      if (target && cur !== target) changes.push(`<li>Status: <span>${esc(cur || '(empty)')}</span> → <b>${esc(target)}</b></li>`);
      if (body.outcome === 'loi' && !v.loiCreated) changes.push('<li>LOI Creation Date: <span>(empty)</span> → <b>today</b></li>');
      if (S.integ && S.integ.calendarFeedbackColumn && mondayWritesOn() && body.feedback) changes.push('<li>Broker feedback column: the feedback text</li>');
      if (changes.length) {
        $('#vConfirm').innerHTML = `<div class="vconfirm" role="alert"><b>Update this viewing on Monday.com?</b><ul>${changes.join('')}</ul>
          <div class="sub">${cur && cur !== target ? 'The current Status on Monday is replaced. ' : ''}Changing the Status may trigger automations set up on the Monday Calendar board. It can't be undone from the portal.</div>
          <div class="actions"><button type="button" class="btn" data-act="vback">Back</button><button type="button" class="btn primary" data-act="vconfirm">Confirm &amp; save</button></div></div>`;
        const s = $('#vSave'); if (s) s.hidden = true;
        return focusIn($('#vConfirm'), '[data-act=vconfirm]');
      }
    }
    const btns = [...document.querySelectorAll('#modal [data-act=vconfirm], #vSave')];
    btns.forEach((b) => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Saving…'; });
    let r;
    try { r = await backend.saveResult(v, m.src === 'monday' ? { ...body, expect: v.statusLabel || '', confirm: true } : body); }
    catch (e) {
      if (signedOut(e)) return;
      if (e.stale || e.partial) {
        // Monday holds something else now (or was already updated): show what it holds before anything else is tried
        S.modalReturn = null; closeModal(); toast((e.partial ? 'Partly saved: ' : 'Not saved: ') + e.message, true);
        if (m.src === 'monday') loadMonday(false).then(() => { renderView(); if (S.open) renderDrawer(); });
        return;
      }
      btns.forEach((b) => { b.disabled = false; b.textContent = b.dataset.label; });
      return toast('Not saved: ' + (e.message || 'Something went wrong.'), true);
    }
    S.modalReturn = null; closeModal();
    if (S.pend) S.pend.rows = S.pend.rows.filter((p) => !(p.id === v.id && p.src === viewSrc()));
    renderView(); if (S.open) renderDrawer(); loadPending();
    if (m.src === 'monday') {
      const w = (r.written || []).map((x) => x.column + (x.to ? ' → ' + x.to : ' updated')).join(', ');
      toast(`Saved. ${w ? 'Monday: ' + w + '.' : 'Monday was not changed.'} Result and broker feedback ${r.feedbackSavedTo === 'monday+portal' ? 'saved in the portal (feedback also on Monday)' : 'saved in the portal'}.${(r.warnings || []).length ? ' ' + r.warnings.join(' ') : ''}`, (r.warnings || []).length > 0);
    } else toast('Result saved ' + where() + '.');
  }
  const SLOTS = []; for (let h = 7; h <= 21; h++) ['00', '30'].forEach((m) => { if (h < 21 || m === '00') SLOTS.push(String(h).padStart(2, '0') + ':' + m); });
  function quickDates() {
    const d = (n) => ymd(new Date(Date.now() + n * 864e5)), dow = new Date().getDay();
    const sat = (6 - dow + 7) % 7 || 7, sun = (7 - dow) % 7 || 7;
    return [['Today', d(0)], ['Tomorrow', d(1)], ['Sat', d(sat)], ['Sun', d(sun)]];
  }
  function bookModal(listingId) {
    const l = leadById(S.open), x = listingById(listingId); if (!l || !x) return;
    S.modal = { kind: 'book', listingId };
    const def = ymd(new Date(Date.now() + 864e5));
    openModal(`<h3 id="modalTitle">Book viewing <span class="muted" style="font-weight:400;font-size:12px">· ${DEMO ? 'demo' : 'MongoDB'}</span></h3>
      <div class="bk-sum"><div><b>${esc(x.building)}</b> <span class="sub">${esc([x.code, x.city].filter(Boolean).join(' · '))}</span></div>
        <div class="sub">${esc(money(x.price))}${x.type === 'For Rent' ? ' / month' : ''} · ${esc(bedsTxt(x.bedrooms))} · for ${esc(l.code)} · ${esc(l.name)}</div></div>
      <div class="qd" role="group" aria-label="Quick dates">${quickDates().map(([lab, v]) => `<button type="button" class="btn sm ${v === def ? 'on' : ''}" data-act="qdate" data-v="${v}">${lab}<span class="sub"> ${esc(fmtShort(v).replace(/^\w+, /, ''))}</span></button>`).join('')}</div>
      <div class="grid"><label>Date<input id="bDate" type="date" value="${def}" required></label>
        <label>Time<select id="bTime">${SLOTS.map((t) => `<option ${t === '10:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Broker<select id="bBroker">${LISTS.brokers.map((b) => `<option ${l.salesperson === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label></div>
      <div class="sub" style="margin-top:10px">Creates a Proposed viewing ${DEMO ? 'in this browser' : 'in MongoDB'}. No message is sent to the client. Press Enter to book.</div>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary">Book Viewing</button></div>`, { form: 'book' });
    focusIn($('#modal'), 'button[type=submit]');
  }
  async function saveBooking() {
    if (!canEdit('calendar')) return toast('You don\'t have edit access to the Calendar.', true);
    const l = leadById(S.open), listing = listingById(S.modal.listingId);
    const { value, errors } = SH.validateBooking({ date: $('#bDate').value, time: $('#bTime').value, broker: $('#bBroker').value });
    if (errors.length) return toast(errors[0], true);
    if (!(await attempt(() => backend.book(l, listing, value)))) return;
    S.modalReturn = null; closeModal(); S.tab = 'viewings'; renderDrawer(); rerenderMain(); focusIn($('#drawer'), '.tab.on');
    toast('Viewing booked ' + where() + '. No message was sent.');
  }
  /** Portal bookings only (Monday Calendar viewings get a result instead). true when saved. */
  async function setViewing(id, status, feedback) {
    if (!canEdit('calendar')) { toast('You don\'t have edit access to the Calendar.', true); return false; }
    const v = visibleViewings().find((x) => x.id === id); if (!v) return false;
    const patch = { status }; if (feedback != null) patch.feedback = feedback;
    const { value, errors } = SH.validateViewingPatch(patch);
    if (errors.length) { toast(errors[0], true); return false; }
    if (!(await attempt(() => backend.patchViewing(v, value)))) return false;
    if (S.open) { renderDrawer(); focusIn($('#drawer'), '.tab.on'); } rerenderMain(); toast('Viewing updated ' + where() + '.');
    if (S.view === 'calendar') loadPending();
    return true;
  }

  // ---------- data layer: demo = this browser's localStorage; mongo = the Express API ----------
  const nowIso = () => new Date().toISOString();
  const upsert = (arr, rec) => { const cur = arr.find((x) => x.id === rec.id); if (cur) return Object.assign(cur, rec); arr.push(rec); return rec; };
  const backend = DEMO ? {
    async saveLead(l, value) {
      const keys = Object.keys(value).filter((k) => String(l[k] == null ? '' : l[k]) !== String(value[k]));
      if (!keys.length) return;
      Object.assign(l, value); l.updatedAt = nowIso();
      l.notes.push({ by: me().name, text: SH.leadUpdateNote(keys) + ' (demo)', at: l.updatedAt }); persist();
    },
    async addNote(l, text) { l.notes.push({ by: me().name, text, at: nowIso() }); l.updatedAt = nowIso(); persist(); },
    async book(l, listing, b) {
      D.calendar.push({ id: 'V' + Date.now(), leadId: l.id, listingId: listing.id, ...b, status: 'Proposed', feedback: '' });
      Object.assign(l, SH.bookingLeadChanges(l));
      l.notes.push({ by: me().name, text: SH.bookingNote(listing.code, b.date, b.time) + ' (demo)', at: nowIso() }); persist();
    },
    async patchViewing(v, value) { Object.assign(v, value); persist(); },
    async saveResult(v, b) {
      Object.assign(v, { status: 'Done', outcome: b.outcome, feedbackTags: b.tags, feedback: b.feedback.trim(), loiConf: b.outcome === 'loi' ? { pct: Math.round(Number(b.conf)), state: String(b.state || '').trim() } : null,
        outcomeAt: nowIso(), outcomeBy: me().name });
      persist(); return { viewing: v, written: [], warnings: [] };
    },
    async setAvailability(x, availability) { x.availability = availability; persist(); },
    async saveUser(prev, value) { const rec = { ...value, phone: prev ? prev.phone : '' }; if (prev) Object.assign(prev, rec); else D.users.push(rec); persist(); },
    async deleteUser(u) { D.users = D.users.filter((x) => x !== u); persist(); },
    async saveTemplate(id, value) { upsert(D.templates, { id: id || 'T' + Date.now(), ...value }); persist(); },
    async deleteTemplate(id) { D.templates = D.templates.filter((x) => x.id !== id); persist(); },
    // Asking for Availability / overrides: the same rules as the API (one record per lead + listing, bounded), in this browser
    async askList(l) { return (D.asking = D.asking || []).filter((a) => a.leadId === l.id); },
    async askAdd(l, listingId) {
      D.asking = D.asking || [];
      const cur = D.asking.find((a) => a.leadId === l.id && a.listingId === listingId); if (cur) return { request: cur, already: true };
      if (D.asking.filter((a) => a.leadId === l.id).length >= SH.ASK.maxPerLead) throw new Error(`This lead already has ${SH.ASK.maxPerLead} units in Asking for Availability. Remove some first.`);
      const x = listingById(listingId), a = { id: 'A' + Date.now(), leadId: l.id, listingId, listingName: x ? x.building : '', status: 'asking', contacts: [], createdAt: nowIso() };
      D.asking.push(a); persist(); return { request: a };
    },
    async askPatch(a, value) {
      if (value.contacted) a.contacts = (a.contacts || []).concat([{ via: value.contacted, at: nowIso(), by: me().name }]).slice(-SH.ASK.logMax);
      else a.status = value.status;
      persist(); return a;
    },
    async askDel(a) { D.asking = (D.asking || []).filter((x) => x !== a); persist(); },
    async setOverride(l, reason) {
      if (!l.override) l.preOverride = { ai: l.ai, aiSub: l.aiSub, aiSource: l.aiSource, workStage: l.workStage };
      SH.applyOverride(l, { failed: { reason, by: me().name, at: nowIso() } }); persist();
    },
    async clearOverride(l) { Object.assign(l, l.preOverride || {}); delete l.override; delete l.preOverride; persist(); },
  } : {
    async saveLead(l, value) {
      const r = await API.patch('/api/leads/' + l.id, value), ov = l.override;
      Object.assign(l, r.lead); if (ov) SH.applyOverride(l, { failed: ov });   // the portal override still applies
      if (r.note && l.notes) l.notes.push(r.note);
    },
    async addNote(l, text) { const r = await API.post(`/api/leads/${l.id}/notes`, { text }); if (l.notes) l.notes.push(r.note); },
    async book(l, listing, b) {
      const r = await API.post('/api/viewings', { leadId: l.id, listingId: listing.id, ...b });
      D.calendar.push(r.viewing); Object.assign(l, r.lead); if (l.notes) l.notes.push(r.note);
    },
    async patchViewing(v, value) { Object.assign(v, (await API.patch('/api/viewings/' + v.id, value)).viewing); },
    // a viewing's result: the server saves each part where it belongs (Monday Status / portal feedback); never a fallback
    async saveResult(v, body) {
      const r = await API.post(`/api/viewings/${viewSrc()}/${encodeURIComponent(v.id)}/result`, body);
      Object.assign(v, r.viewing); return r;
    },
    async setAvailability(x, availability) { x.availability = (await API.patch('/api/listings/' + x.id, { availability })).listing.availability; },   // keeps the normalised city
    async saveUser(prev, value) {
      const r = prev ? await API.patch('/api/team/' + prev.id, value) : await API.post('/api/team', value);
      upsert(D.users, r.user); if (S.user && r.user.id === S.user.id) S.user = r.user;
    },
    async deleteUser(u) { await API.del('/api/team/' + u.id); D.users = D.users.filter((x) => x !== u); },
    async saveTemplate(id, value) { upsert(D.templates, (id ? await API.patch('/api/templates/' + id, value) : await API.post('/api/templates', value)).template); },
    async deleteTemplate(id) { await API.del('/api/templates/' + id); D.templates = D.templates.filter((x) => x.id !== id); },
    // portal records (MongoDB) for a lead from either source; Monday.com and respond.io are never written to
    async askList(l) { return (await API.get(`/api/leads/${leadSrc()}/${encodeURIComponent(l.id)}/asking`)).requests; },
    async askAdd(l, listingId) { return API.post(`/api/leads/${leadSrc()}/${encodeURIComponent(l.id)}/asking`, { listingId }); },
    async askPatch(a, value) { return Object.assign(a, (await API.patch('/api/asking/' + a.id, value)).request); },
    async askDel(a) { await API.del('/api/asking/' + a.id); },
    async setOverride(l, reason) {
      const r = await API.put(`/api/leads/${leadSrc()}/${encodeURIComponent(l.id)}/override`, { reason });
      if (!l.override) l.preOverride = { ai: l.ai, aiSub: l.aiSub, aiSource: l.aiSource, workStage: l.workStage };
      SH.applyOverride(l, r.override);
    },
    async clearOverride(l) {
      const r = await API.del(`/api/leads/${leadSrc()}/${encodeURIComponent(l.id)}/override`);
      Object.assign(l, r.lead || l.preOverride || {}); delete l.override; delete l.preOverride;
    },
  };
  /** Runs a data-layer call; shows the error and returns false on failure. */
  async function attempt(fn) {
    try { await fn(); return true; } catch (e) { if (!signedOut(e)) toast(e.message || 'Something went wrong.', true); return false; }
  }
  /** mongo mode: a 401 means the session ended, so go back to the sign-in screen. */
  function signedOut(e) {
    if (DEMO || !e || e.status !== 401) return false;
    S.user = null; D = EMPTY(); S.open = null; S.draft = {}; S.pend = null;
    $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); closeModal();
    renderLogin('Your session ended. Please sign in again.');
    return true;
  }

  // ---------- mongo mode: sign-in + loading ----------
  /**
   * Sign-in user and app-owned records (team, templates) always come from MongoDB. Leads, listings and viewings
   * come from MongoDB only when that source is selected; with Monday.com selected they stay empty until Monday
   * answers (never filled with MongoDB or demo records in between).
   */
  async function loadAll() {
    const b = await API.get('/api/bootstrap');
    S.user = b.user;
    S.mongoRecords = { leads: b.leads, listings: b.listings, calendar: b.viewings };
    D = { leads: D.leads || [], listings: D.listings || [], calendar: D.calendar || [], users: b.users, templates: b.templates };
    if (S.source === 'mongo') useMongoRecords();
    await refreshStatus();
    if (S.source === 'mongo' && canSee('calendar')) loadPending();
  }
  function useMongoRecords() {
    const m = S.mongoRecords || { leads: [], listings: [], calendar: [] };
    Object.assign(D, { leads: m.leads, listings: m.listings, calendar: m.calendar });
    S.srcErrors = {}; S.srcNotConfigured = []; S.chat = {}; S.srcToken = (S.srcToken || 0) + 1; S.rsInfo = null;
  }
  /** Monday.com selected: clear Monday-sourced lists, show the loading state, then load (read-only). */
  async function openMondaySource(force) {
    Object.assign(D, { leads: [], listings: [], calendar: [] });
    S.srcErrors = {}; S.srcNotConfigured = []; S.srcFetchedAt = ''; S.chat = {}; S.list = null;
    S.srcBusy = true; S.srcProgress = null; render();
    watchFirstLoad();
    const ok = await loadMonday(force);
    if (ok) { render(); watchMonday(); }
    return ok;
  }
  /**
   * While Monday.com is shown: rechecks the age and refresh state of the server's copy (no data in that reply) every
   * 30 s, or 10 s while a refresh runs, and swaps in a newer copy once it's ready — but not while a lead, a dialog or a
   * text field is in use; the bar says newer data is waiting instead.
   */
  async function watchMonday() {
    const id = S.watch = (S.watch || 0) + 1;
    const alive = () => S.watch === id && S.source === 'monday' && !!S.user;
    while (alive()) {
      await new Promise((r) => { S.watchWake = r; setTimeout(r, S.srcLive && S.srcLive.refreshing ? 10e3 : 30e3); });
      if (!alive()) return;
      if (S.srcBusy) continue;
      let f;
      try { f = await API.get('/api/monday/freshness'); } catch (e) {
        if (signedOut(e)) return;
        if (alive()) { S.srcLive = { ...(S.srcLive || {}), checkError: e.message }; renderModeBar(); }
        continue;
      }
      if (!alive()) return;
      S.srcLive = f;
      const newer = Object.entries(f.boards || {}).some(([k, b]) => b.loadedAt && b.loadedAt !== (S.srcBoards[k] || {}).loadedAt);
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (newer && !S.open && !S.modal && !typing && !document.hidden) { if ((await loadMonday(false)) && alive()) render(); }
      else { S.srcNewer = newer; renderModeBar(); }
    }
  }
  /** Integration status (never fatal: the portal works without integrations). */
  async function refreshStatus() {
    if (DEMO) return;
    try { S.integ = await API.get('/api/integrations/status'); } catch (e) { if (signedOut(e)) return; }
    renderModeBar();
  }
  /** Live read-only Monday.com records for the existing screens. Errors are shown, never replaced with other data. */
  async function loadMonday(force) {
    S.srcBusy = true; renderModeBar();
    const token = S.srcToken;
    // a reply that arrives after the user switched to MongoDB (or signed out) is ignored, never mixed in
    const stale = () => S.source !== 'monday' || S.srcToken !== token || !S.user;
    try {
      const r = await API.get('/api/monday/bootstrap' + (force ? '?refresh=1' : ''));
      if (stale()) return false;
      D.leads = r.leads; D.listings = r.listings; D.calendar = r.viewings;
      S.srcErrors = r.errors || {}; S.srcNotConfigured = r.notConfigured || []; S.srcFetchedAt = r.fetchedAt || ''; S.scopeNotice = r.scopeNotice || '';
      S.srcBoards = r.boards || {}; S.srcLive = { boards: r.boards || {}, refreshing: !!r.refreshing }; S.srcStaleMs = r.staleAfterMs; S.srcNewer = false;
    } catch (e) {
      if (signedOut(e) || stale()) return false;
      D.leads = []; D.listings = []; D.calendar = []; S.srcErrors = { all: e.message }; S.srcNotConfigured = []; S.srcFetchedAt = '';
      S.srcBoards = {}; S.srcLive = null; S.srcNewer = false;
    } finally { if (!stale()) S.srcBusy = false; else if (S.source !== 'monday') S.srcBusy = false; }
    S.chat = {};
    await refreshStatus();
    S.srcToken = (S.srcToken || 0) + 1;
    if (!Object.keys(S.srcErrors).length || !S.srcErrors.leads) pollReplyStates(S.srcToken);
    loadWriteOptions();
    loadPending();   // Pending Broker Feedback (and the Calendar's red count) for the data just loaded
    return true;
  }
  /**
   * Needs VA Reply / Waiting on Client, Temperature and Days in Stage for Monday leads, from respond.io (read-only).
   * The server checks up to 60 chats per call (like the original); we ask again while some are pending.
   */
  /**
   * Rounds run until nothing is pending. respond.io slowing us down → wait what the server says; a failed request or a
   * round that makes no progress → stop and try the whole check again later (30 s, 1, 2, 4, then every 5 min), so no
   * lead is left on "Checking…". Leads whose own check failed show "Check failed"; the server retries those by itself.
   */
  async function pollReplyStates(token, attempt = 0) {
    const r0 = S.integ && S.integ.respond;
    // list-wide checks are off unless the server switches them on (RESPOND_LIST_CHECKS=on): chats are read per lead
    if (DEMO || S.source !== 'monday' || !r0 || !r0.configured || !r0.listChecks) { S.rsInfo = null; return; }
    clearTimeout(S.rsRetryT);
    const alive = () => token === S.srcToken && S.source === 'monday' && !!S.user;
    const later = (why, ms) => {
      const wait = ms || Math.min(300e3, 30e3 * 2 ** attempt);
      S.rsInfo = { ...(S.rsInfo || {}), busy: false, error: why, retryAt: Date.now() + wait };
      S.rsRetryT = setTimeout(() => { if (alive()) pollReplyStates(token, attempt + 1); }, wait);
    };
    S.rsInfo = { ...(S.rsInfo || {}), busy: true, error: '', retryAt: 0 }; renderModeBar(); refreshLeadRows();
    let lastPending = -1, stuck = 0;
    for (let round = 0; ; round++) {
      let r;
      try { r = await API.get('/api/respond/reply-states'); } catch (e) { if (signedOut(e) || !alive()) return; later(e.message); break; }
      if (!alive()) return;   // source changed or reloaded meanwhile
      Object.entries(r.leads || {}).forEach(([id, v]) => { const l = leadById(id); if (l) { Object.assign(l, v); IDX.delete(l); } });
      const errs = Object.entries(r.errors || {}).filter(([k]) => k !== '_');
      S.rsInfo = { busy: r.pending > 0, linked: r.linked, pending: r.pending, at: r.checkedAt, retryAt: 0,
        error: r.errors && r.errors._ ? r.errors._ : errs.length ? errs.length + ' chat' + (errs.length > 1 ? 's' : '') + ' could not be read: ' + errs[0][1] : '' };
      refreshLeadRows(); renderModeBar();
      if (!r.pending) break;
      if (r.retryAfterMs > 120e3) { later(S.rsInfo.error || 'respond.io refused the request.', r.retryAfterMs); break; }   // e.g. a rejected token: much later
      stuck = r.pending >= lastPending && lastPending >= 0 && !r.checked ? stuck + 1 : 0; lastPending = r.pending;
      if ((r.errors && r.errors._ && !r.retryAfterMs) || stuck >= 3 || round >= 60) { later(S.rsInfo.error || 'respond.io checks are not progressing.'); break; }
      await new Promise((res) => setTimeout(res, r.retryAfterMs || 1500));
      if (!alive()) return;
    }
    if (S.rsInfo && alive() && !S.rsInfo.retryAt) {
      S.rsInfo.busy = false;
      // leads whose own check failed: the server waits 2 min before trying them again, so come back for them then
      if (D.leads.some((l) => l.replyError)) { S.rsInfo.retryAt = Date.now() + 130e3; S.rsRetryT = setTimeout(() => { if (alive()) pollReplyStates(token, 0); }, 130e3); }
    }
    refreshLeadRows(); renderModeBar();
    refreshStatus();
  }
  function refreshLeadRows() { if (S.view === 'leads' && $('#list')) { refreshLeads(false); renderSide(); } }
  // why a Google sign-in was refused (codes from the API's /api/auth/google/callback; never details of the account)
  const SIGNIN_ERRORS = {
    not_member: 'That Google account isn\'t on the team. Ask a Manager to add your email address in Settings → Team & Access, then try again.',
    mismatch: 'This email is linked to a different Google account. Ask a Manager to check your entry in Team & Access.',
    domain: 'Use your company Google account to sign in.',
    unverified: 'Google hasn\'t verified that email address yet.',
    cancelled: 'Sign-in was cancelled.',
    expired: 'That sign-in link expired or was opened in another browser. Please try again.',
    google: 'Google sign-in didn\'t complete. Please try again in a minute.',
  };
  function renderGoogleLogin(msg, isErr) {
    document.documentElement.dataset.theme = S.theme;
    $('#app').innerHTML = `<div class="login"><div class="box">
      <div class="brand" style="margin-bottom:14px"><div class="logo">BH</div><div>Blackhouse<small>Leads Portal</small></div></div>
      ${msg ? `<div class="${isErr ? 'src-err' : 'sub'}" style="margin-bottom:10px" role="${isErr ? 'alert' : 'status'}">${esc(msg)}</div>` : ''}
      <a class="btn primary" id="gSignIn" href="${esc(API.url('/api/auth/google/start'))}" style="width:100%;justify-content:center">Sign in with Google</a>
      <div class="sub" style="margin-top:12px">Only team members listed in Team &amp; Access can sign in. Your role and access come from the portal, not from Google.</div></div></div>`;
    const b = $('#gSignIn'); if (b) b.focus();
  }
  function renderLogin(msg, isErr) {
    if (GOOGLE) return renderGoogleLogin(msg, isErr);
    document.documentElement.dataset.theme = S.theme;
    $('#app').innerHTML = `<div class="login"><form class="box" id="loginForm" autocomplete="on">
      <div class="brand" style="margin-bottom:14px"><div class="logo">BH</div><div>Blackhouse<small>Leads Portal · MongoDB (local backend)</small></div></div>
      ${msg ? `<div class="sub" style="margin-bottom:10px" role="status">${esc(msg)}</div>` : ''}
      <div class="grid" style="grid-template-columns:1fr"><label>Email<input id="lEmail" type="email" autocomplete="username" required maxlength="120"></label>
        <label>Password<input id="lPass" type="password" autocomplete="current-password" required maxlength="200"></label></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center;margin-top:14px">Sign in</button>
      <div class="sub" style="margin-top:12px">Local preview sign-in: accounts stored in your MongoDB, for fictional data only. Google sign-in is required before production.
        Monday.com and respond.io can be read (read-only) once configured. Create the first Manager with <b>npm run create-manager</b>.</div></form></div>`;
    const e = $('#lEmail'); if (e) e.focus();
  }
  function renderFatal(msg) {
    $('#app').innerHTML = `<div class="login"><div class="box"><h3 style="margin-top:0">${API.base ? 'The portal API isn\'t available' : 'The local backend isn\'t available'}</h3>
      <div class="sub" style="margin-bottom:12px">${esc(msg)}</div>
      <div class="sub" style="margin-bottom:12px">${API.base ? 'The portal never shows demo or cached data in its place.' : 'MongoDB mode does not switch to demo data. Start the server with <b>npm run start:demo</b> if you want the demo instead.'}</div>
      <button class="btn primary" data-act="retry">Try again</button></div></div>`;
  }
  async function boot() {
    if (DEMO) { if (!store.get(STORE)) persist(); return true; }
    // returning from Google: show why a sign-in was refused, and take the code out of the address bar
    const err = (location.hash.match(/^#signin-error=([a-z_]+)$/) || [])[1];
    if (err || location.hash === '#') history.replaceState(null, '', location.pathname + location.search);
    try { await API.get('/api/session'); await loadAll(); return true; } catch (e) {
      if (e.status === 401) renderLogin(err ? SIGNIN_ERRORS[err] || SIGNIN_ERRORS.google : '', !!err); else renderFatal(e.message);
      return false;
    }
  }
  /** After a save: on the Leads view update just that row and the counters; elsewhere redraw only the view. */
  function rerenderMain() {
    if (S.view === 'leads' && $('#list')) {
      const l = S.open && leadById(S.open), row = l && rowEl(l.id);
      if (row) { row.outerHTML = rowHtml(l); const r2 = rowEl(l.id); if (r2) r2.classList.add('sel'); }
      updateCounts(); renderSide();
    } else renderView();
  }
  const setFilter = (fn) => { fn(); if (S.view !== 'leads') { S.view = 'leads'; savePrefs(); render(); } else filtersChanged(); };

  // ---------- events (delegated) ----------
  const ACT = {
    nav: (el) => { S.view = el.dataset.v; S.wait = ''; S.ai = []; S.temp = []; savePrefs(); render(); window.scrollTo(0, 0); const h = $('.ptitle'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } },
    navwait: (el) => setFilter(() => { S.wait = S.wait === el.dataset.v ? '' : el.dataset.v; }),
    navai: (el) => setFilter(() => { if (S.view !== 'leads') S.ai = []; toggle(S.ai, el.dataset.v); }),
    navtemp: (el) => setFilter(() => { if (S.view !== 'leads') S.temp = []; toggle(S.temp, el.dataset.v); }),
    tile: (el) => setFilter(() => { const k = el.dataset.k; if (!k) { S.ai = []; S.temp = []; S.wait = ''; } else toggle(S[k], el.dataset.v); }),
    unchip: (el) => setFilter(() => { const k = el.dataset.k; if (k === 'ai' || k === 'temp') toggle(S[k], el.dataset.v); else S[k] = ''; }),
    clearall: () => setFilter(() => { S.q = ''; S.va = ''; S.ai = []; S.temp = []; S.wait = ''; S.type = ''; S.from = ''; const q = $('#q'); if (q) q.value = ''; }),
    sortcol: (el) => { const k = el.dataset.v; if (S.sortCol === k) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc'; else { S.sortCol = k; S.sortDir = ['added', 'budget'].includes(k) ? 'desc' : 'asc'; } refreshLeads(true); const b = $(`.hsort[data-v="${k}"]`); if (b) b.focus(); },
    more: appendRows,
    open: (el, e) => { if (e && e.target.closest('.qb')) return; openLead(el.dataset.id); },
    openbook: (el) => openLead(el.dataset.id, 'props'),
    gobook: () => { S.tab = 'props'; renderDrawer(); focusIn($('#drawer'), '[data-act=book]'); },
    prevlead: () => stepLead(-1), nextlead: () => stepLead(1),
    openfrommodal: (el) => { S.modalReturn = null; closeModal(); openLead(el.dataset.id); },
    close: closeDrawer,
    tab: (el) => {
      if (S.tab === 'details' && Object.keys(S.draft).length && !confirm('Discard unsaved changes?')) return;
      S.draft = {}; S.tab = el.dataset.v;
      $$('#drawer .tab').forEach((t) => { const on = t.dataset.v === S.tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
      renderDrawerBody();
    },
    discard: () => { S.draft = {}; renderDrawerBody(); },
    save: saveDraft,
    addnote: async () => {
      if (!canEdit('leads')) return toast('You have view-only access to Leads.', true);
      const { value, errors } = SH.validateNote($('#noteText').value);
      if (errors.length) return toast(errors[0], true);
      if (!(await attempt(() => backend.addNote(leadById(S.open), value)))) return;
      renderDrawerBody(); rerenderMain(); toast('Note saved ' + where() + ', not to Monday.');
    },
    book: (el) => bookModal(el.dataset.id),
    qdate: (el) => { $('#bDate').value = el.dataset.v; $$('.qd .btn').forEach((b) => b.classList.toggle('on', b === el)); },
    vstatus: (el) => setViewing(el.dataset.id, el.dataset.v),
    viewing: (el) => viewingModal(el.dataset.id),
    // Pending Broker Feedback: open the client, or record the result (the same dialog and save as the viewing details)
    pfbopen: (el) => openLead(el.dataset.id),
    pfbres: (el) => viewingModal(el.dataset.id, el.dataset.v),
    vconfirm: () => saveViewing(true),
    vback: () => { $('#vConfirm').innerHTML = ''; const s = $('#vSave'); if (s) { s.hidden = false; s.focus(); } },
    mclose: closeModal,
    calmove: (el) => { const d = +el.dataset.v, m = S.calMonth; S.calMonth = d === 0 ? null : new Date(m.getFullYear(), m.getMonth() + d, 1); renderView(); },
    invmore: () => { S.inv.limit = (S.inv.limit || 120) + 120; renderInventory(); },
    invcity: (el) => { S.inv.city = el.dataset.v; S.inv.limit = 120; renderView(); const g = $('#invGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); },
    filterva: (el) => { if (!isManager()) return; S.view = 'leads'; S.va = el.dataset.v; S.wait = ''; savePrefs(); render(); },
    settab: (el) => { S.setTab = el.dataset.v; renderView(); if (S.setTab === 'integ') refreshStatus().then(() => { if (S.view === 'team' && S.setTab === 'integ') renderView(); }); },
    integstatus: async () => { await refreshStatus(); renderView(); },
    mtest: async (el) => {
      el.disabled = true;
      try { S.mTest = await API.post('/api/integrations/monday/test'); } catch (e) { if (signedOut(e)) return; S.mTest = { error: e.message }; }
      await refreshStatus(); renderView();
    },
    // a manual choice is remembered in this browser; Monday.com is the default otherwise
    source: async (el) => {
      const v = el.dataset.v; if (v === S.source || (S.srcBusy && v === 'monday')) return;
      if (S.open) { closeDrawer(); if (S.open) return; }
      prefs.source = v; S.source = v; S.pend = null; savePrefs();
      if (v === 'monday') { await openMondaySource(false); toast(mondayWritesOn() ? 'Showing live Monday.com data.' : 'Showing live Monday.com data (read-only).'); return; }
      S.srcBusy = false;
      if (!(await attempt(loadAll))) return;
      useMongoRecords(); S.list = null; render(); toast('Showing MongoDB records (chosen by hand; Monday.com stays the default until you switch back).');
    },
    user: (el) => userModal(el.dataset.v),
    deluser: async () => {
      const u = D.users.find((x) => x.email === S.modal.orig); if (!u) return;
      if (u.role === 'Manager' && D.users.filter((x) => x.role === 'Manager').length < 2) return toast('Keep at least one Manager.', true);
      if (!confirm('Remove ' + u.name + (DEMO ? ' from the demo team?' : ' from the team? They will be signed out.'))) return;
      if (await attempt(() => backend.deleteUser(u))) { S.modalReturn = null; closeModal(); renderView(); }
    },
    tpl: (el) => tplModal(el.dataset.v),
    deltpl: async () => { if (!confirm('Delete this template?')) return; if (await attempt(() => backend.deleteTemplate(S.modal.id))) { S.modalReturn = null; closeModal(); renderView(); } },
    copydaily: () => {
      const done = () => toast('Copied. Paste it wherever you like; nothing was posted.');
      if (navigator.clipboard) navigator.clipboard.writeText(dailyText()).then(done, () => toast('Copy was blocked by the browser.', true)); else toast('Copy isn\'t available here.', true);
    },
    copypropreq: async (el) => {
      const text = propReqText(), n = PR.sourcingLeads(visibleLeads()).length;
      try { await copyText(text); } catch (e) { return toast('Copy was blocked by the browser. Select the preview text and copy it by hand.', true); }
      toast(`Report copied (${n} requirement${n === 1 ? '' : 's'}). Paste it in the Viber channel; nothing was posted.`);
      el.textContent = 'Copied ✓'; clearTimeout(el.t); el.t = setTimeout(() => { el.textContent = 'Copy report'; }, 2000);
    },
    prtoday: () => { S.prDate = ''; renderView(); },
    copyclientreq: async (el) => {
      const text = clientReqText(), n = CR.clients(visibleLeads()).length;
      try { await copyText(text); } catch (e) { return toast('Copy was blocked by the browser. Select the message text and copy it by hand.', true); }
      toast(`Message copied (${n} client${n === 1 ? '' : 's'}). Paste it where you need it; nothing was sent.`);
      el.textContent = 'Copied ✓'; clearTimeout(el.t); el.t = setTimeout(() => { el.textContent = 'Copy message'; }, 2000);
    },
    refresh: async () => {
      if (DEMO) return toast('Demo data doesn\'t change on its own. In the live portal, Refresh reloads from Monday.com.');
      if (S.open && Object.keys(S.draft).length) return toast('Save or discard your changes first.', true);
      if (S.source === 'monday') {
        if (!(await loadMonday(true))) return;
        if (S.open) closeDrawer(); render(); if (S.watchWake) S.watchWake();
        const errs = !!Object.keys(S.srcErrors).length;
        toast(errs ? 'Some Monday.com boards could not be loaded (see the error above).'
          : S.srcLive && S.srcLive.refreshing ? 'Refreshing from Monday.com in the background. The data on screen stays, with its age shown, until the new copy is ready.'
          : 'Monday.com data on screen was read ' + ago(S.srcFetchedAt) + ' (refreshed at most every 30 s).', errs);
        return;
      }
      if (await attempt(loadAll)) { useMongoRecords(); if (S.open) closeDrawer(); render(); toast('Reloaded from MongoDB.'); }
    },
    logout: async () => {
      try { await API.post('/api/auth/logout'); } catch (e) { /* the session is gone either way */ }
      S.user = null; D = EMPTY(); S.open = null; S.draft = {}; S.pend = null; S.source = SH.defaultSource(prefs.source); S.mongoRecords = null; S.srcFetchedAt = ''; S.srcErrors = {}; S.srcBoards = {}; S.srcLive = null; S.watch = (S.watch || 0) + 1;
      S.integ = null; S.chat = {}; S.teamLabels = null; S.srcToken++; S.rsInfo = null; S.mw = null; S.pend = null;
      $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); closeModal();
      renderLogin('Signed out.');
    },
    retry: () => location.reload(),
    navopen: () => openNav(),
    navclose: () => closeNav(true),
    filtersheet: () => { S.modal = { kind: 'filters' }; openModal(filterSheetHtml(), { sheet: true }); },
    photonav: (el) => {
      const x = listingById(el.dataset.id); if (!x || !x.photos) return;
      const card = el.closest('.lph'), img = card.querySelector('.lphoto'), link = card.querySelector('.phl'), cnt = card.querySelector('[data-pc]');
      const i = (x.photos.indexOf((img.dataset.cur || x.photos[0])) + Number(el.dataset.v) + x.photos.length) % x.photos.length, id = x.photos[i];
      card.classList.remove('ph-err'); img.dataset.cur = id; img.src = API.url(`/api/monday/photo/${encodeURIComponent(id)}?thumb=1`); link.href = API.url(`/api/monday/photo/${encodeURIComponent(id)}`);
      if (cnt) cnt.textContent = (i + 1) + '/' + x.photos.length;
    },
    notwired: (el) => toast(el.dataset.v + ' is switched off in the preview (read-only; no messages are sent).'),
    // Monday updates (allowlisted, confirmed first)
    mwsave: (el) => {
      const l = leadById(S.open), k = el.dataset.k, a = mwAction(k); if (!l || !a) return;
      const inp = $(`#dbody [data-mwin="${k}"]`), value = inp ? inp.value.trim() : '';
      const before = (MW_LEAD.find(([x]) => x === k) || [, () => ''])[1](l);
      if (!value) return toast(a.label + ': enter a value first (the portal never clears Monday values).', true);
      if (value === before) return toast(a.label + ' already has that value.');
      mwConfirm(k, l.id, value, before, l.name || 'this lead', (r) => { if (r.record) Object.assign(l, r.record); IDX.delete(l); renderDrawer(); rerenderMain(); });
    },
    // Properties tab filters
    pfchip: (el) => { const l = leadById(S.open); if (!l) return; const f = pfFor(l); toggle(f[el.dataset.k], el.dataset.v); S.pf.limit = 24; S.pfOpen = true; refreshPropsPanel(l, `[data-act="pfchip"][data-k="${el.dataset.k}"][data-v="${CSS.escape(el.dataset.v)}"]`); },
    pfclear: () => { const l = leadById(S.open); if (!l) return; S.pf = { lead: l.id, f: PF0(), limit: 24 }; S.pfOpen = true; refreshPropsPanel(l, '[data-in="pfq"]'); },
    pfmore: () => { S.pf.limit += 48; renderPropsResults(); },
    // Asking for Availability
    askadd: async (el) => {
      const l = leadById(S.open); if (!l || !canAsk()) return toast('You need edit access to Leads.', true);
      el.disabled = true;   // one request per press; the server also keeps one record per lead + listing
      let already = false;
      try { already = !!(await backend.askAdd(l, el.dataset.id)).already; } catch (e) { el.disabled = false; if (!signedOut(e)) toast(e.message || 'Something went wrong.', true); return; }
      toast(already ? 'Already in Asking for Availability.' : 'Added to Asking for Availability. Nothing was sent to the owner.');
      await loadAsking(l, true);   // the saved list (also replaces a load that was still running or had failed)
    },
    askcontact: (el) => {   // the link opens on the user's device (call / WhatsApp / Viber); the portal only logs that it was tapped
      const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.rid); if (!a || !canAsk()) return;
      backend.askPatch(a, { contacted: el.dataset.via }).then(() => { if (S.open === l.id && S.tab === 'asking') renderDrawerBody(); }).catch((e) => { if (!signedOut(e)) toast('Opened, but the contact wasn\'t logged: ' + e.message, true); });
    },
    askstatus: (el) => {
      const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.rid); if (!a) return;
      el.disabled = true;
      askDo(l, () => backend.askPatch(a, { status: el.dataset.v }), el.dataset.v === 'available' ? 'Marked owner-confirmed. Nothing was sent.' : 'Updated.');
    },
    askdel: (el) => {
      const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.rid); if (!a) return;
      askDo(l, async () => { await backend.askDel(a); S.asking[askKey(l)] = { list: askState(l).list.filter((x) => x !== a) }; }, 'Removed from Asking for Availability.');
    },
    askreload: () => { const l = leadById(S.open); if (l) loadAsking(l, true); },
    // Failed (portal override)
    failmodal: () => { if (!isManager()) return toast('Only Managers can mark a lead as Failed.', true); failModal(); },
    unfail: async () => {
      if (!isManager()) return toast('Only Managers can remove a Failed override.', true);
      const l = leadById(S.open); if (!l || !confirm('Remove the Failed override? The lead goes back to the status ' + (DEMO ? 'it had before.' : S.source === 'monday' ? 'worked out from Monday.com.' : 'saved in MongoDB.'))) return;
      if (!(await attempt(() => backend.clearOverride(l)))) return;
      IDX.delete(l); renderDrawer(); rerenderMain(); toast('Override removed.');
    },
    theme: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; savePrefs(); document.documentElement.dataset.theme = S.theme; renderSide(); },
    reset: () => {
      if (!DEMO) return;
      if (!confirm('Reset all demo data? Your demo edits in this browser will be lost.')) return;
      store.del(STORE); D = generate(new Date()); S.ephemeral = false; if (!D.users.some((u) => u.email === S.as)) S.as = 'manager@example.com';
      S.open = null; S.draft = {}; $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); closeModal(); render(); toast('Demo data reset.');
    },
  };
  const CH = {
    as: (el) => { if (!DEMO) return; if (S.open) { closeDrawer(); if (S.open) { el.value = S.as; return; } } S.as = el.value; S.va = ''; S.pend = null; savePrefs(); render(); toast('Viewing as ' + me().name + ' (' + me().role + ').'); },
    va: (el) => { S.va = el.value; filtersChanged(); },
    ai1: (el) => { if (el.value === '__multi') return; S.ai = el.value ? [el.value] : []; filtersChanged(); },
    temp1: (el) => { if (el.value === '__multi') return; S.temp = el.value ? [el.value] : []; filtersChanged(); },
    type: (el) => { S.type = el.value; filtersChanged(); },
    from: (el) => { S.from = el.value; filtersChanged(); },
    sort: (el) => { if (!el.value) return; S.sort = el.value; S.sortCol = ''; refreshLeads(true); },
    calbroker: (el) => { S.calBroker = el.value; renderView(); },
    prdate: (el) => { S.prDate = SH.isYmd(el.value) ? el.value : ''; renderView(); const d = $('[data-ch="prdate"]'); if (d) d.focus(); },
    invcity: (el) => { S.inv.city = el.value; renderInventory(); }, invtype: (el) => { S.inv.type = el.value; renderInventory(); },
    invbeds: (el) => { S.inv.beds = el.value; renderInventory(); }, invavail: (el) => { S.inv.avail = el.value; renderInventory(); },
    vout: (el) => { const box = $('#modal .vres-loi'); if (box) box.hidden = el.value !== 'loi'; $('#vConfirm').innerHTML = ''; const s = $('#vSave'); if (s) s.hidden = false; },
    mwavail: (el) => {
      const x = listingById(el.dataset.id), a = mwAction('listingAvailability'); if (!x || !a) return;
      const before = x.availabilityLabel || '', value = el.value;
      el.value = a.labels.includes(before) ? before : '';   // stays as it was until Monday confirms the change
      if (!value || value === before) return;
      mwConfirm('listingAvailability', x.id, value, before, x.building, (r) => {
        if (r.record) { const i = D.listings.indexOf(x); if (i >= 0) D.listings[i] = Object.assign({}, x, r.record); }
        renderInventory(); const again = $(`[data-ch="mwavail"][data-id="${CSS.escape(x.id)}"]`); if (again) again.focus();
      });
    },
    pftype: (el) => pfSet('type', el.value), pffurn: (el) => pfSet('furnishing', el.value),
    pfpets: (el) => pfSet('pets', el.checked), pfall: (el) => pfSet('all', el.checked),
    avail: async (el) => {
      if (!canEdit('invdash')) return toast('You have view-only access.', true);
      const x = listingById(el.dataset.id); if (!x || !LISTS.availability.includes(el.value)) return;
      if (await attempt(() => backend.setAvailability(x, el.value))) toast('Availability saved ' + where() + ', not on Monday.');
      renderInventory(); const again = $(`[data-ch="avail"][data-id="${CSS.escape(x.id)}"]`); if (again) again.focus();
    },
  };
  // ---------- tablet/phone navigation drawer (the sidebar slides in below 900px) ----------
  const navIsDrawer = () => window.matchMedia('(max-width: 900px)').matches;
  function openNav() {
    document.body.classList.add('nav-open');
    const b = $('.nav-burger'); if (b) b.setAttribute('aria-expanded', 'true');
    focusIn($('#side'), '.nav.on') ;
  }
  function closeNav(returnFocus) {
    if (!document.body.classList.contains('nav-open')) return;
    document.body.classList.remove('nav-open');
    const b = $('.nav-burger'); if (b) { b.setAttribute('aria-expanded', 'false'); if (returnFocus) b.focus(); }
  }
  window.matchMedia('(max-width: 900px)').addEventListener('change', (m) => { if (!m.matches) closeNav(false); });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'scrim') return closeDrawer();
    if (e.target.id === 'modal') return closeModal();
    const el = e.target.closest('[data-act]');
    // choosing anything in the slide-in menu closes it (except the theme switch)
    if (el && document.body.classList.contains('nav-open') && el.closest('#side') && el.dataset.act !== 'theme' && el.dataset.act !== 'navclose') closeNav(false);
    if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.ch && CH[el.dataset.ch]) return CH[el.dataset.ch](el);
    if (el.dataset && el.dataset.field) onField(el);
  });
  document.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('pfbox')) S.pfOpen = e.target.open; }, true);
  // a listing photo that can't be loaded falls back to the coloured placeholder (no inline handlers: CSP blocks them)
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('lphoto')) t.closest('.lph').classList.add('ph-err'); }, true);
  let searchT = null;
  document.addEventListener('input', (e) => {
    const el = e.target;
    // the viewing dialog: a confirmation shown for Monday no longer matches once the result is edited, so it is withdrawn
    if (S.modal && S.modal.kind === 'viewing' && el.closest && el.closest('#modal') && !el.closest('#vConfirm') && $('#vConfirm') && $('#vConfirm').innerHTML) {
      $('#vConfirm').innerHTML = ''; const s = $('#vSave'); if (s) s.hidden = false;
    }
    if (el.dataset.in === 'q') { clearTimeout(searchT); searchT = setTimeout(() => { S.q = el.value; refreshLeads(true); }, 120); }
    else if (el.dataset.in === 'invq') { clearTimeout(searchT); searchT = setTimeout(() => { S.inv.q = el.value; renderInventory(); }, 120); }
    else if (PF_IN[el.dataset.in]) { const k = PF_IN[el.dataset.in], v = el.value; clearTimeout(searchT); searchT = setTimeout(() => pfSet(k, v, true), 200); }
    else if (el.dataset.field) onField(el);
  });
  /** Edits in the lead form only update the field and the footer, so typing and focus are never interrupted. */
  function onField(el) {
    const k = el.dataset.field, l = leadById(S.open); if (!l || !canEdit('leads')) return;
    const orig = l[k] == null ? '' : String(l[k]);
    if (el.value === orig) delete S.draft[k]; else S.draft[k] = el.value;
    el.classList.toggle('dirty', k in S.draft);
    const n = Object.keys(S.draft).length, note = $('#dirtyNote');
    if (note) note.textContent = n ? n + ' Unsaved Change' + (n > 1 ? 's' : '') : 'No Changes';
    const sv = $('#dfoot [data-act="save"]'), ds = $('#dfoot [data-act="discard"]');
    if (sv) sv.disabled = !n; if (ds) ds.disabled = !n;
  }
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'modalForm') {
      e.preventDefault();
      if (f.dataset.submit === 'book') saveBooking();
      else if (f.dataset.submit === 'viewing') saveViewing(false);
      else if (f.dataset.submit === 'user') saveUser();
      else if (f.dataset.submit === 'tpl') saveTpl();
      else if (f.dataset.submit === 'fail') saveFail();
      else if (f.dataset.submit === 'mw') mwSubmit();
    }
  });

  // ---------- keyboard ----------
  const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  function trapTab(e, root) {
    const items = $$(FOCUSABLE, root).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', (e) => {
    const modalOpen = $('#modal').classList.contains('open'), act = document.activeElement;
    const navOpen = document.body.classList.contains('nav-open') && navIsDrawer();
    if (e.key === 'Escape' && navOpen && !modalOpen) return closeNav(true);
    if (e.key === 'Tab' && navOpen && !modalOpen) return trapTab(e, $('#side'));
    if (e.key === 'Escape') {
      if (modalOpen) return closeModal();
      if (act && act.id === 'q' && act.value) { act.value = ''; S.q = ''; refreshLeads(true); return; }
      if (S.open) return closeDrawer();
      return;
    }
    if (e.key === 'Tab') { if (modalOpen) return trapTab(e, $('#modal')); if (S.open) return trapTab(e, $('#drawer')); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.open && S.tab === 'details' && !modalOpen) { e.preventDefault(); if (Object.keys(S.draft).length) saveDraft(); return; }
    if (modalOpen || typing(act) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/' && S.view === 'leads' && !S.open) { const q = $('#q'); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
    if (S.open && (e.key === '[' || e.key === ']')) { e.preventDefault(); stepLead(e.key === ']' ? 1 : -1); return; }
    const row = act && act.classList && act.classList.contains('row') && act.dataset.id ? act : null;
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLead(row.dataset.id); }
    else if (e.key === 'b' || e.key === 'B') { if (canEdit('calendar')) { e.preventDefault(); openLead(row.dataset.id, 'props'); } }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next && next.id === 'moreRow') { appendRows(); next = row.nextElementSibling; }
      if (next && next.dataset && next.dataset.id) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); const rows = $$('#list .row[data-id]'); const t = e.key === 'Home' ? rows[0] : rows[rows.length - 1]; if (t) { t.focus(); t.scrollIntoView({ block: 'nearest' }); }
    }
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await API.post('/api/auth/login', { email: $('#lEmail').value, password: $('#lPass').value });
      await loadAll(); start();
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });

  // deep links: ?view=calendar, ?lead=<id> (&tab=props)
  function start() {
    const qs = new URLSearchParams(location.search);
    if (VIEW_LABEL[qs.get('view')]) S.view = qs.get('view');
    const deepLead = () => { if (qs.get('lead') && leadById(qs.get('lead'))) openLead(qs.get('lead'), qs.get('tab') || undefined); };
    if (!DEMO && S.source === 'monday') { openMondaySource(false).then(deepLead); return; }   // default source: Monday.com (read-only)
    render();
    deepLead();
  }
  boot().then((ok) => { if (ok) start(); });
})();
