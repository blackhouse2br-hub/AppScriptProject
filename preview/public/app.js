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
  // where the records on screen come from (labels only): the chosen data source, never assumed to be MongoDB
  const srcName = () => (DEMO ? 'demo data' : S.source === 'monday' ? 'Monday.com' : 'MongoDB');
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
    ['kpireview', 'KPI Review', P('<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17h8"/>')],
    ['kpiack', 'Review acknowledgment', P('<path d="M20 6 9 17l-5-5"/>')],
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
  // screens that exist in the original but are not rebuilt in the portal yet: what each one needs first
  const LATER = {
    upsell: 'Concierge broadcasts to clients, with images, tagged and sent through respond.io. Needs sending through respond.io (switched off in the portal) and image hosting; the service messages themselves are already available under Renewals → Message.',
    pages: 'Developer project pages built from Google Drive folders and web research, with a public inquiry form. Needs Google Drive access, an AI service key and a public form endpoint, which the portal does not have.',
  };
  const LATER_TAB = {
    approval: 'Owner-confirmed units waiting for the client, and the “send confirmed units” chat pop-up.',
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
  // KPI Review isn't a Team & Access module: the server decides who may open it (Toby and Jonjo only, no Manager
  // exception); a VA gets only the acknowledgment screen for their own reviews
  const krMe = () => (S.kr && S.kr.me) || {};
  const canSee = (mod) => (mod === 'kpireview' ? !DEMO && !!krMe().canView : mod === 'kpiack' ? !DEMO && !!krMe().canAck : access(mod) !== 'none');
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
  /** Monday.com data is read for members with Leads access (the server's rule for /api/monday/bootstrap). */
  const mondayAllowed = () => DEMO || access('leads') !== 'none';
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
      return `<div class="demo-bar live-bar ${S.source === 'monday' ? 'ext' : ''}"><span class="demo-tag live">${S.source === 'monday' ? 'Monday.com' : 'MongoDB'}</span>
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
        ${S.source === 'monday' ? (S.srcNoAccess ? '<div class="src-note" role="status">No Monday.com data is loaded for your account: it needs Leads access in Settings → Team &amp; Access.</div>' : mondayDataNote()) : ''}
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
      renewals: vis.filter((l) => l.ai === 'For Renewal').length, propreq: PR.sourcingLeads(vis).length, clientreq: CR.clients(vis).length,
      // Service Requests: interested / asking clients still at stage New (Index.html nav count), once loaded
      services: svNewCount() };
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
      brokers: brokersView, renewals: renewalsView, daily: dailyView, propreq: propReqView, clientreq: clientReqView, team: settingsView, pl: plView, kpireview: kpiReviewView, kpiack: kpiAckView, pages: DEMO ? null : pagesView, upsell: DEMO ? null : upsellView, services: DEMO ? null : servicesView }[S.view];
    return fn ? fn() : laterView(S.view);
  }
  // ---------- Service Requests (Index.html svView / svSendModal / svSuppliersModal; server src/services.js) ----------
  const SVI = { interested: ['Interested', '#2ea043'], asking: ['Asking', '#d29922'], 'not interested': ['Not interested', '#8b949e'], 'no reply': ['No reply', '#6e7681'] };
  const sv = () => S.sv || (S.sv = { data: null, loading: false, err: '', tab: 'all', show: 'hot', scanning: '' });
  async function svLoad() {
    const st = sv(); if (st.loading) return; st.loading = true;
    const token = S.srcToken;
    try { const r = await API.get('/api/services?source=' + (viewSrc() === 'monday' ? 'monday' : 'mongo')); if (token === S.srcToken) { st.data = r; st.err = ''; } }
    catch (e) { if (signedOut(e)) return; st.err = e.message; }
    st.loading = false; if (S.view === 'services') renderView();
  }
  const svHot = (r) => (r.interest === 'interested' || r.interest === 'asking') && !/done|not proceeding/i.test(r.stage);
  const svRows = (d, st) => d.rows.filter((r) => (st.tab === 'all' || r.svc === st.tab) && (st.show === 'all' || (st.show === 'hot' ? svHot(r) : st.show === 'done' ? /done|not proceeding/i.test(r.stage) : r.interest === st.show)));
  const svAgo = (t) => (t ? ago(t) : '');
  function servicesView() {
    const st = sv(), d = st.data;
    if (!d && !st.loading && !st.err) setTimeout(svLoad, 0);
    const head = `<div class="panel"><h3>Service Requests <span class="muted">clients interested in movers, cleaning, AC cleaning, repairs, interiors, furniture or legal help · suppliers never get the client's name or number — Blackhouse coordinates, collects and pays</span></h3>`;
    if (st.err) return head + `<div class="pad"><div class="src-err" role="alert">${esc(st.err)} <button class="linkbtn" data-act="svreload">Try again</button></div></div></div>`;
    if (!d) return head + '<div class="pad empty" role="status">Loading service requests…</div></div>';
    const set = d.setup, edit = d.canEdit;
    const setupNotes = [!set.respondRead ? 'respond.io is not connected (RESPOND_TOKEN), so "Check replies" can\'t read client replies.' : '',
      !set.ai ? 'The AI service is not set up (ANTHROPIC_API_KEY): "Check replies" finds the offers, but interest stays "No reply" until it is.' : '',
      !set.supplierSends ? 'Sending to suppliers through respond.io is off (RESPOND_SENDS). Use the WhatsApp / Viber / email buttons, then "Mark as sent".' : ''].filter(Boolean);
    const cnt = (k) => d.rows.filter((r) => (k === 'all' || r.svc === k) && svHot(r)).length;
    const rows = svRows(d, st), sup = (svc) => d.suppliers.filter((s) => s.svc === svc), label = (k) => (d.services.find((x) => x.k === k) || { label: k }).label;
    return head + `<div class="pad">
        ${setupNotes.length ? `<div class="src-note" role="note"><b>Setup:</b><ul>${setupNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <div class="toolbar">${edit ? `<button class="btn sm" data-act="svscan" ${st.scanning || !set.respondRead ? 'disabled' : ''}>${esc(st.scanning || 'Check replies (AI)')}</button>` : ''}
          ${d.manager ? '<button class="btn sm ghost" data-act="svsup">Suppliers</button>' : ''}<button class="btn sm ghost" data-act="svreload">Refresh</button></div>
        <div class="subtabs" role="tablist">${[['all', 'All']].concat(d.services.map((x) => [x.k, x.label])).map(([k, l]) => `<button class="btn sm ${st.tab === k ? 'on' : ''}" data-act="svtab" data-v="${k}">${esc(l)} (${cnt(k)})</button>`).join('')}</div>
        <div class="subtabs">${[['hot', 'Interested & asking'], ['no reply', 'No reply yet'], ['not interested', 'Not interested'], ['done', 'Done'], ['all', 'Everything']].map(([k, l]) => `<button class="btn sm ${st.show === k ? 'on' : ''}" data-act="svshow" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="scroll-x"><table class="t sv-t"><thead><tr><th>Ref</th><th>Client (internal)</th><th>Service</th><th>Interest</th><th>What they need</th><th>Area</th><th>Stage</th><th>Supplier</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.ref)}</b><div class="sub">${r.lastReply ? 'replied ' + esc(svAgo(r.lastReply)) : r.offeredAt ? 'offered ' + esc(svAgo(r.offeredAt)) : ''}</div></td>
        <td><button class="linkbtn" data-act="open" data-id="${esc(r.leadId)}">${esc(r.name || r.leadId)}</button><div class="sub">${esc(r.va || '')}</div></td><td>${esc(label(r.svc))}</td>
        <td><span class="pill" style="--c:${(SVI[r.interest] || SVI['no reply'])[1]}">${esc((SVI[r.interest] || SVI['no reply'])[0])}</span></td>
        <td class="wrap">${esc(r.summary || '—')}<div>${SH.SERVICES.detailKeys.filter((k) => r.details[k]).map((k) => `<span class="tag">${esc(k)}: ${esc(r.details[k])}</span>`).join(' ')}</div></td>
        <td>${esc([r.area, r.city].filter(Boolean).join(', ') || '—')}</td>
        <td>${edit ? `<select data-ch="svstage" data-id="${esc(r.id)}" aria-label="Stage of ${esc(r.ref)}">${d.stages.map((s) => `<option ${r.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : esc(r.stage)}</td>
        <td>${esc(r.supplier || '—')}${r.sentToSupplierAt ? `<div class="sub">sent ${esc(svAgo(r.sentToSupplierAt))}</div>` : ''}</td>
        <td>${edit ? `<button class="btn sm" data-act="svsend" data-id="${esc(r.id)}" ${sup(r.svc).length ? '' : 'disabled title="Add a supplier for this service first"'}>Send to supplier</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="9" class="muted">Nothing here yet — offer services from Renewals or Upselling, then press "Check replies".</td></tr>'}</tbody></table></div></div>`;
  }
  /** The send dialog: the anonymised text (editable), then respond.io (if on and the supplier has an ID) or the member's own app. */
  function svSendModal(id, supplierId) {
    const d = sv().data, r = d.rows.find((x) => x.id === id); if (!r) return;
    const list = d.suppliers.filter((s) => s.svc === r.svc), sp = list.find((s) => s.id === supplierId) || list[0];
    const prev = $('#svTxt'), txt = prev && S.modal && S.modal.svId === id ? prev.value : SH.serviceSupplierText(r), num = String(sp.contact || '').replace(/[^\d]/g, '');
    const viaRio = sp.respondId && d.setup.supplierSends;
    openModal(`<div class="m-head"><h2>Send ${esc(r.ref)} to a supplier</h2><button type="button" class="btn ghost" data-act="mclose" aria-label="Close">✕</button></div>
      <div class="sub">No client name, number or email is included — the supplier replies to Blackhouse.</div>
      <label>Supplier<select data-ch="svsp" data-id="${esc(id)}">${list.map((s) => `<option value="${esc(s.id)}" ${s.id === sp.id ? 'selected' : ''}>${esc(s.name)} · ${esc(s.channel)}</option>`).join('')}</select></label>
      <label>Message<textarea id="svTxt" rows="10" maxlength="${SH.SERVICES.textMax}">${esc(txt)}</textarea></label>
      <div class="sub">Check the text — remove anything that could identify the client before sending.</div>
      ${sp.respondId && !d.setup.supplierSends ? '<div class="src-note">This supplier has a respond.io contact, but sending through respond.io is off on this server (RESPOND_SENDS).</div>' : ''}
      <label class="tagck" ${viaRio ? '' : 'hidden'}><input type="checkbox" id="svOk"> I checked the text; send it to ${esc(sp.name)} now</label>
      <div class="actions"><button type="button" class="btn ghost" data-act="svcopy">Copy</button>
        ${viaRio ? `<button type="button" class="btn primary" data-act="svrio" data-id="${esc(id)}" data-sp="${esc(sp.id)}">Send via respond.io</button>`
          : sp.channel === 'whatsapp' && num ? `<button type="button" class="btn" data-act="svopen" data-id="${esc(id)}" data-sp="${esc(sp.id)}" data-kind="whatsapp" data-num="${esc(num)}">Open WhatsApp</button>`
          : sp.channel === 'email' && sp.contact ? `<button type="button" class="btn" data-act="svopen" data-id="${esc(id)}" data-sp="${esc(sp.id)}" data-kind="email" data-to="${esc(sp.contact)}">Open email</button>`
          : sp.channel === 'viber' && num ? `<button type="button" class="btn" data-act="svopen" data-id="${esc(id)}" data-sp="${esc(sp.id)}" data-kind="viber" data-num="${esc(num)}">Open Viber (text copied)</button>` : ''}
        <button type="button" class="btn ghost" data-act="svmark" data-id="${esc(id)}" data-sp="${esc(sp.id)}">Mark as sent</button></div>`);
    S.modal = { kind: 'sv', svId: id };
  }
  function svSuppliersModal() {
    const d = sv().data, L = S.modal && S.modal.supList ? S.modal.supList : JSON.parse(JSON.stringify(d.suppliers));
    openModal(`<div class="m-head"><h2>Suppliers</h2><button type="button" class="btn ghost" data-act="mclose" aria-label="Close">✕</button></div>
      <div class="sub">One or more per service. A respond.io contact ID lets you send from the portal (when sending is on); otherwise WhatsApp / Viber / email opens with the message ready.</div>
      <div class="scroll-x"><table class="t sv-sup"><thead><tr><th>Service</th><th>Supplier</th><th>Channel</th><th>Number / email</th><th>respond.io ID</th><th>Notes (rates, terms)</th><th></th></tr></thead><tbody>
      ${L.map((x, i) => `<tr><td><select data-sup="${i}|svc">${d.services.map((s) => `<option value="${s.k}" ${x.svc === s.k ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></td>
        <td><input data-sup="${i}|name" value="${esc(x.name)}" maxlength="80" aria-label="Supplier name"></td><td><select data-sup="${i}|channel">${SH.SERVICES.channels.map((c) => `<option ${x.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
        <td><input data-sup="${i}|contact" value="${esc(x.contact)}" maxlength="120" aria-label="Number or email"></td><td><input data-sup="${i}|respondId" value="${esc(x.respondId || '')}" inputmode="numeric" maxlength="20" aria-label="respond.io contact ID"></td>
        <td><input data-sup="${i}|notes" value="${esc(x.notes || '')}" maxlength="300" aria-label="Notes"></td><td><button type="button" class="btn sm ghost" data-act="supdel" data-v="${i}" aria-label="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No suppliers yet.</td></tr>'}</tbody></table></div>
      <button type="button" class="btn sm ghost" data-act="supadd">+ Add supplier</button>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="button" class="btn primary" data-act="supsave">Save</button></div>`);
    S.modal = { kind: 'sup', supList: L };
  }
  /** The sidebar count (loads the board once for members with Service Requests access). */
  function svNewCount() {
    if (DEMO || access('services') === 'none') return 0;
    const st = sv(); if (!st.data && !st.loading && !st.err) setTimeout(svLoad, 0);
    return st.data ? st.data.rows.filter((r) => svHot(r) && r.stage === 'New').length : 0;
  }
  /** Index.html svcPanel: the interested clients, on the Renewals and Upselling pages. */
  function svcPanelHtml() {
    if (DEMO || access('services') === 'none') return '';
    const st = sv(), d = st.data; if (!d && !st.loading && !st.err) setTimeout(svLoad, 0);
    const hot = d ? d.rows.filter(svHot) : [], label = (k) => SH.serviceLabel(k);
    return `<div class="panel"><h3>Interested in services <span class="muted">AI reads replies to the services you offered</span><span class="spacer"></span>
        ${d && d.canEdit ? `<button class="btn sm ghost" data-act="svscan" ${st.scanning || !d.setup.respondRead ? 'disabled' : ''}>${esc(st.scanning || 'Check replies now')}</button>` : ''}<button class="btn sm" data-act="nav" data-v="services">Open Service Requests</button></h3>
      ${st.err ? `<div class="pad src-err" role="alert">${esc(st.err)}</div>` : !d ? '<div class="pad muted">Loading…</div>' : hot.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Ref</th><th>Client</th><th>Service</th><th>Interest</th><th>What they need</th><th>Stage</th></tr></thead><tbody>
        ${hot.slice(0, 8).map((r) => `<tr><td>${esc(r.ref)}</td><td><button class="linkbtn" data-act="open" data-id="${esc(r.leadId)}">${esc(r.name || r.leadId)}</button></td><td>${esc(label(r.svc))}</td><td><span class="pill" style="--c:${(SVI[r.interest] || SVI['no reply'])[1]}">${esc((SVI[r.interest] || SVI['no reply'])[0])}</span></td><td class="wrap">${esc(r.summary)}</td><td>${esc(r.stage)}</td></tr>`).join('')}</tbody></table></div>
        ${hot.length > 8 ? `<div class="sub pad">+${hot.length - 8} more in Service Requests</div>` : ''}` : '<div class="pad muted">No interested clients yet.</div>'}</div>`;
  }
  async function svRefreshRow(row) { const d = sv().data; const i = d.rows.findIndex((x) => x.id === row.id); if (i >= 0) d.rows[i] = { ...d.rows[i], ...row }; renderView(); }
  async function svScan(force) {
    const st = sv(); st.scanning = 'Reading replies…'; renderView();
    try {
      for (let n = 0; n < 8; n++) {
        const r = await API.post('/api/services/scan', { source: viewSrc() === 'monday' ? 'monday' : 'mongo', force: !!force });
        if (r.errors && r.errors.length) toast(r.errors[0], true);
        if (!(r.remaining > 0) || !r.scanned) break;
        st.scanning = 'Reading replies… ' + r.remaining + ' left'; renderView();
      }
      toast('Replies checked');
    } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    st.scanning = ''; st.data = null; svLoad();
  }

  const laterBox = (title, what) => `<div class="later-box"><b>${esc(title)} isn't in this portal yet.</b><br>In the original Apps Script portal: ${esc(what)}<br><span class="sub">It will be built in a later migration phase. Nothing on this screen reads or changes any data.</span></div>`;
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
      // VA filter (Managers only; the same label match as the server): a VA or Broker never has one applied
      (!S.va || !isManager() || (S.va === '__none' ? !SH.vaKey(l.va) : SH.sameVa(l.va, S.va))) &&
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
    // VA choices: the board's labels for live Monday data (as VA Management), the preview's list otherwise; a chosen VA
    // that isn't in the data any more stays visible and selected, so the select never says "All" while it applies
    const vaList = vaNames();
    const vaCur = S.va === '__none' ? '__none' : vaList.find((v) => SH.sameVa(v, S.va)) || S.va;
    const vaMissing = S.va && S.va !== '__none' && !vaList.some((v) => SH.sameVa(v, S.va));
    const vas = isManager() ? fsel('va', 'VA', vaCur, opt('__none', vaCur, 'Unassigned') + vaList.map((v) => opt(v, vaCur)).join('') + (vaMissing ? opt(S.va, vaCur, S.va + ' (no leads)') : ''), 'All') : '';
    return `${vas}
        ${fsel('ai1', 'AI Status', S.ai.length === 1 ? S.ai[0] : S.ai.length ? '__multi' : '', (S.ai.length > 1 ? opt('__multi', '__multi', S.ai.length + ' selected') : '') + AI_STAGES.map((s) => opt(s, S.ai.length === 1 ? S.ai[0] : '')).join(''), 'Any')}
        ${fsel('temp1', 'Temperature', S.temp.length === 1 ? S.temp[0] : S.temp.length ? '__multi' : '', (S.temp.length > 1 ? opt('__multi', '__multi', S.temp.length + ' selected') : '') + TEMPS.map((s) => opt(s, S.temp.length === 1 ? S.temp[0] : '')).join(''), 'Any')}
        ${fsel('type', 'Type', S.type, opt('Rent', S.type) + opt('Buy', S.type, 'Buy (Sale)'), 'Any')}
        ${fsel('from', 'Source', S.from, (DEMO ? LISTS.sources : []).concat(uniqueVals('source'), S.from ? [S.from] : []).filter((v, i, a) => a.indexOf(v) === i).map((s) => opt(s, S.from)).join(''), 'All')}
        <label class="fsel ${S.sortCol ? 'on' : ''}"><span class="cap">Sort</span><select data-ch="sort" aria-label="Sort">${S.sortCol ? `<option value="" selected>${esc(COLS.find((c) => c[0] === S.sortCol)[1])} ${S.sortDir === 'desc' ? '↓' : '↑'}</option>` : ''}${SORTS.map(([v, l]) => opt(v, S.sortCol ? '' : S.sort, l)).join('')}</select></label>`;
  }
  const activeFilters = () => (S.va && isManager() ? 1 : 0) + S.ai.length + S.temp.length + (S.wait ? 1 : 0) + (S.type ? 1 : 0) + (S.from ? 1 : 0);
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
    if (S.va && isManager()) chips.push(['va', '', 'VA: ' + (S.va === '__none' ? 'Unassigned' : S.va)]);
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
      l.notes = null; l.notesError = '';
      const url = S.source === 'monday' ? `/api/monday/leads/${encodeURIComponent(id)}/notes` : `/api/leads/${encodeURIComponent(id)}/notes`;
      API.get(url).then((r) => { l.notes = r.notes; l.notesError = ''; if (S.open === id && S.tab === 'details') renderDrawerBody(); })
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
        <div class="quick">${telOf(l.phone) ? `<a class="muted" href="tel:${esc(telOf(l.phone))}" title="Call from this device's phone">${esc(l.phone)}</a>` : `<span class="muted">${esc(l.phone)}</span>`}
          ${canEdit('calendar') ? '<button class="btn sm primary" data-act="gobook">📅 Book Viewing</button>' : ''}
          ${DEMO ? `<button class="linkbtn" data-act="notwired" data-v="Message Lead">✉ Message Lead</button>
          <button class="linkbtn" data-act="notwired" data-v="Call on respond.io">📞 Call on respond.io</button>` : `<button class="linkbtn" data-act="rioopen" data-v="message" data-id="${esc(l.id)}" title="Opens this lead's conversation in respond.io (nothing is sent)">✉ Message Lead</button>
          <button class="linkbtn" data-act="rioopen" data-v="call" data-id="${esc(l.id)}" title="Opens this lead's conversation in respond.io, where you start the call">📞 Call on respond.io</button>`}
          <span class="muted sub">Added ${esc(fmtDate(l.createdAt))} · updated ${esc(ago(l.updatedAt))}</span></div></div>
        <div class="d-nav">
          <button class="btn ghost sm" data-act="prevlead" title="Previous lead ( [ )" aria-label="Previous lead">‹</button>
          <button class="btn ghost sm" data-act="nextlead" title="Next lead ( ] )" aria-label="Next lead">›</button>
          <button class="btn ghost" data-act="close" aria-label="Close (Esc)">${P('<path d="M18 6 6 18M6 6l12 12"/>')}</button></div></div>
      <div class="tabs" role="tablist" aria-label="Lead sections">${tab('details', 'Details')}${tab('props', 'Properties')}${tab('asking', askTabLabel(l))}${tab('approval', 'For Client Approval')}
        ${tab('viewings', 'For Scheduling' + (nS ? ` (${nS})` : ''))}${tab('confirmed', 'Confirmed Schedule' + (nC ? ` (${nC})` : ''))}${tab('done', 'Done' + (nD ? ` (${nD})` : ''))}
        ${Object.entries(DEAL_TABS).map(([k, v]) => tab(k, v)).join('')}${tab('chat', 'Respond.io Chat')}</div>
      <div class="d-body" id="dbody" role="tabpanel"></div><div id="dfoot"></div>`;
    renderDrawerBody();
  }
  // ---------- LOI / Contract tabs: read-only (Code.gs apiLoiDefaults / loiMap_ / dealTerm_) ----------
  /** This lead's Calendar-board rows (Monday source), or null with the reason they can't be shown. */
  function leadDeals(l) {
    if (DEMO || viewSrc() !== 'monday') return { rows: null, note: 'Deal dates come from the Monday Calendar board; switch the data source to Monday.com to see them.' };
    // the server's /api/monday/deals rule (routes.js DEAL_SCREENS)
    if (!['ldash', 'pl', 'brokers', 'renewals'].some((m) => SH.access(S.user, m) !== 'none')) return { rows: null, note: 'Deal dates are shown to members with access to the Leads Report, P&L, Brokers or Renewals.' };
    const st = dealsState();
    if (!st.at) return { rows: null, note: 'Loading the Monday Calendar board…', loading: true };
    if (st.error) return { rows: null, note: st.error, error: true };
    return { rows: st.rows.filter((d) => d.leadId === l.id) };
  }
  // e-signature: what this server still needs (from the server's own check), when signing isn't fully set up
  const setupBox = (what, sg) => (sg && sg.ready ? '' : `<div class="later-box"><b>${esc(what)} isn't set up on this server yet.</b> It needs:<ul>${((sg && sg.needs) || SH.LOI_SETUP).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><span class="sub">Until then, nothing here sends a message, shares a document or asks anyone to sign.</span></div>`);
  /** The unit an LOI / deal file is for: the Monday Calendar item, or the portal viewing's listing. */
  function unitFor(l) {
    const { deal, listing } = loiDraftFor(l);
    if (viewSrc() === 'monday') return deal && deal.id ? { key: deal.id, name: [deal.building, deal.city].filter(Boolean).join(', ') || 'Calendar item ' + deal.id } : null;
    return listing ? { key: listing.id, name: `${listing.building} · ${listing.code}` } : null;
  }
  // ---------- deal files (Code.gs DEAL_SLOTS_ / apiDealUpload; server src/deals.js) ----------
  function dealFilesState(l) {
    S.dealf = S.dealf || {};
    const k = loiSrc() + ':' + l.id;
    if (!S.dealf[k] && !DEMO) {
      S.dealf[k] = { loading: true };
      API.get(`/api/deals/${loiSrc()}/${encodeURIComponent(l.id)}`).then((r) => { S.dealf[k] = { records: r.records, setup: r.setup }; }, (e) => { if (!signedOut(e)) S.dealf[k] = { err: e.message }; })
        .then(() => { if (S.open === l.id && DEAL_TABS[S.tab]) renderDrawerBody(); });
    }
    return S.dealf[k] || {};
  }
  function dealFilesHtml(l, tab) {
    if (DEMO) return '';
    const st = dealFilesState(l), u = unitFor(l), slots = SH.DEAL_TAB_SLOTS[tab] || [];
    if (st.loading) return '<div class="empty">Loading the deal files…</div>';
    if (st.err) return `<div class="src-err" role="alert">${esc(st.err)}</div>`;
    const head = `<h4 class="kr-h">Files for this deal${u ? ` <span class="muted">${esc(u.name)}</span>` : ''}</h4>`;
    if (!u) return head + '<div class="empty">No unit yet: files are kept per viewing / Calendar item, so this client needs one first.</div>';
    const rec = (st.records || []).find((x) => x.unitKey === u.key) || { slots: {}, renewals: [] }, edit = access('leads') === 'edit', ready = st.setup && st.setup.ready;
    // defaults as the Apps Script: months from the LOI's lease term; a renewal starts the day after the current term
    const lt = ((loiState(l).lois || []).find((x) => x.fields && x.fields.LEASE_TERM) || { fields: {} }).fields.LEASE_TERM || '';
    const ltm = /\(?(\d{1,3})\)?\s*(year|yr)/i.exec(lt) ? Number(/\(?(\d{1,3})\)?\s*(year|yr)/i.exec(lt)[1]) * 12 : /\(?(\d{1,3})\)?\s*month/i.exec(lt) ? Number(/\(?(\d{1,3})\)?\s*month/i.exec(lt)[1]) : 12;
    const nextStart = rec.term && rec.term.end ? ymd(new Date(parseYmd(rec.term.end).getTime() + 864e5)) : '';
    const termLine = rec.term ? `<div class="sub">Lease ${esc(fmtDate(rec.term.start))} – ${esc(fmtDate(rec.term.end))} (${rec.term.months} months) · renewal from ${esc(fmtDate(rec.term.renewFrom))}</div>
      ${edit ? `<details class="df-term"><summary class="linkbtn">Edit the lease term</summary><div class="df-up"><label>Lease start <input type="date" id="dfTermStart" value="${esc(rec.term.start)}"></label><label>Months <input type="number" id="dfTermMonths" min="1" max="240" value="${esc(rec.term.months)}" style="width:70px"></label>
        <button class="btn sm" data-act="dfterm">Save term</button></div></details>` : ''}` : '';
    const row = (slot) => {
      const f = rec.slots[slot], needTerm = slot === 'contract' || slot === 'renewal';
      const up = edit && ready && (!f || slot === 'renewal') ? `<div class="df-up">${needTerm ? `<label>Lease start <input type="date" id="dfStart-${slot}" value="${slot === 'renewal' ? esc(nextStart) : ''}"></label><label>Months <input type="number" id="dfMonths-${slot}" min="1" max="240" value="${slot === 'renewal' && rec.term ? rec.term.months : ltm}" style="width:70px"></label>` : ''}
          <label class="btn sm">Upload<input type="file" data-ch="dfup" data-slot="${slot}" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx" hidden></label></div>` : '';
      const files = slot === 'renewal' ? rec.renewals.map((x, i) => `<div>✅ <button class="linkbtn" data-act="dfopen" data-slot="renewal" data-i="${i}">${esc(x.name)}</button> <span class="sub">${esc(x.by || '')} · ${esc(ago(x.at))}${x.term ? ' · ' + esc(fmtDate(x.term.start)) + ', ' + x.term.months + ' months' : ''}</span></div>`).join('')
        : f ? `<div>✅ <button class="linkbtn" data-act="dfopen" data-slot="${slot}">${esc(f.name)}</button> <span class="sub">${f.src === 'esign' ? 'e-signed' : 'uploaded'} · ${esc(f.by || '')} · ${esc(ago(f.at))}</span>${edit ? ` <button class="btn sm ghost" data-act="dfrm" data-slot="${slot}">Remove</button>` : ''}</div>` : '';
      return `<tr><th scope="row">${esc(SH.DEAL_SLOTS[slot])}</th><td>${files || '<span class="muted">Not on file</span>'}${up}</td></tr>`;
    };
    return head + (ready ? '' : `<div class="src-note">Uploads need Google Drive storage on this server: ${esc((st.setup && st.setup.needs || []).join('; '))}.</div>`)
      + `<table class="t deal-t" aria-label="Deal files"><tbody>${slots.map(row).join('')}</tbody></table>${termLine}
      ${rec.slots && Object.keys(rec.slots).length ? `<div class="sub">Stage from the files: <b>${esc({ loic: 'LOI (Client)', loio: 'LOI (Owner)', contract: 'Contract', collection: 'Collection', active: 'Active', renewal: 'For Renewal' }[SH.dealStageOf(rec, l.inquiry !== 'Buy', today())])}</b></div>` : ''}`;
  }
  const warnList = (ws) => (ws.length ? `<div class="src-err" role="alert"><b>Check before preparing:</b><ul>${ws.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '');
  /** The LOI pre-fill for a lead (Code.gs apiLoiDefaults): its latest Calendar deal → listing, or its latest portal viewing. */
  function loiDraftFor(l) {
    const dl = leadDeals(l);
    let deal = null, listing = null, ambiguous = false;
    if (dl.rows) {
      const st = SH.dealStages(dl.rows, today()); deal = st && st.deal;
      if (deal) ({ listing, ambiguous } = SH.loiListing(D.listings, deal.building, deal.rate || deal.price));
    } else {
      // portal (MongoDB / demo) viewings name their listing directly: the latest done or confirmed one
      const v = leadViewings(l, ['Done', 'Confirmed']).filter((x) => listingById(x.listingId)).pop();
      if (v) { listing = listingById(v.listingId); deal = { sp: v.broker, building: listing.building }; }
    }
    return { dl, deal, listing, dr: SH.loiDraft({ lead: l, listing, deal, ambiguous, today: today() }) };
  }
  const loiSrc = () => (viewSrc() === 'monday' ? 'monday' : 'mongo');
  /** This lead's LOIs and the uploaded templates (server), loaded when the tab opens. */
  function loiState(l) {
    S.loi = S.loi || {};
    const k = loiSrc() + ':' + l.id;
    if (!S.loi[k] && !DEMO) { S.loi[k] = { loading: true }; setTimeout(() => loadLoi(l, k), 0); }
    return S.loi[k] || {};
  }
  async function loadLoi(l, k) {
    try { const r = await API.get(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}`); S.loi[k] = { ...(S.loi[k] || {}), loading: false, err: '', lois: r.lois, templates: r.templates, signing: r.signing }; }
    catch (e) { if (signedOut(e)) return; S.loi[k] = { ...(S.loi[k] || {}), loading: false, err: e.message }; }
    if (S.open === l.id && DEAL_TABS[S.tab]) renderDrawerBody();
  }
  const LOI_DATE = () => new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
  function loiPanel(l, side) {
    const { dl, deal, listing, dr } = loiDraftFor(l), st = loiState(l);
    const lois = st.lois || [], tpls = st.templates || [], hasTpl = (s) => tpls.some((t) => t.slot === s);
    const head = `${dl.note ? `<div class="${dl.error ? 'src-err' : 'empty'}" ${dl.error ? 'role="alert"' : ''}>${esc(dl.note)}</div>` : ''}
      <div class="panel-sub"><b>${esc(dr.kind)}</b>${deal && deal.loi ? ` · LOI date on Monday ${esc(fmtDate(deal.loi))}` : ''}${deal && deal.files ? ` · LOI file on the Calendar item: ${deal.files.loi ? 'yes' : 'no'}` : ''}</div>`;
    // e-signature status and actions per LOI (client first, then the owner; src/loiSign.js)
    const sg = st.signing, canSend = access('leads') === 'edit' && sg && sg.ready;
    const STATUS = { draft: 'Draft', sent: 'Sent to the client', clientSigned: 'Signed by the client', ownerSent: 'Sent to the owner', signed: 'Signed by both' };
    // a signature is saved first; its copies (Drive, the unit's deal files) follow, and a failure there can be retried
    const storeNote = (x, role) => {
      const s = x.signed[role], st2 = s.store, dl = s.deal; if (!st2) return '';
      const pending = st2.status === 'pending' || st2.status === 'failed' || (dl && dl.status === 'failed');
      if (!pending) return `<div class="sub">${s.drive ? 'Copy saved in Google Drive' : 'Signed copy kept in the portal'}${dl && dl.status === 'linked' ? ' · in the unit\'s deal files' : ''}</div>`;
      const why = st2.status === 'failed' ? st2.error : dl && dl.status === 'failed' ? dl.error : 'Saving the copy…';
      return `<div class="src-err" role="status">The signature is safe (download it below), but its copy isn't saved yet: ${esc(why)}${canEdit('leads') ? ` <button class="btn sm" data-act="loistore" data-id="${esc(x.id)}" data-role="${role}">Try saving again</button>` : ''}</div>`;
    };
    const signActs = (x) => [
      x.status !== 'signed' && !(x.signed && x.signed.client) && side === 'client' ? `<button class="btn sm" data-act="loisend" data-id="${esc(x.id)}" data-role="client" ${canSend ? '' : 'disabled'}>${x.status === 'sent' ? 'Send again' : 'Send for e-signature'}</button>` : '',
      x.signed && x.signed.client && !x.signed.owner ? `<button class="btn sm" data-act="loisend" data-id="${esc(x.id)}" data-role="owner" ${canSend ? '' : 'disabled'}>${x.status === 'ownerSent' ? 'Send to owner again' : 'Send to the owner'}</button>` : '',
      x.hasSigned ? `<button class="btn sm ghost" data-act="loisigned" data-id="${esc(x.id)}" data-fmt="docx">Signed .docx</button>${x.signed && (x.signed.owner || x.signed.client || {}).pdf ? ` <button class="btn sm ghost" data-act="loisigned" data-id="${esc(x.id)}" data-fmt="pdf">Signed PDF</button>` : ''}` : ''].filter(Boolean).join(' ');
    const list = st.loading ? '<div class="empty">Loading this client\'s LOIs…</div>' : st.err ? `<div class="src-err" role="alert">${esc(st.err)}</div>`
      : `<table class="t deal-t" aria-label="Prepared LOIs"><thead><tr><th>Prepared</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>${lois.map((x) => `<tr><td>${esc(manilaTime(x.createdAt))}<div class="sub">${esc(x.by || '')}${x.unitName ? ' · ' + esc(x.unitName) : ''}</div></td><td>${esc(x.slotLabel)}${x.missing.length ? `<div><span class="tag warn">missing: ${esc(x.missing.join(', '))}</span></div>` : ''}</td>
          <td>${esc(STATUS[x.status] || x.status)}${x.signed && x.signed.client ? `<div class="sub">client: ${esc(x.signed.client.name)}, ${esc(manilaTime(x.signed.client.at))}</div>${storeNote(x, 'client')}` : ''}${x.signed && x.signed.owner ? `<div class="sub">owner: ${esc(x.signed.owner.name)}, ${esc(manilaTime(x.signed.owner.at))}</div>${storeNote(x, 'owner')}` : ''}</td>
          <td><button class="btn sm" data-act="loidl" data-id="${esc(x.id)}">Download .docx</button> ${signActs(x)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No LOI prepared for this client yet.</td></tr>'}</tbody></table>`;
    if (side === 'owner') {
      return `${head}<p class="sub">The owner signs the same LOI after the client (Code.gs apiSendLoiOwner). Owner on the listing: <b>${esc((listing && listing.contact) || 'unknown')}</b>${listing ? ` · owner phone on the listing: ${listing.contactPhone ? 'yes' : 'no'}` : ''}.</p>
        <h4 class="kr-h">LOIs prepared for this client</h4>${list}${setupBox('E-signature', sg)}${dealFilesHtml(l, 'loio')}`;
    }
    if (DEMO) return head + '<div class="empty">Preparing an LOI needs the portal\'s server (not in demo mode).</div>';
    // the form: defaults from the records (missing ones stay empty), the user's edits kept while the drawer is open
    // until the user edits a field, the form follows the records (the Calendar board may still be loading)
    const defaults = Object.fromEntries(dr.fields.filter((x) => x.state !== 'missing' && x.state !== 'entered').map((x) => [x.key, x.value]).concat([['DATE', LOI_DATE()]]));
    // (only what the records hold now: nothing left over from an earlier, fuller read)
    if (!st.form || !st.form.touched) st.form = { slot: dr.lease ? 'lease' : st.form && st.form.slot !== 'lease' ? st.form.slot : 'absolute', fields: defaults };
    const f = st.form;
    const chk = SH.validateLoi({ slot: f.slot, fields: f.fields }), byKey = Object.fromEntries(dr.fields.map((x) => [x.key, x]));
    // an LOI is the portal's own record (Monday stays read-only), so Leads edit access is enough on either source
    const lease = f.slot === 'lease', canMake = access('leads') === 'edit';
    const keys = SH.LOI_FIELDS.filter((k) => (lease ? k !== 'PRICE' : !['LEASE_TERM', 'MONTHLY_RENT', 'ADVANCE', 'DEPOSIT'].includes(k)));
    const LBL = { DATE: 'Date', TO_1: 'To / Owner', TO_2: 'Unit, building', TO_3: 'Location', DEAR: 'Dear', CLIENT: 'Client', BROKER_SIGN: 'Broker', PROPERTY: 'Property', LEASE_TERM: 'Lease term', MONTHLY_RENT: 'Monthly rent',
      ADVANCE: 'Advance rental', DEPOSIT: 'Security deposit', PRICE: 'Total purchase price', TERMS: 'Terms of payment', CONCESSIONS: 'Other concessions', COMM_PCT: 'Commission %' };
    const src = (k) => { const x = byKey[k]; if (k === 'DATE') return 'Today (Manila)';
      if (k === 'TERMS') return lease ? 'Typed when preparing, if any' : 'If left empty: the original default for this deed <span class="tag">original default</span>';
      if (!x) return 'Typed when preparing'; const def = x.state === 'missing' ? '<span class="tag warn">not in the records</span>' : x.state === 'default' ? '<span class="tag">original default</span>' : ''; return esc(x.note || 'From the records') + ' ' + def; };
    return `${head}${warnList(dr.warnings)}
      <div class="panel"><h3>Prepare LOI <span class="muted">filled from the records; check and complete every field, then make the document to review</span></h3><div class="pad">
        <label>Template <select data-ch="loislot" ${canMake ? '' : 'disabled'}>${Object.entries(SH.LOI_SLOTS).filter(([s]) => (dr.lease ? s === 'lease' : s !== 'lease') || s === f.slot).map(([s, lab]) => `<option value="${s}" ${f.slot === s ? 'selected' : ''}>${esc(lab)}${hasTpl(s) ? '' : ' (not uploaded)'}</option>`).join('')}</select></label>
        ${!st.loading && !hasTpl(f.slot) ? `<div class="src-err" role="alert">The ${esc(SH.LOI_SLOTS[f.slot])} template hasn't been uploaded. Someone with edit access to Settings uploads the team's Word template in Settings → Files.</div>` : ''}
        <table class="t deal-t loi-form" aria-label="LOI fields"><thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead><tbody>
          ${keys.map((k) => `<tr><th scope="row">${esc(LBL[k])}</th><td><input data-in="loif" data-k="${k}" value="${esc(f.fields[k] || '')}" ${k === 'COMM_PCT' ? 'inputmode="decimal" placeholder="e.g. 3"' : ''} aria-label="${esc(LBL[k])}" ${canMake ? '' : 'disabled'}>${k === 'COMM_PCT' && f.fields[k] ? `<div class="sub">${esc(SH.numberWords(f.fields[k]))} percent</div>` : ''}</td><td class="sub">${src(k)}</td></tr>`).join('')}</tbody></table>
        ${chk.errors.length ? `<div class="src-err" role="alert">${esc(chk.errors[0])}</div>` : chk.missing.length ? `<div class="src-err" role="alert"><b>Still empty:</b> ${esc(chk.missing.join(', '))}. They stay as blank lines in the document.</div>` : ''}
        <div class="kr-actions">${canMake ? `<button class="btn primary" data-act="loimake" ${st.making || chk.errors.length || !hasTpl(f.slot) ? 'disabled' : ''}>${st.making ? 'Making…' : 'Make the LOI document for review'}</button>` : '<span class="sub">Making an LOI needs edit access to Leads.</span>'}
          <span class="sub">Makes a filled copy of the template to download and check. Nothing is sent.</span></div></div></div>
      <h4 class="kr-h">LOIs prepared for this client</h4>${list}${setupBox('E-signature', sg)}${dealFilesHtml(l, 'loic')}`;
  }
  function dealPanel(l, tab) {
    const dl = leadDeals(l), st = dl.rows ? SH.dealStages(dl.rows, today()) : null, d = st && st.deal;
    // the Apps Script portal never generated contracts: the signed contract, deposit slip and renewal contract were
    // uploaded files (Code.gs DEAL_SLOTS_ / apiDealUpload, to Google Drive)
    const files = dealFilesHtml(l, tab);
    const head = (tab === 'contract' ? `<div class="sub">The contract is not generated by the portal (the Apps Script didn't either): the signed contract is uploaded below, with the lease start and months. The team's Contract of Lease form needs details the portal doesn't hold (both parties' addresses and IDs, the agreed terms), so it is never filled from guesses.</div>` : '') + files
      + '<h4 class="kr-h">From the Monday Calendar board <span class="muted">read only</span></h4>';
    if (!dl.rows) return head + `<div class="${dl.error ? 'src-err' : 'empty'}" ${dl.error ? 'role="alert"' : ''}>${esc(dl.note)}</div>`;
    if (!d) return head + (st ? warnList(st.warnings) : '<div class="empty">No Calendar-board item is linked to this client yet.</div>');
    const yn = (b) => (b ? 'yes' : 'no'), dt = (s) => (s ? esc(fmtDate(s)) : '<span class="muted">—</span>'), pz = (n) => (n ? esc(money(n)) : '<span class="muted">—</span>');
    const rows = {
      contract: [['Status', esc(d.status || '—')], ['LOI date', dt(d.loi)], ['Contract Date', dt(d.contract)], ['Contract file on the Calendar item', yn(d.files && d.files.contract)], ['Signed Contract file', yn(d.files && d.files.signed)], ['Rental rate / price', pz(d.rate || d.price)]],
      collection: [['Total Paid', pz(d.paid)], ['Date of Payment', dt(d.pay)], ['Collection Date', dt(d.coll)], ['Blackhouse commission', pz(d.comm)]],
      active: [['Contract Date', dt(d.contract)], ['Contract expiration', dt(d.exp)], ['Renewal date', dt(d.rdate)], ['Type', esc(d.type || '—')]],
      renewal: [['Renewal date', dt(d.rdate)], ['Renewal status', esc(d.rst || '—')], ['Contract expiration', dt(d.exp)]],
    }[tab];
    return `${head}<div class="panel-sub">From the Monday Calendar board${d.building ? ` · ${esc(d.building)}` : ''}${st.others ? ` · ${st.others} other Calendar item${st.others > 1 ? 's' : ''} for this client` : ''}</div>
      ${warnList(tab === 'contract' ? st.warnings : st.warnings.filter((w) => !/5-day/.test(w)))}
      <table class="t deal-t" aria-label="Deal details"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
  }
  /** Redraws only the open tab's content and footer (header and tabs stay, so focus is kept). */
  function renderDrawerBody() {
    const l = leadById(S.open), body = $('#dbody'); if (!l || !body) return;
    const panel = { details: detailsPanel, props: propsPanel, asking: askingPanel, approval: approvalPanel, viewings: () => interestedHtml(l) + viewingsPanel(l, ['Proposed']), confirmed: () => viewingsPanel(l, ['Confirmed']), done: () => viewingsPanel(l, ['Done', 'Cancelled']), chat: chatPanel,
      loic: (x) => loiPanel(x, 'client'), loio: (x) => loiPanel(x, 'owner'), contract: (x) => dealPanel(x, 'contract'), collection: (x) => dealPanel(x, 'collection'), active: (x) => dealPanel(x, 'active'), renewal: (x) => dealPanel(x, 'renewal') }[S.tab];
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
    const chips = [], known = (v) => v != null && v !== '';
    // a field the listing leaves blank is never a hit (Code.gs matchListing0_: "no price on listing" is a miss), so
    // incomplete listings don't rank above complete ones
    // "BGC", "Taguig" and "Taguig (BGC)" are the same place; a lead may name several areas
    const hasCity = known(x.city) && x.city !== 'City not set';
    chips.push(['Location', hasCity && (x.city === l.city || SH.citiesIn(l.city + ' ' + (l.location || '')).includes(x.city))]);
    chips.push(['Bedrooms', known(x.bedrooms) && known(l.bedrooms) && x.bedrooms === l.bedrooms]);
    if (l.budget) chips.push(['Budget', x.price > 0 && x.price <= l.budget * 1.15]);
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
    return `<div class="lcard"><div class="lph ${ph ? 'has-photo' : ''}" style="--h:${x.hue}">${photo}<span class="badge ${cls}" title="${esc(x.availabilityLabel || x.availability)}">${esc(x.availability)}</span>${extra && extra.score != null ? `<span class="score">Match ${extra.score}</span>` : ''}<span class="ini">${esc(initials(x.building))}<small>${ph ? 'Photo unavailable' : 'No photo'}</small></span></div>
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
    // ties: cheapest first, listings without a price last (Code.gs apiGetMatches)
    const pr = (x) => (x.price > 0 ? x.price : 9e15);
    return scored.filter(([x]) => keep.has(x)).sort((a, b) => b[1].score - a[1].score || pr(a[0]) - pr(b[0]));
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
  /**
   * For Client Approval (Index.html approvalPanel): units the owner confirmed, not yet moved to scheduling. Copy the
   * message for the client (the Apps Script's text; the portal doesn't send it), mark it sent, then "For Scheduling →"
   * when the client wants to view; "← Back to Asking" undoes the owner's answer.
   */
  function approvalPanel(l) {
    const st = askState(l);
    if (!st.list) { loadAsking(l); return st.error ? `<div class="src-err" role="alert">${esc(st.error)} <button class="linkbtn" data-act="askreload">Try again</button></div>` : '<div class="muted">Loading…</div>'; }
    const list = st.list.filter((a) => a.status === 'available' && !a.interestedAt), edit = canAsk(), sel = S.apprSel = S.apprSel || new Set();
    const notSent = list.filter((a) => !a.sentAt).length;
    const intro = `<div class="sub" style="margin-bottom:10px">Units the owner confirmed are available. Copy the message to the client (the portal doesn't send it), then mark them sent. When the client wants to view a unit, move it to For Scheduling. Saved ${DEMO ? 'in this browser (demo)' : 'in the portal'}: nothing is written to Monday.com.</div>`;
    if (!list.length) return intro + '<div class="empty">No owner-confirmed units waiting. In Asking for Availability, mark a unit "Owner confirmed available".</div>';
    return intro + `<div class="toolbar"><label class="tagck"><input type="checkbox" data-ch="apprall" ${list.every((a) => sel.has(a.id)) ? 'checked' : ''}> Select all</label><span class="sub">${list.length} confirmed by the owner · ${notSent} not sent yet · ${list.filter((a) => sel.has(a.id)).length} selected</span>
        ${edit && list.some((a) => sel.has(a.id) && a.sentAt) ? `<button class="btn sm primary" data-act="apprschedsel">For Scheduling (${list.filter((a) => sel.has(a.id) && a.sentAt).length}) →</button>` : ''}
        ${edit ? `<button class="btn sm" data-act="apprcopy" data-v="sel">Copy message for selected</button><button class="btn sm" data-act="apprcopy" data-v="notsent" ${notSent ? '' : 'disabled'}>Copy message for all not sent (${notSent})</button>` : ''}</div>
      <div class="asklist">${list.map((a) => { const x = listingById(a.listingId);
        return `<div class="askcard"><label class="tagck"><input type="checkbox" data-ch="apprsel" data-id="${esc(a.id)}" ${sel.has(a.id) ? 'checked' : ''}> <b>${esc(a.listingName || (x && x.building) || a.listingId)}</b></label>
          <div class="sub">${a.sentAt ? `Sent to the client ${esc(ago(a.sentAt))}${a.sentBy ? ' by ' + esc(a.sentBy) : ''}` : 'Not sent to the client yet'}${a.answeredAt ? ' · owner confirmed ' + esc(ago(a.answeredAt)) : ''}</div>
          ${edit ? `<div class="kr-actions">${a.sentAt ? `<button class="btn sm primary" data-act="apprsched" data-id="${esc(a.id)}">For Scheduling →</button><button class="btn sm ghost" data-act="apprsent" data-id="${esc(a.id)}" data-v="0">Not sent after all</button>`
            : `<button class="btn sm" data-act="apprsent" data-id="${esc(a.id)}" data-v="1">Mark as sent to the client</button>`}<button class="btn sm ghost" data-act="apprback" data-id="${esc(a.id)}">← Back to Asking</button></div>` : ''}</div>`; }).join('')}</div>`;
  }
  /** For Scheduling, first part: units the client wants to view (the Apps Script's 'interested'), to book. */
  function interestedHtml(l) {
    const st = askState(l); if (!st.list) { loadAsking(l); return ''; }
    const list = st.list.filter((a) => a.status === 'available' && a.interestedAt); if (!list.length) return '';
    const edit = canAsk(), book = canEdit('calendar');
    return `<h4 class="kr-h">The client wants to view <span class="muted">set the time and broker, then book</span></h4><div class="asklist">${list.map((a) => `<div class="askcard"><b>${esc(a.listingName || a.listingId)}</b>
      <div class="sub">Client interested ${esc(ago(a.interestedAt))}${a.interestedBy ? ' · ' + esc(a.interestedBy) : ''}</div>
      ${edit ? `<div class="kr-actions">${book && listingById(a.listingId) ? `<button class="btn sm primary" data-act="book" data-id="${esc(a.listingId)}">📅 Book viewing</button>` : `<span class="sub">${DEMO || S.source !== 'monday' ? 'Booking needs Calendar edit access.' : 'Schedule it on the Monday Calendar board.'}</span>`}
        <button class="btn sm ghost" data-act="apprunsched" data-id="${esc(a.id)}">← Back to For Client Approval</button></div>` : ''}</div>`).join('')}</div>`;
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
  // VA Portal task groups, as the Apps Script (apiGetVaPortal): Asking → For Client Approval (not sent / sent) → For
  // Scheduling (client interested) → Proposed → Confirmed → Mark done → Record result; the portal adds Reply to client
  // and Send more units.
  const VA_GROUPS = ['Reply to client', 'Asking owner', 'Approval · not sent', 'Approval · sent', 'For Scheduling', 'Confirm schedule', 'Confirmed viewing', 'Mark as done', 'Record result', 'Send more units'];
  // the Apps Script's hints for the approval and scheduling groups (Index.html 3228)
  const VA_HINT = { 'Approval · not sent': 'Owner confirmed — send to the client', 'Approval · sent': 'Sent — move to For Scheduling when the client wants to view', 'For Scheduling': 'Set the time / broker and book' };
  /** The open Asking for Availability records of the visible clients (loaded for the VA Portal). */
  function vaAskState() {
    if (DEMO || access('vaportal') === 'none') return { rows: [], at: 1 };
    if (!S.vaAsk || (!S.vaAsk.loading && Date.now() - S.vaAsk.at > 120e3)) {
      S.vaAsk = { ...(S.vaAsk || { rows: [], at: 0 }), loading: true };
      const token = S.srcToken;
      API.get('/api/asking/open?source=' + (viewSrc() === 'monday' ? 'monday' : 'mongo'))
        .then((r) => { if (token === S.srcToken) S.vaAsk = { rows: r.rows || [], at: Date.now(), loading: false }; }, (e) => { if (!signedOut(e)) S.vaAsk = { rows: [], at: Date.now(), loading: false, error: e.message }; })
        .then(() => { if (S.view === 'vaportal') renderView(); renderSide(); });
    }
    return S.vaAsk;
  }
  function vaPending() {
    const out = [], now = Date.now(), vv = visibleViewings();
    // as the Apps Script: failed, disqualified, unresponsive and closed clients have nothing pending
    const vis = visibleLeads().filter((l) => l.ai !== 'Failed' && !/fail|disqualif|unresponsive|closed/i.test(String(l.clientStatus || l.status || '')));
    const ok = new Set(vis.map((l) => l.id)), lead = (id) => (ok.has(id) ? leadById(id) : null);
    vis.filter((l) => l.onRespond && l.waiting === 'va').forEach((l) => out.push([l, 'Reply to client', 'Needs VA Reply']));
    // Asking → For Client Approval (not sent / sent) → For Scheduling; as the Apps Script, a unit that already has a
    // live portal viewing is left out (Monday Calendar viewings aren't tied to a listing, so they can't be matched)
    const liveUnit = new Set(vv.filter((v) => v.status !== 'Cancelled' && v.listingId).map((v) => v.leadId + '|' + v.listingId));
    const GROUP = { asking: 'Asking owner', apprNew: 'Approval · not sent', apprSent: 'Approval · sent', sched: 'For Scheduling' };
    (vaAskState().rows || []).forEach((a) => { const l = lead(a.leadId); if (l && GROUP[a.stage] && !liveUnit.has(a.leadId + '|' + a.listingId)) out.push([l, GROUP[a.stage], (a.listingName || 'a unit') + (VA_HINT[GROUP[a.stage]] ? ' · ' + VA_HINT[GROUP[a.stage]] : '')]); });
    const pendIds = new Set(S.pend && S.pend.at ? S.pend.rows.map((r) => String(r.id)) : []);
    vv.forEach((v) => {
      const l = lead(v.leadId); if (!l || pendIds.has(String(v.id))) return;   // listed once, under Record result
      const when = fmtShort(v.date) + ' ' + (v.time || ''), unit = unitOf(v).building;
      if (v.status === 'Proposed') out.push([l, 'Confirm schedule', when + ' · ' + unit]);
      else if (v.status === 'Confirmed') out.push([l, SH.viewingAt(v) < now ? 'Mark as done' : 'Confirmed viewing', when + ' · ' + unit]);
      else if (v.status === 'Done' && !resultOf(v) && !v.feedback && !(S.pend && S.pend.at)) out.push([l, 'Record result', when + ' · ' + unit]);
    });
    // a viewing that happened without a result: the Pending Broker Feedback list once loaded (the Apps Script rules)
    if (S.pend && S.pend.at) S.pend.rows.forEach((r) => { const l = lead(r.leadId); if (l) out.push([l, 'Record result', fmtShort(r.date) + ' ' + (r.time || '') + ' · ' + ((r.unit && r.unit.building) || '')]); });
    vis.filter((l) => l.ai === 'Property Matching' && l.daysInStage > 14).forEach((l) => out.push([l, 'Send more units', l.daysInStage + ' days in Property Matching']));
    return out.sort((a, b) => VA_GROUPS.indexOf(a[1]) - VA_GROUPS.indexOf(b[1]));
  }
  function vaPortalView() {
    if (!(S.pend && S.pend.at) && canSee('calendar')) setTimeout(loadPending, 0);
    // Managers pick a VA (Code.gs apiGetVaPortal va / byVa); everyone else sees their own clients (server scoping)
    const all = vaPending(), ask = vaAskState(), vf = isManager() ? S.vapVa || '' : '';
    const rows = vf ? all.filter(([l]) => (vf === '__none' ? !l.va : SH.sameVa(l.va, vf))) : all;
    const byVa = isManager() ? SH.vaLabels(all.map(([l]) => l.va)).map((v) => [v, all.filter(([l]) => SH.sameVa(l.va, v)).length]) : [];
    return `<div class="cards">${VA_GROUPS.map((k) => `<div class="card"><div class="n">${rows.filter((r) => r[1] === k).length}</div><div class="l">${k}</div></div>`).join('')}</div>
      ${ask.error ? `<div class="src-err" role="alert">The Asking for Availability list could not be loaded (${esc(ask.error)}), so "Asking owner" may be incomplete.</div>` : ''}
      <div class="panel"><h3>Pending actions <span class="muted">${rows.length} items · ${srcName()}</span><span class="spacer"></span>
        ${isManager() ? `<select data-ch="vapva" aria-label="VA"><option value="">All VAs</option><option value="__none" ${vf === '__none' ? 'selected' : ''}>Unassigned</option>${byVa.map(([v, n]) => `<option value="${esc(v)}" ${SH.sameVa(vf, v) ? 'selected' : ''}>${esc(v)} (${n})</option>`).join('')}</select>` : ''}</h3><div class="scroll-x"><table class="t"><thead><tr><th>Lead</th><th>Client</th><th>VA</th><th>Action</th><th>Detail</th><th>AI Status</th></tr></thead><tbody>
      ${rows.map(([l, a, d]) => `<tr class="click" data-act="open" data-id="${esc(l.id)}"><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.va || 'Unassigned')}</td><td><b>${esc(a)}</b></td><td>${esc(d)}</td><td>${aiPill(l)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing pending.</td></tr>'}
      </tbody></table></div></div>`;
  }
  // people on screen: the board's own labels for live Monday data; the preview's lists for MongoDB / demo records
  // (one entry per VA: "Ana" and "ana" on the board are the same VA, as the server's lead scoping treats them)
  // the preview's fictional names only in demo mode; live data (Monday or MongoDB) lists the names it actually holds
  const vaNames = () => SH.vaLabels((DEMO ? LISTS.vas : []).concat(D.leads.map((l) => l.va)));
  const brokerNames = () => (DEMO ? LISTS.brokers : [...new Set(visibleViewings().map((v) => v.broker).filter(Boolean))].sort());
  function monitorView() {
    const vis = visibleLeads(), vv = visibleViewings(), vas = isManager() ? vaNames() : [me().vaLabel].filter(Boolean);
    const rows = vas.map((va) => { const w = SH.vaWorkload(vis, vv, va); return [va, w.leads, w.needsReply, w.hot, w.viewings, w.loiPlus, w.failed]; });
    const needs = vis.filter((l) => l.onRespond && l.waiting === 'va').length;
    return `<div class="cards"><div class="card"><div class="n">${needs}</div><div class="l">Needs VA Reply</div></div><div class="card"><div class="n">${vis.filter((l) => l.onRespond && l.waiting === 'client').length}</div><div class="l">Waiting on Client</div></div>
        <div class="card"><div class="n">${vis.filter((l) => !l.va).length}</div><div class="l">Unassigned leads</div></div><div class="card"><div class="n">${vis.filter((l) => l.temp === 'Hot').length}</div><div class="l">🔥 Hot leads</div></div></div>
      <div class="panel"><h3>Response monitor &amp; KPIs per VA <span class="muted">${srcName()} · response times and scores come from respond.io in the live portal</span></h3>
      <div class="scroll-x"><table class="t"><thead><tr><th>VA</th><th class="num">Leads</th><th class="num">Needs reply</th><th class="num">Hot</th><th class="num">Viewings</th><th class="num">LOI or later</th><th class="num">Failed</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" data-act="filterva" data-v="${esc(r[0])}"><td><b>${esc(r[0])}</b></td>${r.slice(1).map((n, i) => `<td class="num ${i === 1 && n ? 'hotnum' : ''}">${n}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>
      ${vaPerformanceHtml()}`;
  }
  function brokersView() {
    // pending feedback: the Pending Broker Feedback list once loaded (the Apps Script rules), else Done without a result
    const pend = S.pend && S.pend.at ? S.pend.rows : null;
    if (!pend && canSee('calendar')) setTimeout(loadPending, 0);
    const rows = brokerNames().map((b) => { const vs = visibleViewings().filter((v) => v.broker === b), ids = new Set(vs.map((v) => v.leadId)), ls = visibleLeads().filter((l) => ids.has(l.id));
      return [b, vs.filter((v) => v.status !== 'Cancelled').length, ids.size, pend ? pend.filter((r) => r.broker === b).length : vs.filter((v) => v.status === 'Done' && !resultOf(v) && !v.feedback).length,
        ls.filter((l) => LEAD_PLUS.includes(l.ai)).length, ls.filter((l) => ['Active', 'For Renewal'].includes(l.ai)).length]; });
    return `<div class="panel"><h3>Brokers <span class="muted">${srcName()}</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Broker</th><th class="num">Viewings</th><th class="num">Unique clients</th><th class="num">Pending feedback</th><th class="num">LOIs or later</th><th class="num">Closed</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r[0])}</b></td>${r.slice(1).map((n, i) => `<td class="num ${i === 2 && n ? 'hotnum' : ''}">${n}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="6" class="muted">${S.srcErrors && Object.keys(S.srcErrors).length ? 'The viewings could not be loaded (see the message above).' : 'No brokers with viewings.'}</td></tr>`}</tbody></table></div></div>
      ${brokerMonthsHtml()}`;
  }
  // ---------- Calendar-board deals: Leads Report, Renewals, P&L, Broker / VA figures (Monday source; read only) ----------
  /** The deals of the Monday Calendar board this user may see, loading them when needed; null for other sources. */
  function dealsState() {
    if (viewSrc() !== 'monday') return null;
    if (!S.deals || (!S.deals.loading && Date.now() - S.deals.at > 300e3)) setTimeout(loadDeals, 0);
    return S.deals || { rows: [], at: 0, loading: true };
  }
  async function loadDeals() {
    if (DEMO || S.source !== 'monday' || !S.user || (S.deals && S.deals.loading)) return;
    const token = S.srcToken;
    S.deals = { ...(S.deals || { rows: [], at: 0 }), loading: true };
    try {
      const r = await API.get('/api/monday/deals');
      if (token !== S.srcToken) { S.deals.loading = false; return; }
      S.deals = { rows: r.deals || [], at: Date.now(), loading: false, error: '' };
    } catch (e) { if (signedOut(e)) return; S.deals = { rows: [], at: Date.now(), loading: false, error: e.message }; }
    if (['ldash', 'renewals', 'pl', 'brokers', 'monitor'].includes(S.view)) renderView();
    if (S.open && DEAL_TABS[S.tab]) renderDrawerBody();
  }
  const dealsNote = (st) => (!st.at ? '<div class="empty">Loading the Monday Calendar board…</div>' : st.error ? `<div class="src-err" role="alert">${esc(st.error)}</div>` : '');
  // period selector (Last 3 / 6 / 12 months / All time), kept per screen
  const RANGES = [['3', 'Last 3 months'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['all', 'All time']];
  const rangeOf = (key, def) => ((S.rng || {})[key] || def);
  const rangeSel = (key, def) => `<select data-ch="rng" data-k="${key}" aria-label="Period">${RANGES.map(([v, l]) => `<option value="${v}" ${rangeOf(key, def) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  /** 'YYYY-MM' months of the period, oldest first (All time: from the first month with data, at most 10 years). */
  function monthsIn(r, first) {
    const out = [], d = new Date(), n = r === 'all' ? 120 : Number(r) || 6;
    for (let i = 0; i < n; i++) { const k = ymd(new Date(d.getFullYear(), d.getMonth() - i, 1)).slice(0, 7); if (r === 'all' && first && k < first) break; out.push(k); }
    return out.reverse();
  }
  const monLabel = (m) => { const d = parseYmd(m + '-01'); return d ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : m; };
  const peso = (n) => (n ? '₱' + Math.round(n).toLocaleString('en-PH') : '—');
  const dFailed = SH.dealFailed;
  const dType = (d) => (/sale/i.test(d.type) ? 'Sale' : /renewal/i.test(d.type) ? 'Renewal' : 'Rental');
  // collected commission (Code.gs collectedByLead_ / apiGetPL): Total Paid on a "Closed" row with a Date of Payment
  const dCollected = (d) => (!dFailed(d) && /^closed$/i.test(String(d.status || '').trim()) && d.pay ? d.paid || 0 : 0);
  const firstMonth = (rows, f) => rows.map(f).filter(Boolean).sort()[0] || '';

  /** Leads Report → Closed Deals — Commission Collected (Code.gs closedDeals_; rent and sale, renewals left out). */
  function closedDealsHtml() {
    const st = dealsState(); if (!st) return '';
    const head = `<div class="panel"><h3>Closed Deals — Commission Collected <span class="muted">Monday Calendar board · Total Paid on Closed deals with a Date of Payment</span><span class="spacer"></span>${rangeSel('ldash', '12')}</h3>`;
    if (!st.at || st.error) return head + dealsNote(st) + '</div>';
    const rows = st.rows.filter((d) => !/renewal/i.test(d.type) && dCollected(d) > 0).map((d) => {
      const l = leadById(d.leadId);
      return { m: (d.contract || d.pay).slice(0, 7), ty: /sale/i.test(d.type) || (!d.type && l && l.inquiry === 'Buy') ? 'Sale' : 'Rent', amt: dCollected(d),
        city: SH.canonCity(d.city, d.building) || d.city || 'City not set', bld: d.building || '—' };
    });
    const months = monthsIn(rangeOf('ldash', '12'), firstMonth(rows, (x) => x.m)), set = new Set(months), inR = rows.filter((x) => set.has(x.m));
    const sum = (xs) => xs.reduce((a, x) => a + x.amt, 0);
    const group = (key) => { const g = {}; inR.forEach((x) => { (g[x[key]] = g[x[key]] || []).push(x); }); return Object.entries(g).sort((a, b) => sum(b[1]) - sum(a[1])); };
    const byTable = (title, key) => `<div class="panel"><h3>${title}</h3><div class="scroll-x"><table class="t"><thead><tr><th></th><th class="num">Deals</th><th class="num">Rent</th><th class="num">Sale</th><th class="num">Collected</th></tr></thead><tbody>
      ${group(key).slice(0, 15).map(([k, xs]) => `<tr><td>${esc(k)}</td><td class="num">${xs.length}</td><td class="num">${peso(sum(xs.filter((x) => x.ty === 'Rent')))}</td><td class="num">${peso(sum(xs.filter((x) => x.ty === 'Sale')))}</td><td class="num"><b>${peso(sum(xs))}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No collected commission in this period.</td></tr>'}</tbody></table></div></div>`;
    return head + `<div class="cards"><div class="card"><div class="n">${peso(sum(inR))}</div><div class="l">Commission collected</div></div><div class="card"><div class="n">${inR.length}</div><div class="l">Closed deals paid</div></div>
        <div class="card"><div class="n">${peso(sum(inR.filter((x) => x.ty === 'Rent')))}</div><div class="l">Rent</div></div><div class="card"><div class="n">${peso(sum(inR.filter((x) => x.ty === 'Sale')))}</div><div class="l">Sale</div></div></div>
      <div class="scroll-x"><table class="t"><thead><tr><th>Month</th><th class="num">Rent</th><th class="num">Sale</th><th class="num">Total</th></tr></thead><tbody>
      ${months.map((m) => { const xs = inR.filter((x) => x.m === m); return `<tr><td>${esc(monLabel(m))}</td><td class="num">${peso(sum(xs.filter((x) => x.ty === 'Rent')))}</td><td class="num">${peso(sum(xs.filter((x) => x.ty === 'Sale')))}</td><td class="num"><b>${peso(sum(xs))}</b></td></tr>`; }).join('')}
      </tbody></table></div></div><div class="cols2">${byTable('By city', 'city')}${byTable('By building', 'bld')}</div>`;
  }

  /** Renewals from the Calendar board (Code.gs renewalLeases_): one lease per client, its next due date and status. */
  function leasesFromDeals(rows) {
    const now = Date.now(), lim = ymd(new Date(now - 60 * 864e5)), byLead = {};
    rows.forEach((d) => {
      if (!d.leadId || /fail/i.test(d.status) || /sale/i.test(d.type)) return;
      if (!(d.contract || /^closed$|waiting for payment|renew/i.test(String(d.status).trim()) || /renewal/i.test(d.type))) return;
      (byLead[d.leadId] = byLead[d.leadId] || []).push(d);
    });
    return Object.entries(byLead).map(([lid, rs]) => {
      const l = leadById(lid); if (!l) return null;   // only clients this user can see
      const base = rs.filter((r) => !/renewal/i.test(r.type)).sort((a, b) => String(b.contract).localeCompare(String(a.contract)))[0] || rs[0];
      const start = rs.map((r) => r.contract).filter(Boolean).sort().pop() || '';
      let cands = rs.map((r) => r.exp).concat(rs.filter((r) => /renewal/i.test(r.type) && r.rdate && !r.pay).map((r) => r.rdate)).filter(Boolean), est = false;
      if (!cands.length && start) {   // no end date on Monday: start + lease term (months, else 12), rolled forward
        const term = parseInt((String(l.leaseTerm || '').match(/\d+/) || [])[0], 10) || 12;
        let d = parseYmd(start), n = 0;
        do { d = new Date(d.getFullYear(), d.getMonth() + term, d.getDate()); } while (ymd(d) < lim && ++n < 60);
        cands = [ymd(d)]; est = true;
      }
      if (!cands.length) return null;
      cands = [...new Set(cands)].sort();
      const due = cands.find((c) => c >= lim) || cands[cands.length - 1], row = rs.find((r) => r.exp === due || r.rdate === due) || base;
      let status = row.rst || (/renewed/i.test(row.status) ? 'Closed' : 'Upcoming Renewal');
      if (rs.some((r) => /non-?renew/i.test(r.rst)) && !cands.some((c) => c >= today())) status = 'Non-renewed';
      return { lead: l, leadId: lid, building: base.building, city: base.city, rent: base.price || base.rate, start, due, est, days: daysUntil(due), status,
        broker: base.sp, renewals: rs.filter((r) => /renewal/i.test(r.type) && r.pay).length };
    }).filter(Boolean).sort((a, b) => a.days - b.days);
  }
  const rnDone = (x) => /closed|non-?renew/i.test(x.status);
  const RN_SEG = {
    due90: ['Next 90 days', (x) => x.days >= -30 && x.days <= 90 && !rnDone(x)], overdue: ['Overdue', (x) => x.days < 0 && !rnDone(x)],
    due30: ['Due ≤ 30 days', (x) => x.days >= 0 && x.days <= 30], due60: ['31–60 days', (x) => x.days > 30 && x.days <= 60],
    later: ['91–180 days', (x) => x.days > 90 && x.days <= 180], renewed: ['Renewed', (x) => /closed/i.test(x.status)],
    lost: ['Not renewed', (x) => /non-?renew/i.test(x.status)], all: ['All leases', () => true],
  };
  async function loadRenewalLog() {
    if (DEMO || !S.user || (S.rnLog && S.rnLog.loading)) return;
    const token = S.srcToken; S.rnLog = { ...(S.rnLog || { log: {}, at: 0 }), loading: true };
    try { const r = await API.get('/api/renewals/log?source=' + (S.source === 'monday' ? 'monday' : 'mongo')); if (token !== S.srcToken) { S.rnLog.loading = false; return; } S.rnLog = { log: r.log || {}, at: Date.now(), loading: false }; }
    catch (e) { if (signedOut(e)) return; S.rnLog = { log: {}, at: Date.now(), loading: false, error: e.message }; }
    if (S.view === 'renewals') renderView();
  }
  const rnLogOf = (id) => (S.rnLog && S.rnLog.log[id]) || [];
  const tplLabel = (k) => (SH.RENEWAL_TEMPLATES.find((t) => t.k === k) || { label: k }).label;
  function renewalsView() {
    const st = dealsState();
    if (st) {
      if (!S.rnLog || (!S.rnLog.loading && Date.now() - S.rnLog.at > 120e3)) setTimeout(loadRenewalLog, 0);
      const head = `<div class="panel"><h3>Renewals <span class="muted">leases from the Monday Calendar board · messages are written here and sent from respond.io by you</span></h3>`;
      if (!st.at || st.error) return head + dealsNote(st) + '</div>';
      const all = leasesFromDeals(st.rows), seg = RN_SEG[S.rnSeg] ? S.rnSeg : 'due90', q = (S.rnQ || '').toLowerCase().trim();
      const vaF = isManager() ? S.rnVa || '' : '';
      const rows = all.filter(RN_SEG[seg][1]).filter((x) => (!vaF || SH.sameVa(x.lead.va, vaF)) &&(!q || [x.lead.name, x.building, x.lead.va, x.broker].join(' ').toLowerCase().includes(q)));
      const due90 = all.filter(RN_SEG.due90[1]), messaged = due90.filter((x) => rnLogOf(x.leadId).some((e) => /^renew/.test(e.kind))).length;
      const tile = (k, n, extra) => `<button type="button" class="card ${seg === k ? 'on' : ''}" data-act="rnseg" data-v="${k}" aria-pressed="${seg === k}"><div class="n">${n}</div><div class="l">${RN_SEG[k][0]}${extra || ''}</div></button>`;
      const badge = (d) => `<span class="pill" style="--c:${d < 0 || d <= 30 ? '#f85149' : d <= 60 ? '#d29922' : d <= 90 ? 'var(--accent)' : '#8b949e'}">${d < 0 ? Math.abs(d) + ' d overdue' : d + ' d'}</span>`;
      const edit = access('renewals') === 'edit';
      // until the message log has loaded, "Last message" and "Messaged" are unknown (not "none"), so nobody is messaged twice
      const logOk = !!(S.rnLog && S.rnLog.at && !S.rnLog.error);
      const logNote = S.rnLog && S.rnLog.error ? `<div class="src-err" role="alert">The renewal message log could not be loaded (${esc(S.rnLog.error)}), so "Last message" is unknown. Check respond.io before messaging anyone. <button class="linkbtn" data-act="rnlogretry">Try again</button></div>`
        : !logOk ? '<div class="empty">Loading the renewal message log…</div>' : '';
      return `<div class="cards">${tile('overdue', all.filter(RN_SEG.overdue[1]).length)}${tile('due30', all.filter(RN_SEG.due30[1]).length)}${tile('due60', all.filter(RN_SEG.due60[1]).length)}
          <div class="card"><div class="n">${due90.length && logOk ? Math.round(messaged / due90.length * 100) + '%' : '—'}</div><div class="l">Messaged (next 90 days)</div></div>
          ${tile('renewed', all.filter(RN_SEG.renewed[1]).length)}${tile('lost', all.filter(RN_SEG.lost[1]).length)}</div>
        ${head}<div class="pad toolbar"><select data-ch="rnseg" aria-label="Show">${Object.entries(RN_SEG).map(([k, [lab]]) => `<option value="${k}" ${seg === k ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>
          <input type="search" data-in="rnq" value="${esc(S.rnQ || '')}" placeholder="Search client, building, VA, broker" aria-label="Search leases">
          ${isManager() ? `<select data-ch="rnva" aria-label="VA"><option value="">All VAs</option>${vaNames().map((v) => `<option ${SH.sameVa(vaF, v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}</div>
        ${logNote}<div class="scroll-x"><table class="t"><thead><tr><th>Client</th><th>Unit</th><th class="num">Rent</th><th>Lease ends</th><th>Renewal status</th><th>VA</th><th>Broker</th><th>Last message</th><th></th></tr></thead><tbody>
        ${rows.map((x) => { const lg = rnLogOf(x.leadId), last = lg[0];
          return `<tr><td><button type="button" class="linkbtn" data-act="open" data-id="${esc(x.leadId)}">${esc(x.lead.name || x.lead.code)}</button>${x.renewals ? `<div class="sub">renewed ${x.renewals}×</div>` : ''}</td>
            <td>${esc(x.building || '—')}<div class="sub">${esc(x.city || '')}</div></td><td class="num">${esc(peso(x.rent))}</td>
            <td>${esc(fmtDate(x.due))}${x.est ? ' <span class="sub">(estimated)</span>' : ''} ${badge(x.days)}</td><td>${esc(x.status)}</td><td>${esc(x.lead.va || '—')}</td><td>${esc(x.broker || '—')}</td>
            <td class="sub">${last ? `${esc(tplLabel(last.kind))} · ${esc(ago(last.at))}${last.by ? ' · ' + esc(last.by) : ''}${lg.length > 1 ? ` · ${lg.length} sent` : ''}` : logOk ? '—' : 'unknown'}</td>
            <td>${edit ? `<button type="button" class="btn sm" data-act="rnmsg" data-id="${esc(x.leadId)}">Message</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">No leases in this view.</td></tr>'}
        </tbody></table></div></div>
        <div class="sub">The Renewal Status shown is Monday's; changing it from the portal is not connected yet. Sending messages from the portal is not connected: write the message here, copy it to respond.io, then press “I sent it from respond.io”.</div>
        ${svcPanelHtml()}`;
    }
    const rows = visibleLeads().filter((l) => l.leaseEnd).sort((a, b) => a.leaseEnd.localeCompare(b.leaseEnd));
    return `<div class="cards"><div class="card"><div class="n">${rows.filter((l) => daysUntil(l.leaseEnd) <= 30).length}</div><div class="l">Due within 30 days (or overdue)</div></div><div class="card"><div class="n">${rows.length}</div><div class="l">Active leases</div></div></div>
      <div class="panel"><h3>Leases &amp; due dates <span class="muted">renewal messaging is not connected in the preview</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Lead</th><th>Client</th><th>AI Status</th><th>Lease end</th><th class="num">Days left</th><th class="num">Monthly</th><th>VA</th></tr></thead><tbody>
      ${rows.map((l) => { const d = daysUntil(l.leaseEnd); return `<tr class="click" data-act="open" data-id="${esc(l.id)}"><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${aiPill(l)}</td><td>${esc(fmtDate(l.leaseEnd))}</td><td class="num ${d <= 30 ? 'hotnum' : ''}">${d}</td><td class="num">${esc(money(l.budget) || '—')}</td><td>${esc(l.va || '—')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No active leases.</td></tr>'}
      </tbody></table></div></div>`;
  }
  /** Renewals → Message (Code.gs rnCompose / rnFill): a template filled for this lease, edited, copied; nothing is sent. */
  function rnFill(text, x) {
    const d = parseYmd(x.due), first = String(x.lead.name || '').trim().split(/\s+/)[0] || 'there';
    return text.replace(/\{firstName\}/g, first).replace(/\{building\}/g, x.building || 'your unit')
      .replace(/\{date\}/g, d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'the end of your lease')
      .replace(/\{days\}/g, String(Math.max(0, x.days || 0))).replace(/\{va\}/g, String(me().name || '').trim().split(/\s+/)[0] || 'Blackhouse');
  }
  function rnMsgModal(leadId, kind) {
    const st = S.deals, x = st && leasesFromDeals(st.rows).find((y) => y.leadId === leadId); if (!x) return toast('That lease is no longer listed.', true);
    const k = kind || (rnDone(x) && /closed/i.test(x.status) ? 'renewDone' : x.days <= 30 ? 'renew30' : x.days <= 60 ? 'renew60' : 'renew90');
    const t = SH.RENEWAL_TEMPLATES.find((y) => y.k === k), sent = new Set(rnLogOf(leadId).map((e) => e.kind));
    S.modal = { kind: 'rnmsg', leadId, tpl: k };
    const btns = (g) => SH.RENEWAL_TEMPLATES.filter((y) => y.group === g).map((y) => `<button type="button" class="btn sm ${y.k === k ? 'on' : ''}" data-act="rntpl" data-v="${y.k}" aria-pressed="${y.k === k}">${esc(y.label)}${sent.has(y.k) ? ' ✓' : ''}</button>`).join('');
    openModal(`<h3 id="modalTitle">Message ${esc(x.lead.name || x.lead.code)} <span class="muted" style="font-weight:400;font-size:12px">· lease ends ${esc(fmtDate(x.due))}</span></h3>
      <div class="sub">Renewal</div><div class="qd">${btns('Renewal')}</div><div class="sub" style="margin-top:8px">Upsell — services</div><div class="qd">${btns('Services')}</div>
      <label class="full" style="margin-top:10px">Message<textarea id="rnText" rows="6" maxlength="1500">${esc(rnFill(t.text, x))}</textarea></label>
      <div class="sub">Sending from the portal is not connected: copy the message, send it in respond.io, then record it here.</div>
      ${rnLogOf(leadId).length ? `<div class="sub" style="margin-top:8px"><b>Sent</b>: ${rnLogOf(leadId).map((e) => `${esc(tplLabel(e.kind))} · ${esc(ago(e.at))}${e.by ? ' · ' + esc(e.by) : ''}`).join(' · ')}</div>` : ''}
      <div class="actions"><button type="button" class="btn" data-act="mclose">Close</button><button type="button" class="btn" data-act="rncopy">Copy</button><button type="button" class="btn primary" data-act="rnsent">I sent it from respond.io</button></div>`);
  }
  async function rnSent() {
    const m = S.modal; if (!m || m.kind !== 'rnmsg') return;
    if (access('renewals') !== 'edit') return toast('You don\'t have edit access to Renewals.', true);
    try {
      const r = await API.post(`/api/leads/monday/${encodeURIComponent(m.leadId)}/renewal-log`, { kind: m.tpl });
      S.rnLog = S.rnLog || { log: {}, at: 0 }; (S.rnLog.log[m.leadId] = S.rnLog.log[m.leadId] || []).unshift({ kind: r.entry.kind, at: r.entry.at, by: r.entry.by });
    } catch (e) { if (signedOut(e)) return; return toast('Not recorded: ' + e.message, true); }
    S.modalReturn = null; closeModal(); renderView(); toast('Recorded: ' + tplLabel(m.tpl) + '. Nothing was sent from the portal.');
  }

  /** P&L (Code.gs apiGetPL / plMonth): commission per month from the Calendar board + the team's own cost lines. */
  async function loadPlCells() {
    if (DEMO || !S.user || (S.plCells && S.plCells.loading)) return;
    S.plCells = { ...(S.plCells && !S.plCells.error ? S.plCells : { cells: {}, at: 0 }), loading: true };
    try { const r = await API.get('/api/pl/cells'); S.plCells = { cells: r.cells || {}, at: Date.now(), loading: false }; }
    catch (e) { if (signedOut(e)) return; S.plCells = { cells: {}, at: Date.now(), loading: false, error: e.message }; }
    if (S.view === 'pl') renderView();
  }
  const PL_OPEX = ['salaries', 'comm_inhouse', 'benefits', 'contracted', 'advertising', 'misc', 'permits', 'medical', 'corporate', 'supplies', 'dues'];
  // the P&L counts a row as failed only when its Status is exactly "Failed" (Code.gs apiGetPL), not by its group
  const plFailed = (d) => /^failed$/i.test(String(d.status || '').trim());
  function plDeals(rows) {
    return rows.filter((d) => d.comm || d.paid).map((d) => {
      const ty = dType(d), t = ty === 'Renewal' ? d.rdate : d.contract, failed = plFailed(d);
      const coll = !failed && /^closed$/i.test(String(d.status || '').trim()) && d.pay ? d.paid || 0 : 0;
      return { d, ty, t, m: (t || '').slice(0, 7), comm: d.comm || 0, coll, ded: d.ded || 0, failed };
    });
  }
  /** Code.gs Data Check rules for the P&L (rows to fix on Monday), as apiGetPL has them. */
  function plChecks(list) {
    const out = [], past = (s, days) => s && daysUntil(s) < -days;
    list.forEach(({ d, ty, t, failed }) => {
      const add = (what) => out.push({ d, ty, m: (t || '').slice(0, 7), what });
      const closed = /^closed$/i.test(String(d.status || '').trim());
      if (!t && !failed) add(ty === 'Renewal' ? 'No Renewal Date (not in the P&L)' : 'No Contract Date (not in the P&L)');
      if (!d.type && !failed) add('No Type');
      if (d.paid && !d.pay && !failed) add('Total Paid but no Date of Payment');
      if (d.pay && !closed && !failed) add('Paid, but the Status is “' + (d.status || 'empty') + '”');
      if (closed && d.comm && d.paid && Math.abs(d.comm - d.paid - (d.ded || 0)) >= 1) add('Closed: commission ≠ Total Paid + Deductions');
      if (closed && past(t, 7) && !d.pay) add('Closed more than 7 days ago, no Date of Payment');
      if (!closed && !failed && !/renewed$/i.test(d.status) && d.comm && !d.paid && past(t, 7)) add('Commission not paid yet (date passed more than 7 days ago)');
      if (ty === 'Renewal' && d.pay && d.rdate && daysUntil(d.pay) - daysUntil(d.rdate) < -60) add('Renewal paid more than 60 days before the Renewal Date (copied from the old lease?)');
    });
    return out;
  }
  function plView() {
    if (viewSrc() !== 'monday') return laterBox('P&L', 'The P&L is read from the Monday Calendar board. Choose Monday.com as the data source to see it.');
    const st = dealsState();
    if (!S.plCells || (!S.plCells.loading && Date.now() - S.plCells.at > 300e3)) setTimeout(loadPlCells, 0);
    const head = `<div class="panel"><h3>P&amp;L <span class="muted">commission from the Monday Calendar board · cost lines entered here</span><span class="spacer"></span>${rangeSel('pl', '6')}</h3>`;
    if (!st.at || st.error) return head + dealsNote(st) + '</div>';
    const list = plDeals(st.rows), months = monthsIn(rangeOf('pl', '6'), firstMonth(list, (x) => x.m)), cells = (S.plCells && S.plCells.cells) || {};
    const edit = access('pl') === 'edit', cell = (line, m) => Number((cells[line] || {})[m]) || 0;
    // cost lines, Gross Margin and Net are hidden (not shown as ₱0) until the saved cost lines have loaded
    const pc = S.plCells || {}, costsOk = !!pc.at && !pc.error;
    const costsNote = pc.error ? `<div class="src-err" role="alert">The cost lines could not be loaded (${esc(pc.error)}), so Direct cost, Gross Margin and Net Income are not shown. <button class="linkbtn" data-act="plretry">Try again</button></div>`
      : !pc.at ? '<div class="empty">Loading the cost lines…</div>' : '';
    const per = months.map((m) => {
      const xs = list.filter((x) => x.m === m && !x.failed), by = (f, ty) => xs.filter((x) => x.ty === ty).reduce((a, x) => a + x[f], 0);
      const est = { Sale: by('comm', 'Sale'), Rental: by('comm', 'Rental'), Renewal: by('comm', 'Renewal') }, col = { Sale: by('coll', 'Sale'), Rental: by('coll', 'Rental'), Renewal: by('coll', 'Renewal') };
      const E = est.Sale + est.Rental + est.Renewal, C = col.Sale + col.Rental + col.Renewal, ded = xs.reduce((a, x) => a + x.ded, 0);
      const cos = cell('cos', m), gm = C - cos, opT = PL_OPEX.reduce((a, k) => a + cell(k, m), 0);
      return { m, est, col, E, C, ded, unc: E - C - ded, cos, gm, opT, net: gm - opT };
    });
    const row = (label, f, cls) => `<tr class="${cls || ''}"><td>${label}</td>${per.map((p) => `<td class="num">${peso(f(p))}</td>`).join('')}<td class="num"><b>${peso(per.reduce((a, p) => a + f(p), 0))}</b></td></tr>`;
    const input = (line) => `<tr><td>${esc(SH.PL_LINES[line])}</td>${months.map((m) => `<td class="num">${edit ? `<input class="plcell" data-ch="plcell" data-line="${line}" data-m="${m}" inputmode="decimal" value="${(cells[line] || {})[m] != null ? esc(cells[line][m]) : ''}" aria-label="${esc(SH.PL_LINES[line] + ' ' + monLabel(m))}">` : peso(cell(line, m))}</td>`).join('')}<td class="num"><b>${peso(months.reduce((a, m) => a + cell(line, m), 0))}</b></td></tr>`;
    const checks = plChecks(list);
    return head + `<div class="scroll-x"><table class="t pl"><thead><tr><th></th>${months.map((m) => `<th class="num">${esc(monLabel(m))}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
        ${row('<b>Total Estimated Commission</b>', (p) => p.E)}${row('Est. Sales', (p) => p.est.Sale, 'sub')}${row('Est. Rentals', (p) => p.est.Rental, 'sub')}${row('Est. Renewals', (p) => p.est.Renewal, 'sub')}
        ${row('Collected Sales', (p) => p.col.Sale, 'sub')}${row('Collected Rentals', (p) => p.col.Rental, 'sub')}${row('Collected Renewals', (p) => p.col.Renewal, 'sub')}
        ${row('Total Deductions', (p) => p.ded)}${row('Uncollected', (p) => p.unc)}${row('<b>Collected Commission Revenue</b>', (p) => p.C)}
        ${costsOk ? `<tr><th colspan="${months.length + 2}" class="left">Direct cost</th></tr>${input('cos')}${row('<b>Gross Margin</b>', (p) => p.gm)}
        <tr><th colspan="${months.length + 2}" class="left">Operating expenses</th></tr>${PL_OPEX.map(input).join('')}${row('Total operating expenses', (p) => p.opT)}${row('<b>Net Income / Loss</b>', (p) => p.net)}` : ''}
      </tbody></table></div>${costsNote}</div>
      <div class="panel"><h3>Data Check <span class="muted">${checks.length} Calendar item${checks.length === 1 ? '' : 's'} to fix on Monday</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>Item</th><th>Building</th><th>Type</th><th>Month</th><th>What to check</th></tr></thead><tbody>
        ${checks.slice(0, 200).map((c) => `<tr><td>${esc(c.d.id)}</td><td>${esc(c.d.building || '—')}</td><td>${esc(c.ty)}</td><td>${esc(c.m ? monLabel(c.m) : '—')}</td><td>${esc(c.what)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing to check.</td></tr>'}</tbody></table></div></div>
      <div class="sub">Commission and collection are read from the Calendar board (Blackhouse Commission, Total Paid, Deductions, Date of Payment, Type, Contract / Renewal Date); cost lines are saved in the portal${edit ? ' when you leave a cell' : ''}. Commission rules and monthly targets are not in the portal yet.</div>`;
  }

  /** Broker / VA figures per period from the Calendar board (Code.gs apiGetBrokerDashboard / apiGetVaDashboard, simplified). */
  function brokerMonthsHtml() {
    const st = dealsState(); if (!st) return '';
    const head = `<div class="panel"><h3>Per period <span class="muted">Monday Calendar board</span><span class="spacer"></span>${rangeSel('brokers', '3')}</h3>`;
    if (!st.at || st.error) return head + dealsNote(st) + '</div>';
    const months = monthsIn(rangeOf('brokers', '3')), from = months[0] + '-01', to = today();
    // Code.gs apiGetBrokerDashboard: every past viewing counts (failed deals too), renewal rows don't; the broker is the
    // row's Salesperson, else the client's; a client is closed once, on their deal row (Contract Date, or Status / group
    // Closed or Waiting for Payment), unless that row failed
    const inR = (s) => s && s >= from && s <= to, rows = st.rows.filter((d) => !/renewal/i.test(d.type));
    const spOf = {}; D.leads.forEach((l) => { spOf[l.id] = l.salesperson || ''; });
    const bk = (d) => d.sp || spOf[d.leadId] || 'Unassigned';
    const closeOf = {};
    rows.forEach((d) => {
      const stc = /^closed$|waiting for payment/i.test(d.status) || /^closed$|waiting for payment/i.test(d.group);
      if (!d.leadId || !(d.contract || stc) || /^failed$/i.test(String(d.status || '').trim()) || /failed|archive/i.test(d.group)) return;
      const t = d.contract || d.fin || '', sc = (stc ? 2 : 0) + (d.price || d.rate || d.comm || d.paid ? 1 : 0), o = closeOf[d.leadId];
      // earliest dated row wins a tie; an undated row never replaces a dated one (Code.gs compares real dates)
      if (!o || sc > o.sc || (sc === o.sc && t && (!o.t || t < o.t))) closeOf[d.leadId] = { t, d, sc };
    });
    const names = [...new Set(rows.map(bk))].filter((b) => b !== 'Unassigned').sort().concat(rows.some((d) => bk(d) === 'Unassigned') ? ['Unassigned'] : []);
    return head + `<div class="scroll-x"><table class="t"><thead><tr><th>Broker</th><th class="num">Viewings</th><th class="num">Clients viewed</th><th class="num">LOI clients</th><th class="num">Closed clients</th><th class="num">Commission collected</th></tr></thead><tbody>
      ${names.map((b) => { const rs = rows.filter((d) => bk(d) === b), v = rs.filter((d) => inR(d.fin));
        const closed = Object.values(closeOf).filter((x) => bk(x.d) === b && inR(x.t)).length;
        return `<tr><td><b>${esc(b)}</b></td><td class="num">${v.length}</td><td class="num">${new Set(v.map((d) => d.leadId || 'cal' + d.id)).size}</td><td class="num">${new Set(rs.filter((d) => inR(d.loi)).map((d) => d.leadId || 'cal' + d.id)).size}</td>
          <td class="num">${closed}</td><td class="num">${peso(rs.filter((d) => inR(d.pay)).reduce((a, d) => a + dCollected(d), 0))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No Calendar data for this period.</td></tr>'}
      </tbody></table></div></div>`;
  }
  function vaPerformanceHtml() {
    const st = dealsState(); if (!st || !isManager()) return '';
    const head = `<div class="panel"><h3>VA Performance &amp; Ranking <span class="muted">clients assigned in the period · Monday leads + Calendar</span><span class="spacer"></span>${rangeSel('monitor', '3')}</h3>`;
    if (!st.at || st.error) return head + dealsNote(st) + '</div>';
    const months = monthsIn(rangeOf('monitor', '3')), from = months[0] + '-01', t = today();
    const rows = vaNames().map((va) => SH.vaPerformance(visibleLeads(), st.rows, va, from, '', t))
      .filter((r) => r.n).sort((a, b) => (b.vp + b.sp - b.lp / 2) - (a.vp + a.sp - a.lp / 2));
    return head + `<div class="scroll-x"><table class="t"><thead><tr><th>#</th><th>VA</th><th class="num">Clients</th><th class="num">To viewing</th><th class="num">To sale</th><th class="num">Lost</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="click" data-act="filterva" data-v="${esc(r.va)}"><td>${i + 1}</td><td><b>${esc(r.va)}</b></td><td class="num">${r.n}</td><td class="num">${r.vp}%</td><td class="num">${r.sp}%</td><td class="num">${r.lp}%</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No clients assigned in this period.</td></tr>'}
      </tbody></table></div><div class="sub pad">Ranked by conversion to viewing and to sale, less half the lost rate. Lead-time scores (time to answer, to source and send units) need the respond.io chats and Monday subitems and are not in the portal yet.</div></div>`;
  }

  // ---------- KPI Review (server: src/kpiReview.js; Toby and Jonjo only) ----------
  // Coaching and feedback are private to the two reviewers' accounts: they're held in memory only while this screen is
  // used (never in localStorage) and dropped on sign-out. The KPI values are the VA Management ones, computed on the server.
  const KR = SH.KPI_REVIEW;
  const kr = () => (S.kr = S.kr || {});
  const manilaTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: KR.timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (Manila)' : '—');
  const periodLabel = (p) => { const [y, m] = String(p).split('-').map(Number); return y ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : p; };
  function krPeriods() {
    const cur = krMe().currentPeriod || SH.manilaMonth(), [y, m] = cur.split('-').map(Number), out = [];
    for (let i = 0; i <= (krMe().monthsBack || KR.monthsBack); i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
    return out;
  }
  const krPeriod = () => kr().period || krMe().currentPeriod || SH.manilaMonth();
  async function krLoadEmployees() {
    const st = kr(); if (st.empsLoading) return;
    st.empsLoading = true; st.empsErr = '';
    try { const r = await API.get('/api/kpi-review/employees'); st.emps = r.employees; st.labelsErr = r.labelsError || ''; if (!st.sel || !st.emps.some((e) => e.key === st.sel)) st.sel = (st.emps[0] || {}).key || ''; }
    catch (e) { if (signedOut(e)) return; st.empsErr = e.message; st.emps = st.emps || []; }
    st.empsLoading = false; st.empsAt = Date.now();
    if (S.view === 'kpireview') renderView();   // the view then loads the selected employee's review
  }
  async function krLoadReview() {
    const st = kr(), key = st.sel, p = krPeriod(), tag = key + '|' + p; if (!key) return;
    st.revTag = tag; st.revLoading = true; st.revErr = ''; if (S.view === 'kpireview') renderView();
    try {
      const r = await API.get(`/api/kpi-review/review/${key}/${p}`);
      if (st.revTag !== tag) return;
      st.rev = r; st.draft = {}; st.saveErr = '';
    } catch (e) {
      if (signedOut(e) || st.revTag !== tag) return;
      // a VA label that has just been given a member record: reload the list (the VA appears under their member record)
      if (e.status === 404) { st.emps = null; st.sel = ''; st.revLoading = false; st.revTag = ''; toast('The employee list changed. It has been reloaded.'); return renderView(); }
      st.rev = null; st.revErr = e.message;
    }
    st.revLoading = false;
    if (S.view === 'kpireview') renderView();
  }
  async function krLoadSnaps() {
    const st = kr();
    try { st.snaps = (await API.get('/api/kpi-review/snapshots')).snapshots; st.snapsErr = ''; } catch (e) { if (signedOut(e)) return; st.snapsErr = e.message; st.snaps = st.snaps || []; }
    if (S.view === 'kpireview') renderView();
  }
  async function krLoadSnap() {
    const st = kr(), p = krPeriod();
    st.snapTag = p; st.snapLoading = true; st.snapErr = ''; st.snap = null; renderView();
    try { const r = await API.get(`/api/kpi-review/snapshots/${p}`); if (st.snapTag === p) st.snap = r.snapshot; }
    catch (e) { if (signedOut(e) || st.snapTag !== p) return; st.snapErr = e.status === 404 ? '' : e.message; st.snap = null; }
    st.snapLoading = false; renderView();
  }
  const kpiCards = (list, note) => `<div class="kr-kpis">${list.map((k) => `<div class="card"><div class="n">${k.value == null ? '—' : esc(k.value) + esc(k.unit)}</div><div class="l">${esc(k.label)}</div></div>`).join('')}</div>${note ? `<div class="sub pad">${note}</div>` : ''}`;
  function kpiBlock(kpis, p, hasDeals, live) {
    if (!kpis) return '';
    return `<h4 class="kr-h">${esc(periodLabel(p))} · clients assigned in the month <span class="muted">(VA Performance &amp; Ranking rules)</span></h4>
      ${kpiCards(kpis.month, hasDeals === false ? 'To viewing and To sale need the Monday Calendar board, which isn\'t available, so they are left empty.' : '')}
      <h4 class="kr-h">${live ? 'Current workload <span class="muted">(as of now, not tied to the month · Response monitor &amp; KPIs per VA)</span>' : 'Workload at capture time <span class="muted">(Response monitor &amp; KPIs per VA)</span>'}</h4>
      ${kpiCards(kpis.current, live ? 'Needs reply and Hot count only chats the portal has already checked on respond.io.' : '')}`;
  }
  /**
   * A review in the coaching-form layout (kpi ref.png): Performance Achievements / Gaps, Action Plan with Commitment
   * Date rows, then Acknowledgment. `form` gives editable inputs (the reviewer's own section); otherwise read-only.
   * Earlier free-text Coaching / Feedback (saved before this layout) stay visible, and editable for their author.
   */
  function krFormHtml(r, form, ackHtml) {
    const dis = form && form.saving ? 'disabled' : '', val = (k) => (form && k in form.d ? form.d[k] : r ? r[k] || '' : '');
    const acts = form && form.d.actions ? form.d.actions : (r && r.actions) || [];
    const rows = form ? acts.concat(Array.from({ length: Math.max(KR.actionRows - acts.length, acts.length < KR.actionsMax ? 1 : 0) }, () => ({ text: '', date: '' }))).slice(0, KR.actionsMax) : acts;
    const old = ['coaching', 'feedback'].filter((k) => String(val(k)).trim() || (r && String(r[k] || '').trim()));
    return `<div class="kr-form2">
      <div class="kr-bar2">Performance achievements / gaps</div>
      ${form ? `<textarea class="kr-big" data-in="krtext" data-k="achievements" rows="9" maxlength="${KR.textMax}" aria-label="Performance achievements / gaps" ${dis}>${esc(val('achievements'))}</textarea>`
        : `<div class="kr-big kr-text">${esc(r && r.achievements) || '<span class="muted">—</span>'}</div>`}
      <div class="kr-plan"><div class="kr-bar2">Action plan</div><div class="kr-bar2">Commitment date</div>
        ${rows.length ? rows.map((a, i) => form ? `<input data-in="kraction" data-i="${i}" data-f="text" value="${esc(a.text)}" maxlength="${KR.actionMax}" aria-label="Action ${i + 1}" ${dis}><input type="date" data-in="kraction" data-i="${i}" data-f="date" value="${esc(a.date)}" aria-label="Commitment date ${i + 1}" ${dis}>`
          : `<div class="kr-cell">${esc(a.text)}</div><div class="kr-cell">${a.date ? esc(fmtDate(a.date)) : '<span class="muted">—</span>'}</div>`).join('') : '<div class="kr-cell muted">—</div><div class="kr-cell muted">—</div>'}</div>
      ${old.length ? `<div class="kr-old"><div class="sub">Written before this layout${form ? ' (kept as is; edit or clear it here)' : ''}:</div>${old.map((k) => form
        ? `<label>${esc(KR.fieldLabels[k])}<textarea data-in="krtext" data-k="${k}" rows="3" maxlength="${KR.textMax}" ${dis}>${esc(val(k))}</textarea></label>`
        : `<div class="kr-lbl">${esc(KR.fieldLabels[k])}</div><div class="kr-text">${esc(r[k])}</div>`).join('')}</div>` : ''}
      <div class="kr-bar2">Acknowledgment</div>${ackHtml}</div>`;
  }
  /** The acknowledgment strip of one reviewer's section: the employee's own verification and this reviewer's discussion record. */
  function krAckStrip(rv, r, x) {
    const a = rv.ack, empSlot = !rv.employee.linked ? '<span class="muted">Possible once they are on Team &amp; Access</span>'
      : a ? `<b>${esc(a.by.name)}</b><br><span class="sub">${esc(manilaTime(a.at))}${r && r.version > ((a.reviewVersions || {})[x.key] || 0) ? ' · this section changed afterwards' : ''}</span>` : '<span class="muted">Not acknowledged yet</span>';
    const revSlot = r && r.discussedAt ? `<span class="sub">Reviewer recorded discussion</span><br><b>${esc(r.discussedBy ? r.discussedBy.name : x.label)}</b><br><span class="sub">${esc(manilaTime(r.discussedAt))}${r.version > r.discussedVersion ? ' · text changed afterwards' : ''}</span>` : '<span class="muted">No discussion recorded</span>';
    return `<div class="kr-ack"><div><div class="kr-sig">${empSlot}</div><div class="kr-cap">Employee (${esc(rv.employee.name)})</div></div>
      <div><div class="kr-sig">${revSlot}</div><div class="kr-cap">${esc(x.label)} (reviewer's own record)</div></div></div>`;
  }
  /** One reviewer's section: editable for that reviewer, read-only for the other. */
  function krColumn(rv, x) {
    const st = kr(), r = rv.reviews[x.key], mine = rv.can.write && rv.can.slot === x.key, d = st.draft || {};
    // who last saved this reviewer's section, and when (at the top of the section)
    const head = `<h3>${esc(x.label)} — coaching${mine ? ' <span class="pill" style="--c:var(--accent)">yours</span>' : ''}</h3>
      <div class="pad kr-saved" role="status">${r ? `Last saved by <b>${esc(r.author.name)}</b> · ${esc(manilaTime(r.updatedAt))}${r.createdAt !== r.updatedAt ? ' <span class="muted">(first saved ' + esc(manilaTime(r.createdAt)) + ')</span>' : ''}` : '<span class="muted">Not saved yet for this month.</span>'}</div>`;
    if (!(krMe().reviewers || []).find((y) => y.key === x.key && y.configured)) return `<section class="panel kr-col">${head}<div class="pad sub">${esc(x.label)}'s reviewer account isn't set up on the server yet (KPI_REVIEWER_${x.key.toUpperCase()}_EMAIL).</div></section>`;
    if (!mine) {
      return `<section class="panel kr-col">${head}<div class="pad">${r ? '' : `<div class="sub">No review from ${esc(x.label)} for this month yet.</div>`}${krFormHtml(r, null, krAckStrip(rv, r, x))}
        ${rv.can.slot !== x.key ? `<div class="sub">Only ${esc(x.label)} can edit this section.</div>` : '<div class="sub">You can\'t review yourself.</div>'}</div></section>`;
    }
    return `<section class="panel kr-col">${head}<div class="pad">${krFormHtml(r, { d, saving: st.saving }, krAckStrip(rv, r, x))}
        ${st.saveErr ? `<div class="src-err" role="alert">${esc(st.saveErr)}</div>` : ''}
        <div class="kr-actions"><button class="btn primary" data-act="krsave" ${st.saving ? 'disabled' : ''}>${st.saving ? 'Saving…' : 'Save my review'}</button>
        ${r && !r.discussedAt ? `<button class="btn" data-act="krdiscussed" ${st.saving ? 'disabled' : ''}>I discussed this with ${esc(rv.employee.name)}</button>` : ''}
        ${Object.keys(d).length ? '<span class="sub">Unsaved changes</span>' : ''}</div></div></section>`;
  }
  function krAckBlock(rv) {
    if (!rv.employee.linked) return `<div class="panel"><h3>Employee acknowledged discussion</h3><div class="pad sub">${esc(rv.employee.name)} can acknowledge once a Manager adds them in Settings → Team &amp; Access (role VA, VA label “${esc(rv.employee.vaLabel)}”, their own sign-in email). The reviews saved here move to them then.</div></div>`;
    const a = rv.ack, revs = Object.entries(rv.reviews).filter(([, r]) => r);
    const edited = a && revs.some(([k, r]) => r.version > ((a.reviewVersions || {})[k] || 0));
    // a Google account linked to the member after the review was written: worth checking it's really theirs
    const first = revs.map(([, r]) => r.createdAt).sort()[0], lateLink = a && a.googleLinkedAt && first && new Date(a.googleLinkedAt) > new Date(first);
    return `<div class="panel"><h3>Employee acknowledged discussion</h3><div class="pad">
      ${a ? `<div><b>${esc(a.by.name)}</b> confirmed “We discussed this review” while signed in as themselves${a.by.email ? ' (' + esc(a.by.email) + ')' : ''} · ${esc(manilaTime(a.at))}</div>
        ${edited ? '<div class="sub"><b>The coaching or feedback was changed after this acknowledgment.</b></div>' : ''}
        ${lateLink ? `<div class="src-note stale">This Google account was linked to ${esc(rv.employee.name)}'s Team &amp; Access record on ${esc(manilaTime(a.googleLinkedAt))}, after the review was first written. Check that it is their own account.</div>` : ''}`
        : `<div>Not acknowledged by ${esc(rv.employee.name)} yet.</div>`}
      <div class="sub">Only ${esc(rv.employee.name)} can acknowledge, from their own account (Review acknowledgment screen). They see that a review exists for the month, not its text: go through it with them.
        Acknowledgment confirms that the review was discussed, not that they agree with it.</div></div></div>`;
  }
  function krSnapshotBar(rv) {
    const s = rv.snapshot, cur = krPeriod() === krMe().currentPeriod;
    return `<div class="panel"><h3>Monthly snapshot <span class="muted">${esc(periodLabel(rv.period))}</span></h3><div class="pad">
      ${s ? `<div>Saved on ${esc(manilaTime(s.createdAt))} by ${esc(s.by)}. Snapshots are read-only and never replaced; later changes are not in it.</div><button class="btn sm" data-act="krmode" data-v="snap">View snapshot</button>`
        : `<div class="sub">Captures every VA's KPIs, both reviewers' comments and acknowledgments for ${esc(periodLabel(rv.period))} as they are now. One per month; it can't be changed or replaced afterwards.${cur ? ' <b>This month isn\'t over yet.</b>' : ''}</div>
          <button class="btn" data-act="krsnap" ${kr().snapping ? 'disabled' : ''}>${kr().snapping ? 'Creating…' : 'Create monthly snapshot'}</button>`}</div></div>`;
  }
  function krSnapshotView() {
    const st = kr(), p = krPeriod();
    if (st.snapTag !== p && !st.snapLoading) setTimeout(krLoadSnap, 0);
    if (st.snapLoading || st.snapTag !== p) return '<div class="empty" role="status">Loading the snapshot…</div>';
    if (st.snapErr) return `<div class="src-err" role="alert">${esc(st.snapErr)} <button class="btn sm" data-act="krsnapreload">Try again</button></div>`;
    const s = st.snap;
    if (!s) return `<div class="empty">No snapshot for ${esc(periodLabel(p))}. ${(st.snaps || []).length ? 'Saved months: ' + st.snaps.map((x) => esc(periodLabel(x.period))).join(', ') + '.' : 'None saved yet.'}</div>`;
    return `<div class="kr-banner snap" role="note"><b>Saved snapshot · ${esc(periodLabel(s.period))}</b> — captured ${esc(manilaTime(s.createdAt))} by ${esc(s.createdBy.name)} from ${s.source === 'monday' ? 'Monday.com' : 'MongoDB'} data read ${esc(manilaTime(s.dataReadAt))}. Read-only: later changes to KPIs, names or comments don't change it.</div>
      ${s.employees.map((e) => `<div class="panel"><h3>${esc(e.name)} <span class="muted">${e.employeeId ? 'Employee ID ' + esc(e.employeeId) : 'No Team & Access member at capture time'} · VA label ${esc(e.vaLabel)}</span></h3><div class="pad">
        ${kpiBlock(e.kpis, s.period, null, false)}
        <div class="kr-cols">${KR.reviewers.map((x) => { const r = e.reviews.find((y) => y.reviewerKey === x.key);
          return `<section class="panel kr-col"><h3>${esc(x.label)} — coaching</h3><div class="pad">${r ? `${krFormHtml(r, null, `<div class="sub">${e.ack.status === 'acknowledged' ? `Employee: <b>${esc(e.ack.by.name)}</b>, ${esc(manilaTime(e.ack.at))}` : e.ack.status === 'not_available' ? 'Employee: not possible (no Team & Access member)' : 'Employee: not acknowledged'}</div>`)}
            <div class="sub">By ${esc(r.reviewer.name)} (${esc(r.reviewer.email)}) · last saved ${esc(manilaTime(r.updatedAt))}</div><div class="sub">${r.discussedAt ? 'Reviewer recorded discussion ' + esc(manilaTime(r.discussedAt)) : 'No reviewer discussion record.'}</div>` : '<div class="muted">No coaching or feedback.</div>'}</div></section>`; }).join('')}</div>
        <div class="sub">${e.ack.status === 'acknowledged' ? `<b>Employee acknowledged discussion</b>: ${esc(e.ack.by.name)}, ${esc(manilaTime(e.ack.at))}` : e.ack.status === 'not_available' ? 'Acknowledgment not possible (no Team & Access member).' : 'Employee had not acknowledged the discussion.'}</div></div></div>`).join('')}`;
  }
  function kpiReviewView() {
    const st = kr(), me = krMe();
    if (!st.emps && !st.empsLoading) setTimeout(krLoadEmployees, 0);
    if (!st.snaps && !st.snapsLoading) { st.snapsLoading = true; setTimeout(krLoadSnaps, 0); }
    const mode = st.mode === 'snap' ? 'snap' : 'live', p = krPeriod(), emps = st.emps || [];
    const head = `<div class="panel"><h3>KPI Review <span class="muted">private to Toby and Jonjo · you are signed in as ${esc(me.reviewer ? me.reviewer.label : '')}'s reviewer account</span></h3>
      <div class="pad toolbar kr-bar">
        ${mode === 'live' ? `<label>Employee <select data-ch="kremp" ${!emps.length ? 'disabled' : ''}>${emps.map((e) => `<option value="${esc(e.key)}" ${e.key === st.sel ? 'selected' : ''}>${esc(e.name)}${e.linked ? '' : ' (not on Team & Access)'}${e.active === false ? ' (inactive)' : ''}</option>`).join('')}</select></label>` : ''}
        <label>Reporting month <select data-ch="krperiod">${krPeriods().map((x) => `<option value="${x}" ${x === p ? 'selected' : ''}>${esc(periodLabel(x))}</option>`).join('')}</select></label>
        <div class="seg" role="group" aria-label="Live or snapshot"><button data-act="krmode" data-v="live" aria-pressed="${mode === 'live'}">Live review</button><button data-act="krmode" data-v="snap" aria-pressed="${mode === 'snap'}">Saved snapshot</button></div></div></div>`;
    if (mode === 'snap') return head + krSnapshotView();
    if (st.empsErr) return head + `<div class="src-err" role="alert">${esc(st.empsErr)} <button class="btn sm" data-act="krreload">Try again</button></div>`;
    if (!st.emps) return head + '<div class="empty" role="status">Loading employees…</div>';
    if (!emps.length) return head + `<div class="empty">No VAs yet. Add each VA in Settings → Team &amp; Access (role VA, with their VA label).${st.labelsErr ? ' ' + esc(st.labelsErr) : ''}</div>`;
    const rv = st.rev, tag = st.sel + '|' + p;
    if (st.revTag !== tag && !st.revLoading) setTimeout(krLoadReview, 0);
    if (st.revLoading || st.revTag !== tag) return head + '<div class="empty" role="status">Loading the review…</div>';
    if (st.revErr || !rv) return head + `<div class="src-err" role="alert">${esc(st.revErr || 'The review could not be loaded.')} <button class="btn sm" data-act="krreload">Try again</button></div>`;
    const e = rv.employee;
    return head + `${st.labelsErr ? `<div class="src-err" role="alert">${esc(st.labelsErr)}</div>` : ''}
      <div class="kr-banner live" role="note"><b>Live review data</b> — KPIs from ${rv.source === 'monday' ? 'Monday.com' : 'MongoDB'}, read ${esc(manilaTime(rv.dataReadAt))}; they change as that data changes. Comments are saved as you save them.</div>
      <div class="panel kr-emp"><h3>${esc(e.name)} <span class="muted">${e.linked ? 'Employee ID ' + esc(e.employeeId) : 'Not on Team &amp; Access yet'} · VA label ${esc(e.vaLabel)}</span></h3><div class="pad">
        ${e.linked ? '' : `<div class="src-note">Reviews for ${esc(e.name)} are kept under their VA label. When a Manager adds them in Settings → Team &amp; Access (role VA, this VA label), the reviews move to their record and they can acknowledge the discussion.</div>`}
        ${rv.kpiError ? `<div class="src-err" role="alert">KPIs unavailable: ${esc(rv.kpiError)} No other data is shown in their place.</div>` : kpiBlock(rv.kpis, rv.period, rv.hasDeals, true)}</div></div>
      <div class="kr-cols">${KR.reviewers.map((x) => krColumn(rv, x)).join('')}</div>
      ${(rv.unmoved || []).length ? `<div class="panel"><h3>Earlier reviews kept under the VA label <span class="muted">written before ${esc(e.name)} was on Team &amp; Access; not moved because a review already existed</span></h3><div class="pad">
        ${rv.unmoved.map((r) => `<div class="kr-lbl">${esc((KR.reviewers.find((x) => x.key === r.reviewerKey) || {}).label || r.reviewerKey)} · ${esc(r.author.name)} · ${esc(manilaTime(r.updatedAt))}</div>${krFormHtml(r, null, '')}`).join('')}</div></div>` : ''}
      ${krAckBlock(rv)}${krSnapshotBar(rv)}`;
  }
  async function krSave() {
    const st = kr(), rv = st.rev; if (!rv || st.saving) return;
    const mine = rv.reviews[rv.can.slot], d = st.draft || {};
    // only what was edited is sent, so earlier Coaching / Feedback are never blanked by a save
    const body = { version: mine ? mine.version : 0 };
    ['achievements', 'coaching', 'feedback'].forEach((k) => { if (k in d) body[k] = d[k]; });
    if (d.actions) body.actions = d.actions;
    if (Object.keys(body).length === 1) { st.saveErr = 'Nothing changed to save.'; return renderView(); }
    if (!mine && SH.kpiReviewEmpty({ ...body, actions: (body.actions || []).filter((a) => String(a.text || '').trim() || a.date) })) { st.saveErr = 'Write the review first.'; return renderView(); }
    if (mine && SH.kpiReviewEmpty({ ...mine, ...body, actions: (body.actions || mine.actions || []).filter((a) => String(a.text || '').trim() || a.date) })) { st.saveErr = 'The review can\'t be left empty. Write something, or keep the earlier text.'; return renderView(); }
    const { errors } = SH.validateKpiFeedback(body); if (errors.length) { st.saveErr = errors[0]; return renderView(); }
    st.saving = true; st.saveErr = ''; renderView();
    try {
      const r = await API.put(`/api/kpi-review/review/${rv.employee.key}/${rv.period}/feedback`, body);
      rv.reviews[rv.can.slot] = r.review; st.draft = {}; toast('Review saved. The other reviewer\'s column was not changed.');
    } catch (e) { if (signedOut(e)) return; st.saveErr = 'Not saved: ' + e.message; toast('Not saved.', true); }
    st.saving = false; renderView();
  }
  async function krDiscussed() {
    const st = kr(), rv = st.rev; if (!rv || st.saving) return;
    if (!confirm(`Record that you went through this review with ${rv.employee.name}? This is your record; it is not the employee's acknowledgment.`)) return;
    st.saving = true; renderView();
    try { rv.reviews[rv.can.slot] = (await API.post(`/api/kpi-review/review/${rv.employee.key}/${rv.period}/discussed`)).review; toast('Discussion recorded.'); }
    catch (e) { if (signedOut(e)) return; st.saveErr = e.message; }
    st.saving = false; renderView();
  }
  async function krSnapshot() {
    const st = kr(), p = krPeriod(); if (st.snapping) return;
    // the snapshot reloads the review, which would drop unsaved text: save it first
    if (st.draft && Object.keys(st.draft).length) return toast('Save your review first: the snapshot copies saved reviews only.', true);
    if (!confirm(`Create the ${periodLabel(p)} snapshot now? It copies every VA's KPIs, both reviewers' comments and acknowledgments as they are now, and can't be changed or replaced.`)) return;
    st.snapping = true; renderView();
    try { await API.post('/api/kpi-review/snapshots', { period: p }); toast('Snapshot saved for ' + periodLabel(p) + '.'); st.snapTag = ''; await krLoadSnaps(); }
    catch (e) { if (signedOut(e)) { st.snapping = false; return; } toast(e.message, true); }
    st.snapping = false; st.revTag = ''; krLoadReview();
  }

  // ---------- Review acknowledgment (a VA's own months; no review text, KPIs or reviewer records are sent here) ----------
  async function krLoadAcks() {
    const st = kr(); st.acksLoading = true; st.acksErr = '';
    try { st.acks = (await API.get('/api/kpi-review/my-acknowledgments')).months; } catch (e) { if (signedOut(e)) return; st.acksErr = e.message; }
    st.acksLoading = false; if (S.view === 'kpiack') renderView();
  }
  function kpiAckView() {
    const st = kr();
    if (!st.acks && !st.acksLoading && !st.acksErr) setTimeout(krLoadAcks, 0);
    const body = st.acksErr ? `<div class="src-err" role="alert">${esc(st.acksErr)} <button class="btn sm" data-act="krackreload">Try again</button></div>`
      : !st.acks ? '<div class="empty" role="status">Loading…</div>'
      : !st.acks.length ? '<div class="empty">No KPI reviews for you yet.</div>'
      : `<div class="scroll-x"><table class="t"><thead><tr><th>Month</th><th>Discussion</th></tr></thead><tbody>${st.acks.map((a) => `<tr><td><b>${esc(periodLabel(a.period))}</b></td><td>${a.acknowledged ? `You confirmed “We discussed this review” · ${esc(manilaTime(a.at))}`
          : `<label class="tagck"><input type="checkbox" data-ch="krackck" data-p="${esc(a.period)}" ${(st.ackCk || {})[a.period] ? 'checked' : ''}> We discussed this review</label> <button class="btn sm primary" data-act="krack" data-p="${esc(a.period)}" ${st.acking === a.period ? 'disabled' : ''}>${st.acking === a.period ? 'Saving…' : 'Confirm'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="panel"><h3>Review acknowledgment <span class="muted">your KPI reviews from Toby and Jonjo</span></h3>
      <div class="pad sub">Confirm here after your reviewer has gone through your monthly KPI review with you. Acknowledging confirms the discussion took place, <b>not that you agree</b> with the feedback.
        The review itself is kept private to the reviewers, so it isn't shown here.</div>${body}</div>`;
  }
  async function krAck(p) {
    const st = kr(); if (st.acking) return;
    if (!(st.ackCk || {})[p]) return toast('Tick “We discussed this review” first.', true);
    st.acking = p; renderView();
    try { await API.post(`/api/kpi-review/my-acknowledgments/${p}`, { confirm: true }); toast('Thank you. Your acknowledgment was saved.'); }
    catch (e) { if (signedOut(e)) { st.acking = ''; return; } toast(e.message, true); }
    st.acking = ''; await krLoadAcks();
  }

  // ---------- Project Pages (server: src/projects.js; files in MongoDB, Google Drive optional) ----------
  const PPK = SH.PROJECT;
  const ACT_PP = {}, CH_PP = {};   // this screen's click / change handlers, merged into ACT / CH below
  const pp = () => (S.pp = S.pp || { q: '' });
  const ppEdit = () => access('pages') === 'edit';
  const ppMediaUrl = (pid, fid) => API.url(`/api/projects/${pid}/media/${fid}`);
  async function ppLoadList() {
    const st = pp(); st.listLoading = true; st.listErr = '';
    try { const r = await API.get('/api/projects'); Object.assign(st, { list: r.projects, drive: r.drive, ai: r.ai, hook: r.inquiryHook, publicBase: r.publicBase, limits: r.limits }); }
    catch (e) { if (signedOut(e)) return; st.listErr = e.message; st.list = st.list || []; }
    st.listLoading = false; if (S.view === 'pages') renderView();
  }
  async function ppOpen(id) {
    const st = pp();
    if (st.dirty && !confirm('Discard your unsaved changes to this project?')) return;
    Object.assign(st, { sel: id, proj: null, draft: null, dirty: false, saveErr: '', proposal: null, buildNote: '', loadErr: '' }); renderView();
    try { ppSet((await API.get('/api/projects/' + id)).project); } catch (e) { if (signedOut(e)) return; st.loadErr = e.message; }
    renderView();
  }
  /** The saved project and an editable copy of it (lists as one-per-line text). */
  function ppSet(p) {
    const st = pp(); st.proj = p;
    st.draft = JSON.parse(JSON.stringify(p)); st.draft.highlights = (p.highlights || []).join('\n'); st.draft.amenities = (p.amenities || []).join('\n');
    st.dirty = false;
    const row = (st.list || []).find((x) => x.id === p.id); if (row) Object.assign(row, { name: p.name, developer: p.developer, location: p.location, status: p.status, published: p.published, units: p.units.length, images: p.media.filter((m) => m.type === 'image').length });
  }
  const ppInput = (k, label, opts = {}) => { const d = pp().draft, v = d[k] == null ? '' : d[k], dis = ppEdit() ? '' : 'disabled';
    return `<label class="${opts.full ? 'full' : ''}">${esc(label)}${opts.area ? `<textarea data-pp="${k}" rows="${opts.rows || 3}" maxlength="${opts.max || 6000}" ${dis}>${esc(v)}</textarea>` : `<input data-pp="${k}" value="${esc(v)}" maxlength="${PPK.text[k] || 200}" ${opts.list ? `list="${opts.list}"` : ''} placeholder="${esc(opts.ph || '')}" ${dis}>`}</label>`; };
  function ppListHtml() {
    const st = pp(), term = st.q.trim().toLowerCase();
    const rows = (st.list || []).filter((p) => !term || [p.name, p.developer, p.location].join(' ').toLowerCase().includes(term));
    const groups = {}; rows.forEach((p) => { const d = p.developer || 'Other'; (groups[d] = groups[d] || []).push(p); });
    const names = Object.keys(groups).sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
    return `<div class="pp-list"><input type="search" data-in="ppq" value="${esc(st.q)}" placeholder="Search project, developer, city" aria-label="Search projects">
      ${ppEdit() ? '<button class="btn sm primary" data-act="ppnew">+ Add developer project</button>' : ''}
      ${st.listErr ? `<div class="src-err" role="alert">${esc(st.listErr)} <button class="btn sm" data-act="ppreload">Try again</button></div>` : !st.list ? '<div class="empty" role="status">Loading projects…</div>'
        : !rows.length ? `<div class="empty">${st.list.length ? 'No project matches that search.' : 'No projects yet.' + (ppEdit() ? ' Add the first one.' : '')}</div>`
        : names.map((d) => `<h4>${esc(d)}</h4>${groups[d].map((p) => `<button class="pp-item ${p.id === st.sel ? 'on' : ''}" data-act="ppopen" data-id="${esc(p.id)}"><b>${esc(p.name)}</b>
          <span class="sub">${esc([p.location, p.units ? p.units + ' unit type' + (p.units > 1 ? 's' : '') : '', p.images ? p.images + ' image' + (p.images > 1 ? 's' : '') : 'no images yet'].filter(Boolean).join(' · '))}${p.published ? ' · <span class="pill" style="--c:var(--ok)">Published</span>' : ''}</span></button>`).join('')}`).join('')}</div>`;
  }
  function ppMediaHtml(p, d) {
    const edit = ppEdit(), st = pp(), byId = new Map(d.media.map((m) => [m.id, m]));
    return `<div class="panel"><h3>Photos, floor plans &amp; brochures <span class="muted">${p.media.length} file${p.media.length === 1 ? '' : 's'} · JPEG, PNG, WebP, GIF up to ${Math.round(((st.limits || {}).image || 10485760) / 1048576)} MB; PDF up to ${Math.round(((st.limits || {}).pdf || 26214400) / 1048576)} MB · kept in the portal's database</span></h3><div class="pad">
      ${edit ? `<div class="pp-up"><label class="btn sm">Upload files<input type="file" data-ch="ppfiles" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" hidden></label>
        ${st.uploading ? `<span class="muted" role="status">${esc(st.uploading)}</span>` : ''}
        <span class="spacer"></span><input data-pp="driveLink" value="${esc(d.driveLink || '')}" placeholder="Google Drive folder or file link" aria-label="Google Drive link" maxlength="300">
        <button class="btn sm" data-act="ppdrive" ${st.drive ? '' : 'disabled title="Google Drive isn\'t connected on this server"'}>Add from Drive</button>
        <button class="btn sm" data-act="ppbuild" ${st.drive && !st.building ? '' : 'disabled'}>${st.building ? 'Reading the Drive folder…' : 'Build from Google Drive'}</button></div>
        ${!st.drive ? '<div class="sub">Google Drive isn\'t connected on this server, so files are uploaded directly. The Drive link is kept for reference.</div>' : `<div class="sub">The portal reads only Drive folders shared with <b>${esc(st.drive.email)}</b> (Viewer). Nothing is changed in Drive.</div>`}` : ''}
      ${!d.media.length ? '<div class="empty">No files yet.</div>' : `<div class="pp-media">${d.media.map((m) => { const saved = p.media.find((x) => x.id === m.id) || m;
        return `<div class="pp-m ${m.use === false ? 'off' : ''}">${m.type === 'image' ? `<img src="${esc(ppMediaUrl(p.id, m.id))}" alt="${esc(m.caption || m.name)}" loading="lazy">` : `<a class="pp-pdf" href="${esc(ppMediaUrl(p.id, m.id))}" target="_blank" rel="noopener">PDF<br><span class="sub">${esc(saved.name)}</span></a>`}
          <input data-ppm="${esc(m.id)}" data-k="caption" value="${esc(m.caption || '')}" placeholder="Caption" maxlength="200" aria-label="Caption" ${edit ? '' : 'disabled'}>
          <div class="pp-mrow"><select data-ppm="${esc(m.id)}" data-k="kind" aria-label="Kind" ${edit ? '' : 'disabled'}>${PPK.kinds.filter((k) => m.type === 'image' ? k !== 'brochure' : k !== 'photo' && k !== 'floorplan').map((k) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${esc(PPK.kindLabels[k])}</option>`).join('')}</select>
          <label class="tagck"><input type="checkbox" data-ppm="${esc(m.id)}" data-k="use" ${m.use !== false ? 'checked' : ''} ${edit ? '' : 'disabled'}> On page</label></div>
          ${edit ? `<div class="pp-mrow">${m.type === 'image' ? `<button class="btn sm" data-act="ppcover" data-id="${esc(m.id)}">${d.cover === m.id ? 'Cover ✓' : 'Set cover'}</button>` : ''}
            <button class="btn sm danger" data-act="ppdelmedia" data-id="${esc(m.id)}">Remove</button></div>` : ''}
          <span class="sub">${esc(saved.from === 'drive' ? 'From Drive' : 'Uploaded')}${saved.by ? ' by ' + esc(saved.by) : ''}</span></div>`; }).join('')}</div>`}
      ${byId.size ? '' : ''}</div></div>`;
  }
  function ppUnitsHtml(p, d) {
    const edit = ppEdit(), imgs = d.media.filter((m) => m.type === 'image'), dis = edit ? '' : 'disabled';
    const cell = (i, k, ph, w) => `<td><input data-ppu="${i}" data-k="${k}" value="${esc(d.units[i][k] || '')}" placeholder="${esc(ph)}" maxlength="${PPK.unitText[k]}" style="width:${w}" aria-label="${esc(ph)}" ${dis}></td>`;
    return `<div class="panel"><h3>Units &amp; rooms <span class="muted">${d.units.length} unit type${d.units.length === 1 ? '' : 's'}</span><span class="spacer"></span>${edit ? '<button class="btn sm" data-act="ppaddunit">+ Add unit type</button>' : ''}</h3>
      ${d.units.length ? `<div class="scroll-x"><table class="t pp-units"><thead><tr><th>Unit type</th><th>BR</th><th>Size (sqm)</th><th>Price from</th><th>Availability</th><th>Photo / floor plan</th><th>Notes</th><th></th></tr></thead><tbody>
        ${d.units.map((u, i) => `<tr>${cell(i, 'type', 'e.g. 2BR', '110px')}${cell(i, 'bedrooms', 'BR', '50px')}${cell(i, 'sizeSqm', 'sqm', '70px')}${cell(i, 'priceFrom', 'Price', '110px')}${cell(i, 'availability', 'Available', '100px')}
          <td><select data-ppu="${i}" data-k="media" aria-label="Photo or floor plan" ${dis}><option value="">(none)</option>${imgs.map((m) => `<option value="${esc(m.id)}" ${u.media === m.id ? 'selected' : ''}>${esc((m.caption || m.name).slice(0, 40))}</option>`).join('')}</select></td>
          ${cell(i, 'notes', 'Notes', '160px')}<td>${edit ? `<button class="btn sm ghost" data-act="ppdelunit" data-i="${i}" aria-label="Remove unit">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pad empty">No unit types yet.</div>'}</div>`;
  }
  function ppProposalHtml() {
    const st = pp(); if (!st.proposal && !st.buildNote && !st.buildResult) return '';
    const r = st.buildResult || {}, show = (v) => Array.isArray(v) ? (v.length && typeof v[0] === 'object' ? v.map((u) => [u.type, u.bedrooms && u.bedrooms + ' BR', u.sizeSqm && u.sizeSqm + ' sqm', u.priceFrom].filter(Boolean).join(' · ')).join('; ') : v.join('; ')) : v;
    return `<div class="panel pp-review"><h3>From Google Drive — review before using <span class="muted">nothing is saved until you click Save</span><span class="spacer"></span><button class="btn sm ghost" data-act="ppclearprop">Close</button></h3><div class="pad">
      <div class="sub">${esc([r.added ? r.added.length + ' file' + (r.added.length === 1 ? '' : 's') + ' added' : '', r.docsRead != null ? r.docsRead + ' document' + (r.docsRead === 1 ? '' : 's') + ' read' : '', st.buildNote].filter(Boolean).join(' · '))}</div>
      ${r.skipped && r.skipped.length ? `<details class="sub"><summary>${r.skipped.length} not used</summary>${r.skipped.map((s) => `<div>${esc(s.name)}: ${esc(s.why)}</div>`).join('')}</details>` : ''}
      ${(st.proposal || []).length ? `<table class="t"><thead><tr><th>Use</th><th>Field</th><th>Found in the documents</th><th>Now</th></tr></thead><tbody>${st.proposal.map((x, i) => `<tr><td><input type="checkbox" data-ch="pppropck" data-i="${i}" ${x.apply ? 'checked' : ''} aria-label="Use ${esc(x.field)}"></td>
        <td>${esc(x.field)}${x.current && (!Array.isArray(x.current) || x.current.length) ? ' <span class="pill" style="--c:var(--warn)">replace</span>' : ''}</td><td>${esc(String(x.label || show(x.value)).slice(0, 600))}</td><td class="muted">${esc(String(show(x.current) || '—').slice(0, 300))}</td></tr>`).join('')}</tbody></table>
        <div class="actions"><button class="btn primary" data-act="ppapplyprop">Use ticked values</button><span class="sub">Empty fields are ticked; fields you already filled are only offered.</span></div>` : ''}</div></div>`;
  }
  function pagesView() {
    const st = pp();
    if (!st.list && !st.listLoading && !st.listErr) setTimeout(ppLoadList, 0);
    const edit = ppEdit(), d = st.draft, p = st.proj;
    let main;
    if (!st.sel) main = `<div class="empty">${st.list && st.list.length ? 'Choose a project.' : 'Projects you add appear here.'}</div>`;
    else if (st.loadErr) main = `<div class="src-err" role="alert">${esc(st.loadErr)}</div>`;
    else if (!p) main = '<div class="empty" role="status">Loading the project…</div>';
    else {
      const link = `${API.base || location.origin}/p/${p.slug}`;   // the published page is served by the API's own address
      main = `<div class="panel"><h3>${esc(p.name)} <span class="muted">${esc(p.developer)}</span><span class="spacer"></span>
          <a class="btn sm" href="${esc(API.url('/api/projects/' + p.id + '/preview'))}" target="_blank" rel="noopener">Preview</a>
          ${edit ? `<button class="btn sm" data-act="ppembed">Copy HTML for WordPress</button><button class="btn sm ${p.published ? '' : 'primary'}" data-act="pppublish">${p.published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn sm primary" data-act="ppsave" ${st.saving || !st.dirty ? 'disabled' : ''}>${st.saving ? 'Saving…' : 'Save'}</button>` : ''}</h3>
        <div class="pad">
          ${st.saveErr ? `<div class="src-err" role="alert">${esc(st.saveErr)}</div>` : ''}${st.dirty ? '<div class="sub" role="status"><b>Unsaved changes.</b></div>' : `<div class="sub">Saved ${esc(ago(p.updatedAt))}${p.updatedBy && p.updatedBy.name ? ' by ' + esc(p.updatedBy.name) : ''}.</div>`}
          <div class="sub">${p.published ? `Published page: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a> <button class="btn sm ghost" data-act="ppcopylink" data-v="${esc(link)}">Copy link</button>` : 'Not published: only signed-in staff can preview it.'}</div>
          <datalist id="ppStatuses">${PPK.statuses.map((s) => `<option>${esc(s)}</option>`).join('')}</datalist>
          <div class="grid">${ppInput('name', 'Project name')}${ppInput('developer', 'Developer')}${ppInput('location', 'Location')}${ppInput('status', 'Status', { list: 'ppStatuses', ph: 'Pre-selling / RFO' })}
            ${ppInput('turnover', 'Turnover')}${ppInput('priceFrom', 'Price from')}${ppInput('tagline', 'Tagline', { full: true })}
            ${ppInput('description', 'Description', { area: true, full: true, rows: 5, max: PPK.descriptionMax })}
            ${ppInput('highlights', 'Highlights (one per line)', { area: true, rows: 4 })}${ppInput('amenities', 'Amenities (one per line)', { area: true, rows: 4 })}
            ${ppInput('map', 'Map location', { ph: 'Address or place name' })}${ppInput('video', 'YouTube video link', { ph: 'youtu.be/… or youtube.com/watch?v=…' })}
            ${ppInput('pageUrl', 'Live page link (after publishing)', { full: true, ph: 'Its address on your website' })}</div>
          ${edit ? `<div class="actions"><span class="spacer"></span><button class="btn danger sm" data-act="ppdelete">Remove project</button></div>` : ''}</div></div>
        ${ppProposalHtml()}${ppUnitsHtml(p, d)}${ppMediaHtml(p, d)}`;
    }
    return `<div class="pp-layout"><aside class="panel pp-side"><h3>Project Pages <span class="muted">${(st.list || []).length}</span></h3><div class="pad">${ppListHtml()}</div>
        ${edit ? `<div class="pad pp-hook"><label>Form endpoint <span class="muted">(Apps Script public /exec link; sends inquiries to Website Inquiries)</span><input data-ch="pphook" value="${esc(st.hook || '')}" placeholder="script.google.com/macros/s/…/exec"></label>
          ${st.hook ? '' : '<div class="sub">Not set: published pages show no inquiry form.</div>'}</div>` : ''}</aside>
      <section class="pp-main">${main}</section></div>`;
  }
  async function ppCreate() {
    const v = (id) => ($('#' + id) || {}).value || '';
    const body = { name: v('ppnName').trim(), developer: v('ppnDev').trim(), location: v('ppnLoc').trim(), status: v('ppnStatus').trim(), turnover: v('ppnTurn').trim(), priceFrom: v('ppnPrice').trim(), driveLink: v('ppnDrive').trim() };
    if (!body.name || !body.developer) return toast('Project name and developer are required.', true);
    if (body.driveLink && !SH.parseDriveLink(body.driveLink)) return toast('That doesn\'t look like a Google Drive link.', true);
    let r; try { r = await API.post('/api/projects', body); } catch (e) { if (!signedOut(e)) toast(e.message, true); return; }
    S.modalReturn = null; closeModal();
    const st = pp(); st.list = (st.list || []).concat([{ id: r.project.id, name: r.project.name, developer: r.project.developer, location: r.project.location, units: 0, images: 0 }]);
    await ppOpen(r.project.id); toast('Project added.' + (body.driveLink && st.drive ? ' Use "Build from Google Drive" to fill it from the folder.' : ''));
  }
  async function ppSave() {
    const st = pp(), d = st.draft, p = st.proj; if (!d || st.saving) return;
    const body = { version: p.version, cover: d.cover || '', description: d.description || '', highlights: d.highlights || '', amenities: d.amenities || '',
      units: d.units.map((u) => ({ type: u.type || '', bedrooms: u.bedrooms || '', sizeSqm: u.sizeSqm || '', priceFrom: u.priceFrom || '', availability: u.availability || '', notes: u.notes || '', media: u.media || '' })),
      media: d.media.map((m) => ({ id: m.id, caption: m.caption || '', kind: m.kind, use: m.use !== false })) };
    Object.keys(PPK.text).forEach((k) => { body[k] = d[k] || ''; });
    const { errors } = SH.validateProject(body, { mediaIds: p.media.map((m) => m.id), imageIds: p.media.filter((m) => m.type === 'image').map((m) => m.id) });
    if (errors.length) { st.saveErr = errors[0]; return renderView(); }
    st.saving = true; st.saveErr = ''; renderView();
    try { ppSet((await API.put('/api/projects/' + p.id, body)).project); toast('Project saved.'); }
    catch (e) { if (signedOut(e)) return; st.saveErr = 'Not saved: ' + e.message; toast('Not saved.', true); }
    st.saving = false; renderView();
  }
  /** After a media change on the server: take its media list, keep the person's unsaved edits to the other fields. */
  function ppMergeMedia(proj) {
    const st = pp(), keep = st.dirty ? st.draft : null;
    const edits = keep ? new Map(keep.media.map((m) => [m.id, m])) : new Map();
    ppSet(proj);
    if (keep) { st.draft = { ...keep, media: proj.media.map((m) => ({ ...m, ...(edits.get(m.id) ? { caption: edits.get(m.id).caption, kind: edits.get(m.id).kind, use: edits.get(m.id).use } : {}) })), version: proj.version }; st.dirty = true; }
    if (st.draft.cover && !proj.media.some((m) => m.id === st.draft.cover)) st.draft.cover = '';
  }
  async function ppUpload(files) {
    const st = pp(), p = st.proj; if (!p) return;
    const list = Array.from(files || []).slice(0, 10), lim = st.limits || { image: 10485760, pdf: 26214400 };
    let ok = 0; const bad = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.size > (/pdf/i.test(f.type) ? lim.pdf : lim.image)) { bad.push(f.name + ': too large'); continue; }
      st.uploading = `Uploading ${i + 1} of ${list.length}…`; renderView();
      try { const r = await API.upload(`/api/projects/${p.id}/media`, f); ppMergeMedia(r.project); ok++; } catch (e) { if (signedOut(e)) return; bad.push(f.name + ': ' + e.message); }
    }
    st.uploading = ''; renderView();
    toast(`${ok} file${ok === 1 ? '' : 's'} uploaded${bad.length ? ' · not uploaded: ' + bad.join('; ') : ''}.`, !!bad.length);
  }
  async function ppDriveFiles() {
    const st = pp(), link = (st.draft.driveLink || '').trim();
    if (!SH.parseDriveLink(link)) return toast('Paste a Google Drive folder or file link first.', true);
    let r; try { r = await API.post('/api/projects/drive/files', { link }); } catch (e) { if (!signedOut(e)) toast(e.message, true); return; }
    const files = r.files.filter((f) => f.importable);
    S.modal = { kind: 'ppdrive' };
    openModal(`<h3 id="modalTitle">Add from Drive <span class="muted" style="font-weight:400;font-size:12px">${files.length} image${files.length === 1 ? '' : 's'} or PDF${files.length === 1 ? '' : 's'}</span></h3>
      ${files.length ? `<div class="pp-dlist">${files.slice(0, 120).map((f) => `<label class="tagck"><input type="checkbox" class="ppdf" value="${esc(f.id)}"> ${esc(f.name)} <span class="muted">${f.size ? Math.round(f.size / 1024) + ' KB' : ''}</span></label>`).join('')}</div>`
        : '<div class="empty">No images or PDFs in that link.</div>'}
      <div class="sub">At most 20 at a time. They're copied into the portal; nothing changes in Drive.</div>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="button" class="btn primary" data-act="ppimport" ${files.length ? '' : 'disabled'}>Add selected</button></div>`);
  }
  // events: wired from the shared ACT / CH tables
  Object.assign(ACT_PP, {
    ppnew: () => { S.modal = { kind: 'ppnew' }; openModal(`<h3 id="modalTitle">Add developer project</h3><div class="grid">
        <label>Project name*<input id="ppnName" maxlength="120" required></label><label>Developer*<input id="ppnDev" maxlength="120" required></label>
        <label>Location<input id="ppnLoc" maxlength="160"></label><label>Status<input id="ppnStatus" list="ppStatuses2" value="Pre-selling" maxlength="40"></label>
        <label>Turnover<input id="ppnTurn" maxlength="60"></label><label>Price from<input id="ppnPrice" maxlength="60"></label>
        <label class="full">Google Drive folder (optional)<input id="ppnDrive" maxlength="300" placeholder="drive.google.com/drive/folders/…"></label></div>
        <datalist id="ppStatuses2">${PPK.statuses.map((s) => `<option>${esc(s)}</option>`).join('')}</datalist>
        <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="submit" class="btn primary">Add project</button></div>`, { form: 'ppnew' }); },
    ppopen: (el) => ppOpen(el.dataset.id),
    ppreload: () => { pp().list = null; pp().listErr = ''; renderView(); },
    ppsave: () => ppSave(),
    ppaddunit: () => { const st = pp(); if (st.draft.units.length >= PPK.unitsMax) return toast(`At most ${PPK.unitsMax} unit types.`, true); st.draft.units.push({ type: '', bedrooms: '', sizeSqm: '', priceFrom: '', availability: 'Available', notes: '', media: '' }); st.dirty = true; renderView(); },
    ppdelunit: (el) => { const st = pp(); st.draft.units.splice(+el.dataset.i, 1); st.dirty = true; renderView(); },
    ppcover: (el) => { const st = pp(); st.draft.cover = st.draft.cover === el.dataset.id ? '' : el.dataset.id; st.dirty = true; renderView(); },
    ppdelmedia: async (el) => {
      const st = pp(), m = st.proj.media.find((x) => x.id === el.dataset.id); if (!m || !confirm(`Remove ${m.name}? It is deleted from the portal (not from Drive).`)) return;
      try { ppMergeMedia((await API.del(`/api/projects/${st.proj.id}/media/${m.id}`)).project); toast('File removed.'); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      renderView();
    },
    ppdrive: () => ppDriveFiles(),
    ppimport: async () => {
      const ids = $$('#modal .ppdf:checked').map((x) => x.value); if (!ids.length) return toast('Tick the files to add.', true); if (ids.length > 20) return toast('At most 20 at a time.', true);
      const st = pp(); closeModal(); st.uploading = 'Copying from Drive…'; renderView();
      try { const r = await API.post(`/api/projects/${st.proj.id}/drive/import`, { ids }); ppMergeMedia(r.project); toast(`${r.added.length} added${r.skipped.length ? ' · ' + r.skipped.length + ' not added (' + r.skipped.map((s) => s.name + ': ' + s.why).join('; ') + ')' : ''}.`, !!r.skipped.length && !r.added.length); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
      st.uploading = ''; renderView();
    },
    ppbuild: async () => {
      const st = pp(), link = (st.draft.driveLink || '').trim();
      if (!SH.parseDriveLink(link)) return toast('Paste the project\'s Google Drive folder link first.', true);
      st.building = true; renderView();
      try { const r = await API.post(`/api/projects/${st.proj.id}/drive/build`, { link }); ppMergeMedia(r.project); Object.assign(st, { proposal: r.proposal, buildNote: r.note, buildResult: r }); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
      st.building = false; renderView();
    },
    ppclearprop: () => { Object.assign(pp(), { proposal: null, buildNote: '', buildResult: null }); renderView(); },
    ppapplyprop: () => {
      const st = pp(); let n = 0;
      (st.proposal || []).filter((x) => x.apply).forEach((x) => { st.draft[x.field] = ['highlights', 'amenities'].includes(x.field) ? x.value.join('\n') : x.field === 'units' ? x.value.map((u) => ({ ...u })) : x.value; n++; });
      if (n) st.dirty = true; Object.assign(st, { proposal: null, buildNote: '', buildResult: null }); renderView();
      toast(n ? `${n} field${n === 1 ? '' : 's'} filled in. Review them, then Save.` : 'Nothing was ticked.');
    },
    pppublish: async () => {
      const st = pp(), p = st.proj, on = !p.published;
      if (st.dirty) return toast('Save your changes first.', true);
      if (!confirm(on ? `Publish ${p.name}? Anyone with the link can then see the page, its photos and brochures.` : `Unpublish ${p.name}? Its link and its images on other sites stop working.`)) return;
      try { ppSet((await API.put(`/api/projects/${p.id}/publish`, { published: on })).project); toast(on ? 'Published.' : 'Unpublished.'); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      renderView();
    },
    ppembed: async () => {
      const p = pp().proj; let r; try { r = await API.get(`/api/projects/${p.id}/embed`); } catch (e) { if (!signedOut(e)) toast(e.message, true); return; }
      try { await copyText(r.html); toast('HTML copied. Paste it into a WordPress Custom HTML block.' + (r.warnings.length ? ' Note: ' + r.warnings.join(' ') : ''), !!r.warnings.length); } catch (e) { toast('Copy was blocked by the browser.', true); }
    },
    ppcopylink: async (el) => { try { await copyText(el.dataset.v); toast('Link copied.'); } catch (e) { toast('Copy was blocked by the browser.', true); } },
    ppdelete: async () => {
      const st = pp(), p = st.proj; if (!confirm(`Remove ${p.name}? Its page, units and uploaded files are deleted from the portal. This can't be undone.`)) return;
      try { await API.del('/api/projects/' + p.id); Object.assign(st, { sel: '', proj: null, draft: null, dirty: false, list: (st.list || []).filter((x) => x.id !== p.id) }); toast('Project removed.'); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      renderView();
    },
  });
  Object.assign(CH_PP, {
    ppfiles: (el) => { const f = el.files; ppUpload(f).then(() => { el.value = ''; }); },
    pppropck: (el) => { const x = (pp().proposal || [])[+el.dataset.i]; if (x) x.apply = el.checked; },
    pphook: async (el) => {
      const v = el.value.trim();
      if (!SH.validHook(v)) return toast('The form endpoint must be the Apps Script /exec link (script.google.com/macros/s/…/exec).', true);
      try { pp().hook = (await API.put('/api/project-settings', { inquiryHook: v })).inquiryHook; toast(v ? 'Form endpoint saved.' : 'Form endpoint cleared: pages show no inquiry form.'); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      renderView();
    },
  });
  /** Typing in the project form: updates the draft only (no redraw, so focus and caret stay). */
  function ppField(el) {
    const st = pp(); if (!st.draft || !ppEdit()) return;
    if (el.dataset.pp) st.draft[el.dataset.pp] = el.value;
    else if (el.dataset.ppu != null) st.draft.units[+el.dataset.ppu][el.dataset.k] = el.value;
    else if (el.dataset.ppm) { const m = st.draft.media.find((x) => x.id === el.dataset.ppm); if (m) m[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }
    st.dirty = true;
    const s = $('[data-act="ppsave"]'); if (s) s.disabled = false;
  }

  // ---------- Upselling (server: src/upsell.js; sends through respond.io only after the operator confirms) ----------
  const UPS = SH.UPSELL;
  const up = () => (S.up = S.up || { picked: new Set() });
  const upEdit = () => access('upsell') === 'edit';
  async function upLoad() {
    const st = up(); st.loading = true; st.err = '';
    try { const [m, l] = await Promise.all([API.get('/api/upsell/meta'), API.get('/api/upsell/campaigns')]); st.meta = m; st.list = l.campaigns; if (!st.sel && st.list[0]) upOpen(st.list[0].id); }
    catch (e) { if (signedOut(e)) return; st.err = e.message; }
    st.loading = false; if (S.view === 'upsell') renderView();
  }
  async function upOpen(id) {
    const st = up(); if (st.dirty && !confirm('Discard your unsaved changes to this offer?')) return;
    Object.assign(st, { sel: id, camp: null, draft: null, aud: null, results: null, dirty: false, picked: new Set(), audErr: '', saveErr: '' }); renderView();
    try { st.camp = (await API.get('/api/upsell/campaigns/' + id)).campaign; st.draft = JSON.parse(JSON.stringify(st.camp)); } catch (e) { if (signedOut(e)) return; st.err = e.message; }
    renderView(); upAudience(); upResults();
  }
  async function upAudience() {
    const st = up(); if (!st.sel) return; st.audLoading = true; st.audErr = ''; renderView();
    try { st.aud = await API.get(`/api/upsell/campaigns/${st.sel}/audience`); } catch (e) { if (signedOut(e)) return; st.audErr = e.message; st.aud = null; }
    st.audLoading = false; renderView();
  }
  async function upResults() { const st = up(); try { st.results = (await API.get(`/api/upsell/campaigns/${st.sel}/results`)).results; } catch (e) { if (signedOut(e)) return; } if (S.view === 'upsell') renderView(); }
  /** Saves the draft; the audience is worked out again on the server afterwards (nothing is sent). */
  /** The mailer's merge tags for the chosen email service (Index.html espTags). */
  const upEspTags = (h, esp) => (esp === 'mailchimp' ? h.replace(/\{\{first_name\}\}/g, '*|FNAME|*').replace(/\{\{unsubscribe\}\}/g, '*|UNSUB|*') : h.replace(/\{\{first_name\}\}/g, '{{ contact.FIRSTNAME }}').replace(/\{\{unsubscribe\}\}/g, '{{ unsubscribe }}'));
  async function upSave() {
    const st = up(), d = st.draft;
    const body = { version: st.camp.version, name: d.name, template: d.template, projectId: d.projectId || '', text: d.text, tag: d.tag, channelId: d.channelId || '', audience: d.audience };
    const { errors } = SH.validateCampaign(body, { projectIds: (st.meta.projects || []).map((p) => p.id) });
    if (errors.length) { st.saveErr = errors[0]; return renderView(); }
    st.saving = true; st.saveErr = ''; renderView();
    try { st.camp = (await API.put('/api/upsell/campaigns/' + st.sel, body)).campaign; st.draft = JSON.parse(JSON.stringify(st.camp)); st.dirty = false; toast('Offer saved. Nothing was sent.'); }
    catch (e) { if (signedOut(e)) return; st.saveErr = 'Not saved: ' + e.message; }
    st.saving = false; renderView(); upAudience();
  }
  function upsellView() {
    const st = up();
    if (!st.meta && !st.loading && !st.err) setTimeout(upLoad, 0);
    if (st.err) return `<div class="src-err" role="alert">${esc(st.err)} <button class="btn sm" data-act="upreload">Try again</button></div>`;
    if (!st.meta) return '<div class="empty" role="status">Loading Upselling…</div>';
    const m = st.meta, edit = upEdit();
    const head = `<div class="panel"><h3>Upselling <span class="muted">offers to clients · 1:1 through respond.io or a respond.io broadcast tag</span><span class="spacer"></span>
        <select data-ch="upsel" aria-label="Offer">${(st.list || []).map((c) => `<option value="${esc(c.id)}" ${c.id === st.sel ? 'selected' : ''}>${esc(c.name)}${c.counts['message:sent'] ? ' · ' + c.counts['message:sent'] + ' sent' : ''}</option>`).join('') || '<option value="">No offers yet</option>'}</select>
        ${edit && st.sel && (st.list || []).some((c) => c.id === st.sel && !Object.keys(c.counts || {}).length) ? '<button class="btn sm danger" data-act="updelete">Delete draft</button>' : ''}
        ${edit ? '<button class="btn sm primary" data-act="upnew">+ New offer</button>' : ''}</h3>
        ${m.sendsNote ? `<div class="pad"><div class="src-note stale" role="status">${esc(m.sendsNote)}</div></div>` : `<div class="pad sub">Sending is on: messages go to real clients, only after you review the recipients and confirm.</div>`}</div>`;
    if (!st.sel) return head + `<div class="empty">${edit ? 'Create an offer to start. Nothing is sent until you review and confirm.' : 'No offers yet.'}</div>`;
    const d = st.draft; if (!d) return head + '<div class="empty" role="status">Loading the offer…</div>';
    const a = d.audience, dis = edit ? '' : 'disabled', aud = st.aud;
    const statuses = (aud && aud.statuses) || [];
    const audPanel = `<div class="panel"><h3>1 · Audience <span class="muted">${aud ? `${aud.counts.audience} client${aud.counts.audience === 1 ? '' : 's'} · ${aud.counts.respond} on respond.io · ${aud.counts.email} with email · ${aud.counts.phone} with phone · ${aud.optedOut} opted out (never contacted)` : ''}</span>
        <span class="spacer"></span><button class="btn sm" data-act="upaud">Refresh</button></h3><div class="pad up-filters">
        <label>Who<select data-up="preset" ${dis}>${UPS.presets.map((p) => `<option value="${p}" ${a.preset === p ? 'selected' : ''}>${esc(UPS.presetLabels[p])}</option>`).join('')}</select></label>
        <label>Rent / Sale<select data-up="type" ${dis}><option value="">Any</option><option ${a.type === 'Rent' ? 'selected' : ''}>Rent</option><option value="Buy" ${a.type === 'Buy' ? 'selected' : ''}>Sale</option></select></label>
        <label>City<input data-up="city" value="${esc(a.city)}" maxlength="60" ${dis}></label>
        <label>Contact<select data-up="contact" ${dis}>${UPS.contacts.map((c) => `<option value="${c}" ${a.contact === c ? 'selected' : ''}>${esc(UPS.contactLabels[c])}</option>`).join('')}</select></label>
        <label>Skip if offered in the last<span class="up-days"><input type="number" data-up="skipDays" min="0" max="365" value="${esc(a.skipDays)}" ${dis}> days</span></label>
        ${aud && aud.tenantsNote && a.preset === 'tenants' ? `<div class="full src-err" role="alert">${esc(aud.tenantsNote)}</div>` : ''}
        ${statuses.length ? `<div class="full up-st"><span class="sub">Client Status:</span> ${statuses.map((s) => `<label class="tagck"><input type="checkbox" data-upst="${esc(s)}" ${a.statuses.includes(s) ? 'checked' : ''} ${dis}> ${esc(s)}</label>`).join('')}</div>` : ''}</div></div>`;
    const tpl = m.templates.concat([{ k: 'project', label: 'Developer project (from Project Pages)' }]);
    const offer = `<div class="panel"><h3>2 · Offer <span class="spacer"></span>${edit ? `<button class="btn sm primary" data-act="upsave" ${st.saving || !st.dirty ? 'disabled' : ''}>${st.saving ? 'Saving…' : 'Save draft'}</button>` : ''}</h3><div class="pad">
        ${st.saveErr ? `<div class="src-err" role="alert">${esc(st.saveErr)}</div>` : ''}${st.dirty ? '<div class="sub" role="status"><b>Unsaved changes</b> (the audience and send use the saved offer).</div>' : ''}
        <div class="grid"><label>Offer name<input data-up="name" value="${esc(d.name)}" maxlength="80" ${dis}></label>
          <label>Start from<select data-up="template" ${dis}>${tpl.map((t) => `<option value="${t.k}" ${d.template === t.k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
          ${d.template === 'project' ? `<label>Project<select data-up="projectId" ${dis}><option value="">Pick a project</option>${(m.projects || []).map((p) => `<option value="${esc(p.id)}" ${d.projectId === p.id ? 'selected' : ''}>${esc(p.name + (p.developer ? ' · ' + p.developer : '') + (p.published ? '' : ' (not published)'))}</option>`).join('')}</select></label>
            <div>${edit ? '<button class="btn sm" data-act="upprojtext">Use the project\'s details</button>' : ''}</div>` : ''}
          <label class="full">Message <span class="muted">{firstName} = client's first name · {va} = your first name · add "Reply STOP to opt out"</span><textarea data-up="text" rows="9" maxlength="${UPS.textMax}" ${dis}>${esc(d.text)}</textarea></label>
          <label>respond.io tag (for a broadcast)<input data-up="tag" value="${esc(d.tag)}" maxlength="40" ${dis}></label>
          <label>respond.io channel (1:1 sends)<select data-up="channelId" ${dis}><option value="">Auto — the channel the client last used</option>${(m.channels || []).concat(d.channelId && !(m.channels || []).some((c) => c.id === d.channelId) ? [{ id: d.channelId, name: 'Channel ' + d.channelId, kind: '' }] : [])
            .map((c) => `<option value="${esc(c.id)}" ${d.channelId === c.id ? 'selected' : ''}>${esc({ whatsapp: 'WhatsApp', viber: 'Viber', email: 'Email', messenger: 'Messenger' }[c.kind] || c.kind || 'Channel')}${c.name ? ' · ' + esc(c.name) : ''}</option>`).join('')}</select></label></div>
        <div class="up-img">${st.camp.image ? `<img src="${esc(API.url('/api/upsell/campaigns/' + st.sel + '/image'))}" alt="Offer image"><span class="sub">${esc(st.camp.image.name)} · sent before the text</span>${edit ? '<button class="btn sm danger" data-act="upimgdel">Remove image</button>' : ''}`
          : edit ? `<label class="btn sm">Add an image<input type="file" data-ch="upimg" accept="image/jpeg,image/png" hidden></label><span class="sub">JPEG or PNG (what WhatsApp accepts), 5 MB at most. Sent first, then the text.</span>` : ''}</div></div></div>`;
    // the next batches as the server works them out (one respond.io contact once; opted-out clients never)
    const bn = (k) => (aud && aud.batches && aud.batches[k] ? aud.batches[k].ids.length : 0);
    const send = `<div class="panel"><h3>3 · Send</h3><div class="pad up-send">
        ${edit ? `<button class="btn primary" data-act="upreview" data-v="message" ${m.sends && !st.dirty && bn('message') ? '' : 'disabled'}>Review &amp; send 1:1 (next ${bn('message')})</button>
          <button class="btn" data-act="upreview" data-v="tag" ${m.sends && !st.dirty && bn('tag') && d.tag ? '' : 'disabled'}>Review &amp; tag ${bn('tag')} in respond.io</button>
          ${bn('retry') ? `<button class="btn" data-act="upreview" data-v="retry" ${m.sends && !st.dirty ? '' : 'disabled'}>Review &amp; retry ${bn('retry')} failed</button>` : ''}
          ${bn('retryTag') ? `<button class="btn" data-act="upreview" data-v="retryTag" ${m.sends && !st.dirty ? '' : 'disabled'}>Review &amp; retry ${bn('retryTag')} failed tags</button>` : ''}` : ''}
        ${m.testOnly ? `<div class="src-note stale full">Controlled test: this server only sends to ${m.testOnly} test contact${m.testOnly > 1 ? 's' : ''} (RESPOND_SEND_ONLY_TO); everyone else is left out, and only a Manager can send.</div>` : ''}
        <button class="btn" data-act="upcsv">Export for email (CSV)</button>
        <button class="btn" data-act="upmailer">Email version (HTML mailer)</button>
        ${edit && aud && aud.counts.audience ? `<button class="btn ghost" data-act="upoptall" ${st.dirty ? 'disabled' : ''}>Mark the whole audience opted out (${aud.counts.audience})…</button>` : ''}
        ${st.mailer ? `<div class="full up-mail"><div class="toolbar"><b>Email mailer</b> <span class="sub">Subject: ${esc(st.mailer.subject)} · logo on top · unsubscribe link included</span><span class="spacer"></span>
          <select data-ch="upesp" aria-label="Email service"><option value="brevo" ${st.esp !== 'mailchimp' ? 'selected' : ''}>For Brevo</option><option value="mailchimp" ${st.esp === 'mailchimp' ? 'selected' : ''}>For Mailchimp</option></select>
          <button class="btn sm ghost" data-act="upmcopy">Copy HTML</button><button class="btn sm ghost" data-act="upmdl">Download</button>
          ${edit ? `<button class="btn sm ghost" data-act="upmtest" ${st.mailer.testEmail ? '' : 'disabled title="Email (SMTP) is not set up on this server"'}>Send test to me</button>` : ''}<button class="btn sm ghost" data-act="upmx" aria-label="Close the mailer">✕</button></div>
          <iframe class="up-mframe" title="Mailer preview" sandbox="" srcdoc="${esc(st.mailer.html.replace(/\{\{first_name\}\}/g, 'there').replace(/\{\{unsubscribe\}\}/g, '#'))}"></iframe></div>` : ''}
        ${edit && st.picked.size ? `<button class="btn" data-act="upoptout" data-v="1">Mark ${st.picked.size} opted out</button>` : ''}
        <div class="sub full">1:1 sends go only to clients on respond.io who haven't had this offer, at most ${UPS.batchMax} per batch, ${UPS.gapMs} ms apart. WhatsApp only allows free text within 24 hours of the client's last message; for the rest, tag them and send an approved template broadcast from respond.io.</div></div></div>`;
    const res = (st.results || []), resById = new Map(res.filter((x) => x.action === 'message').map((x) => [x.id, x]));
    const pill2 = (s) => (s === 'sent' ? pill('Sent', 'var(--ok)') : s === 'failed' ? pill('Failed', 'var(--danger)') : s === 'sending' ? pill('Unknown — check the chat', 'var(--warn)') : '<span class="muted">—</span>');
    const table = `<div class="panel"><h3>Recipients <span class="muted">${aud ? aud.recipients.length : 0}</span></h3>
      ${st.audErr ? `<div class="pad"><div class="src-err" role="alert">${esc(st.audErr)}</div></div>` : st.audLoading && !aud ? '<div class="empty" role="status">Working out the audience…</div>' : !aud || !aud.recipients.length ? '<div class="empty">No clients match this audience.</div>'
        : `<div class="scroll-x"><table class="t up-t"><thead><tr>${edit ? '<th><span class="sr">Pick</span></th>' : ''}<th>Client</th><th>Status</th><th>Rent/Sale</th><th>City</th><th>Email</th><th>Phone</th><th>respond.io</th><th>Tenant</th><th>Last offer</th><th>This offer</th></tr></thead><tbody>
        ${aud.recipients.slice(0, 300).map((x) => { const r = resById.get(x.id); return `<tr>${edit ? `<td><input type="checkbox" data-ch="uppick" value="${esc(x.id)}" ${st.picked.has(x.id) ? 'checked' : ''} aria-label="Pick ${esc(x.name)}"></td>` : ''}<td><button class="linkbtn" data-act="open" data-id="${esc(x.id)}"><b>${esc(x.name)}</b></button></td><td>${esc(x.status || '—')}</td><td>${esc(x.type === 'Buy' ? 'Sale' : x.type)}</td><td>${esc(x.city)}</td>
          <td>${esc(x.email)}</td><td>${esc(x.phone)}</td><td>${x.onRespond ? '✓' : '<span class="muted">—</span>'}</td><td>${x.leaseEnd ? 'lease ends ' + esc(fmtDate(x.leaseEnd)) : x.tenant ? 'closed' : ''}</td><td>${x.lastOffer ? esc(fmtDate(x.lastOffer)) : 'never'}</td>
          <td>${pill2(x.message)}${x.tag === 'sent' ? ' ' + pill('Tagged', 'var(--accent)') : ''}${r && r.error ? `<div class="sub">${esc(r.error)}</div>` : ''}</td></tr>`; }).join('')}</tbody></table></div>${aud.recipients.length > 300 ? '<div class="sub pad">Showing the first 300.</div>' : ''}`}</div>`;
    // every send attempt of this offer, newest first (also clients no longer in the audience)
    const resPanel = res.length ? `<div class="panel"><h3>Results <span class="muted">${res.filter((x) => x.status === 'sent').length} sent · ${res.filter((x) => x.status === 'failed').length} failed${res.some((x) => x.status === 'sending') ? ' · ' + res.filter((x) => x.status === 'sending').length + ' unknown' : ''}</span></h3>
      <div class="scroll-x"><table class="t up-res"><thead><tr><th>Client</th><th>What</th><th>Result</th><th>When</th><th>By</th><th>Tries</th></tr></thead><tbody>${res.slice(0, 300).map((x) => `<tr><td>${esc(x.name || x.id)}</td><td>${x.action === 'tag' ? 'Tag' : 'Message'}</td>
        <td>${pill2(x.status)}${x.error ? `<div class="sub">${esc(x.error)}</div>` : ''}${x.status === 'sending' && edit ? `<div class="pp-mrow"><button class="btn sm" data-act="upresolve" data-id="${esc(x.id)}" data-a="${esc(x.action)}" data-v="sent">It was ${x.action === 'tag' ? 'tagged' : 'sent'}</button><button class="btn sm" data-act="upresolve" data-id="${esc(x.id)}" data-a="${esc(x.action)}" data-v="failed">Not ${x.action === 'tag' ? 'tagged' : 'sent'} (allow retry)</button></div>` : ''}</td>
        <td>${esc(fmtDate(x.at))}</td><td>${esc(x.by || '')}</td><td class="num">${esc(x.attempts || 1)}</td></tr>`).join('')}</tbody></table></div>
      ${res.some((x) => x.status === 'sending') ? '<div class="sub pad">"Unknown": respond.io may or may not have delivered it (a timeout, network or server error, or the server stopped). Check the client\'s chat in respond.io and mark it; these are never retried automatically.</div>' : ''}</div>` : '';
    const optPanel = aud && aud.opted && aud.opted.length ? `<div class="panel"><h3>Opted out <span class="muted">${aud.opted.length} · never contacted</span></h3><div class="pad up-list">${aud.opted.map((x) => `<span>${esc(x.name)}${x.self && edit ? ` <button class="btn sm ghost" data-act="upundoopt" data-id="${esc(x.id)}" aria-label="Undo opt-out for ${esc(x.name)}">Undo</button>` : x.self ? '' : ' <span class="muted">(same respond.io contact)</span>'}</span>`).join('')}</div></div>` : '';
    // the Apps Script's advice before a blast (Index.html "Before you blast")
    const tips = `<div class="panel"><h3>Before you blast — keeping it out of spam</h3><ul class="pad up-tips">
      <li><b>Email:</b> don't blast from Gmail or the portal. Use an email service (Brevo or Mailchimp — import the CSV) on a sub-domain with SPF, DKIM and DMARC set up. Warm up: 50–100 the first days, then double every few days. Add a one-click unsubscribe, a real sender name, plain text with one link, no ALL CAPS / "FREE" / "!!!".</li>
      <li><b>WhatsApp:</b> outside 24 h after the client's last message, WhatsApp only allows approved templates. Get a marketing template approved in respond.io, tag the audience here, then run a respond.io Broadcast to that tag. Keep blasts to one a month per client.</li>
      <li><b>Viber:</b> only clients who already chat with your Viber account can be reached, and Viber may charge for business messages outside an active chat — check your plan first.</li>
      <li><b>Always:</b> personalise ({firstName}), start with tenants and recent clients, honour STOP / unsubscribe (mark them opted out here), and leave at least 14 days between offers.</li></ul></div>`;
    return head + audPanel + offer + send + table + resPanel + optPanel + svcPanelHtml() + tips;
  }
  /** The channel 1:1 sends go out on (the offer's choice, or respond.io's own: the client's last-used channel). */
  function upChannelName() {
    const st = up(), id = st.camp && st.camp.channelId, ch = id && ((st.meta || {}).channels || []).find((c) => c.id === id);
    return !id ? 'each client\'s last-used channel (Auto)' : ch ? (({ whatsapp: 'WhatsApp', viber: 'Viber', email: 'Email', messenger: 'Messenger' }[ch.kind] || ch.kind || 'channel') + (ch.name ? ' · ' + ch.name : '')) : 'channel ' + id;
  }
  /** A phone number a tel: link can dial (digits, optional +), or ''. */
  const telOf = (p) => { const t = String(p || '').replace(/[^\d+]/g, ''); return /^\+?\d{7,15}$/.test(t) ? t : ''; };
  /** Why respond.io couldn't be opened for this lead, and what to do instead (a call from this device, when there is a number). */
  function rioProblem(kind, msg, tel, url) {
    S.modal = { kind: 'rio' };
    openModal(`<h3 id="modalTitle">${kind === 'call' ? 'Call on respond.io' : 'Message Lead'}</h3><p>${esc(msg)}</p>
      ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open the conversation in respond.io</a></p>` : ''}
      ${kind === 'call' && tel ? `<p class="sub">You can also call from this device: <a href="tel:${esc(tel)}">${esc(tel)}</a></p>` : ''}
      <div class="actions"><button type="button" class="btn" data-act="mclose">Close</button></div>`);
  }  /** The review before a real send: the batch, a rendered example, the image; sends only after the tick and the button. */
  async function upReview(kind) {
    const st = up();
    let aud; try { aud = st.aud = await API.get(`/api/upsell/campaigns/${st.sel}/audience`); } catch (e) { if (!signedOut(e)) toast(e.message, true); return; }
    const action = kind === 'tag' || kind === 'retryTag' ? 'tag' : 'message', retry = kind === 'retry' || kind === 'retryTag', bt = aud.batches[kind];
    const batch = bt.ids.map((id, i) => ({ id, name: bt.names[i] }));   // exactly the batch the server would send
    if (!batch.length) { renderView(); return toast('Nobody left to ' + (action === 'tag' ? 'tag.' : 'send to.')); }
    let pv = null; if (action === 'message') { try { pv = await API.get(`/api/upsell/campaigns/${st.sel}/preview?lead=${encodeURIComponent(batch[0].id)}`); } catch (e) { if (!signedOut(e)) toast(e.message, true); return; } }
    st.pending = { action, retry, hash: bt.hash };
    S.modal = { kind: 'upsend' };
    openModal(`<h3 id="modalTitle">${action === 'tag' ? `Tag ${batch.length} client${batch.length === 1 ? '' : 's'} “${esc(st.camp.tag)}” in respond.io` : `${retry ? 'Retry' : 'Send'} to ${batch.length} client${batch.length === 1 ? '' : 's'}`}</h3>
      <div class="src-note stale">${action === 'tag' ? 'This adds a tag to these contacts in respond.io. Nothing is sent to them.' : `This sends real messages to these clients through respond.io, on ${esc(upChannelName())}. It can't be undone.`}${aud.testOnly ? ' Controlled test: only the RESPOND_SEND_ONLY_TO contacts are in this batch.' : ''}</div>
      ${pv ? `<div class="up-pv">${pv.image ? `<img src="${esc(API.url(pv.image))}" alt="Offer image">` : ''}<div class="sub" id="upPvTo">Exactly what ${esc(pv.to)} receives:</div><pre class="report" id="upPvText">${esc(pv.text)}</pre></div>` : ''}
      <div class="sub">Recipients (${batch.length}${aud.recipients.length > batch.length ? ` of ${aud.recipients.filter((x) => x.onRespond).length} on respond.io` : ''})${pv ? ' — press a name to see their message' : ''}:</div>
      <div class="up-list">${batch.map((x) => (pv ? `<button type="button" class="linkbtn" data-act="uppv" data-id="${esc(x.id)}">${esc(x.name)}</button>` : `<span>${esc(x.name)}</span>`)).join('')}</div>
      <label class="tagck"><input type="checkbox" id="upConfirm"> I've reviewed the ${action === 'tag' ? 'list' : 'message and the recipients'}</label>
      <div class="actions"><button type="button" class="btn" data-act="mclose">Cancel</button><button type="button" class="btn primary" data-act="upgo" id="upGo" disabled>${action === 'tag' ? 'Tag' : retry ? 'Retry' : 'Send'} to ${batch.length}</button></div>`);
    const c = $('#upConfirm'); if (c) c.addEventListener('change', () => { $('#upGo').disabled = !c.checked; });
  }
  async function upGo() {
    const st = up(), p = st.pending; if (!p || !$('#upConfirm') || !$('#upConfirm').checked || st.sending) return;
    st.sending = true; $('#upGo').disabled = true; $('#upGo').textContent = p.action === 'tag' ? 'Tagging…' : 'Sending…';
    let r;
    try { r = await API.post(`/api/upsell/campaigns/${st.sel}/send`, { confirm: true, hash: p.hash, action: p.action, ...(p.retry ? { retry: true } : {}) }); }
    catch (e) { st.sending = false; if (signedOut(e)) return; closeModal(); toast(e.message, true); upAudience(); return; }
    st.sending = false; st.pending = null; closeModal();
    const n = (s) => r.results.filter((x) => x.status === s).length;
    toast(`${p.action === 'tag' ? 'Tagged' : 'Sent'} ${n('sent')} · failed ${n('failed')} · skipped ${n('skipped')}${r.stopped ? ' · stopped: ' + r.stopped : ''}`, !!(n('failed') || r.stopped));
    upAudience(); upResults(); upLoadList();
  }
  async function upLoadList() { try { up().list = (await API.get('/api/upsell/campaigns')).campaigns; } catch (e) { signedOut(e); } if (S.view === 'upsell') renderView(); }
  function upField(el) {
    const st = up(); if (!st.draft || !upEdit()) return;
    const k = el.dataset.up, d = st.draft;
    if (['preset', 'type', 'city', 'contact', 'skipDays'].includes(k)) d.audience[k] = k === 'skipDays' ? Number(el.value) || 0 : el.value; else d[k] = el.value;
    st.dirty = true;
    if (el.tagName === 'SELECT') {
      if (k === 'template' && el.value !== 'project') { const t = st.meta.templates.find((x) => x.k === el.value); if (t && (!d.text.trim() || confirm('Replace the message with the "' + t.label + '" text?'))) d.text = t.text; }
      renderView();
    } else { const s = $('[data-act="upsave"]'); if (s) s.disabled = false; }
  }
  Object.assign(ACT_PP, {
    // Try again starts over (also an offer whose loading failed)
    upreload: () => { Object.assign(up(), { meta: null, err: '', sel: '', camp: null, draft: null, aud: null, results: null, dirty: false }); renderView(); },
    // no browser prompt (blocked on some phones and in-app browsers): a default name, editable under "Offer name"
    upnew: async (el) => {
      const st = up(); if (st.dirty && !confirm('Discard your unsaved changes to this offer?')) return;
      if (el) el.disabled = true;
      try { const r = await API.post('/api/upsell/campaigns', { name: 'Concierge ' + new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }); st.dirty = false; st.list = [{ id: r.campaign.id, name: r.campaign.name, counts: {} }].concat(st.list || []); await upOpen(r.campaign.id); toast('New offer created. Rename it under "Offer name". Nothing is sent until you review and confirm.'); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
      if (el) el.disabled = false;
    },
    // an offer nothing was sent or tagged for can be deleted (the server keeps sent offers as records)
    updelete: async () => {
      const st = up(), c = (st.list || []).find((x) => x.id === st.sel); if (!c || !confirm(`Delete the draft "${c.name}"? It was never sent, so nothing else changes.`)) return;
      try { await API.del('/api/upsell/campaigns/' + st.sel); Object.assign(st, { list: st.list.filter((x) => x.id !== st.sel), sel: '', camp: null, draft: null, aud: null, results: null, dirty: false }); toast('Draft deleted.'); if (st.list[0]) upOpen(st.list[0].id); else renderView(); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    upsave: () => upSave(),
    upaud: () => upAudience(),
    // LOI: make the filled document from the reviewed fields (nothing is sent), and download one for review
    loimake: async () => {
      const l = leadById(S.open); if (!l) return; const st = loiState(l), f = st.form; if (!f || st.making) return;
      const chk = SH.validateLoi({ slot: f.slot, fields: f.fields }); if (chk.errors.length) return toast(chk.errors[0], true);
      if (chk.missing.length && !confirm(`These are still empty and will be blank lines in the document: ${chk.missing.join(', ')}. Make it anyway?`)) return;
      st.making = true; renderDrawerBody();
      const u = unitFor(l);
      try { const r = await API.post(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}`, { slot: f.slot, fields: f.fields, ...(u ? { unitKey: u.key, unitName: u.name } : {}) }); st.lois = [r.loi].concat(st.lois || []); toast('LOI made. Download it and check it; nothing was sent.'); }
      catch (e) { if (!signedOut(e)) toast('Not made: ' + e.message, true); }
      st.making = false; renderDrawerBody();
    },
    loitplretry: () => { S.loiTpl = null; renderView(); },
    drivestretry: () => { S.driveSt = null; renderView(); },
    // Google's consent screen (a full-page visit; Google sends the browser back to Settings → Files)
    driveconnect: () => { location.href = (API.base || '') + '/api/drive/oauth/start'; },
    driveswitch: () => {
      if (!confirm('Move Google Drive storage to another Google account? New files will be saved there. Files already saved stay in the current account\'s Drive, and the portal can\'t open them any more. The current account\'s access is removed.')) return;
      location.href = (API.base || '') + '/api/drive/oauth/start?switch=1';
    },
    drivedisconnect: async () => {
      if (!confirm('Disconnect Google Drive storage? The portal stops saving signed LOIs and deal files, and can\'t open the ones already saved until the same Google account is connected again. Nothing is deleted from Drive.')) return;
      try { const r = await API.post('/api/drive/disconnect', { confirm: true }); toast(r.revoked ? 'Google Drive storage disconnected' : 'Disconnected here, but Google could not be told. Remove "Blackhouse" access in that Google account (Security → Third-party connections).', !r.revoked); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      S.driveSt = null; S.driveNote = ''; S.deals = null; renderView();
    },
    // LOI e-signature: review the text and the channel, confirm, then the link is made (and sent, or shown to copy)
    loisend: (el) => {
      const l = leadById(S.open); if (!l) return; const st = loiState(l), x = (st.lois || []).find((y) => y.id === el.dataset.id); if (!x) return;
      const role = el.dataset.role, sg = st.signing || { channels: { link: true } }, unit = x.unitName || x.fields.TO_2 || 'the unit';
      const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
      const text = role === 'client' ? `Hi ${first(x.fields.CLIENT)}! Here is your Letter of Intent for ${unit}. Please review it and sign it online here:\n{link}\n\nMessage us if anything needs to change. — Blackhouse`
        : `Hi ${first(x.fields.TO_1)}! Good news — our client has signed a Letter of Intent for ${unit}. Please review and sign it here:\n\n{link}\n\n— Blackhouse`;
      const opts = [['link', 'Copy the link (I send it myself)', true], ['respond', 'respond.io message to the client', role === 'client' && sg.channels.respond && l.onRespond], ['email', 'Email', sg.channels.email]];
      openModal(`<div class="m-head"><h2>${role === 'client' ? 'Send the LOI to the client for e-signature' : 'Send the LOI to the owner for e-signature'}</h2><button type="button" class="btn ghost" data-act="mclose" aria-label="Close">✕</button></div>
        <div class="sub">A new signing link is made. It works once and expires in ${sg.ttlDays || 14} days; an earlier link for ${role === 'client' ? 'the client' : 'the owner'} stops working.</div>
        ${x.missing.length ? `<div class="src-err" role="alert">This LOI still has empty fields: ${esc(x.missing.join(', '))}.</div>` : ''}
        <label>How<select id="lsCh">${opts.map(([v, lab, ok]) => `<option value="${v}" ${ok ? '' : 'disabled'}>${esc(lab)}${ok ? '' : ' (not set up)'}</option>`).join('')}</select></label>
        <label>Email to <input id="lsTo" type="email" value="${esc(role === 'client' ? l.email || '' : '')}" placeholder="name@example.com"></label>
        <label>Message <span class="muted">{link} is replaced by the signing link</span><textarea id="lsTxt" rows="7" maxlength="2000">${esc(text)}</textarea></label>
        <label class="tagck"><input type="checkbox" id="lsOk"> I checked the LOI and the message${x.missing.length ? ', and want to send it with the empty fields' : ''}</label>
        <div id="lsOut"></div>
        <div class="actions"><button type="button" class="btn" data-act="mclose">Close</button><button type="button" class="btn primary" data-act="loisendgo" data-id="${esc(x.id)}" data-role="${role}" data-missing="${x.missing.length ? 1 : 0}">Make the link</button></div>`);
    },
    loisendgo: async (el) => {
      const l = leadById(S.open); if (!l) return;
      if (!$('#lsOk').checked) return toast('Tick the box to confirm.', true);
      const body = { role: el.dataset.role, channel: $('#lsCh').value, to: $('#lsTo').value.trim(), text: $('#lsTxt').value, confirm: true, ...(el.dataset.missing === '1' ? { allowMissing: true } : {}) };
      el.disabled = true;
      try {
        const r = await API.post(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}/${el.dataset.id}/send`, body);
        // the owner (Code.gs apiSendLoiOwner WhatsApp / Viber): opened on this device with the message, to the listing's number
        const ow = body.role === 'owner' && body.channel === 'link' ? SH.contactLinks((loiDraftFor(l).listing || {}).contactPhone) : null;
        $('#lsOut').innerHTML = `<div class="src-note" role="status"><b>${body.channel === 'link' ? 'Link ready — copy it to the ' + (body.role === 'client' ? 'client' : 'owner') : 'Sent.'}</b>
          <textarea readonly rows="5" id="lsDone">${esc(r.text)}</textarea><button type="button" class="btn sm" data-act="lscopy">Copy message</button>
          ${ow ? `<a class="btn sm" href="${esc(ow.whatsapp + '?text=' + encodeURIComponent(r.text))}" target="_blank" rel="noopener">Open WhatsApp to the owner</a> <a class="btn sm" data-act="lscopy" href="${esc(ow.viber)}">Open Viber (message copied)</a>` : ''}
          <span class="sub">Valid until ${esc(manilaTime(r.expiresAt))}. The link is shown only now.</span></div>`;
        el.hidden = true;
        const st = loiState(l), i = (st.lois || []).findIndex((y) => y.id === r.loi.id); if (i >= 0) st.lois[i] = r.loi;
      } catch (e) {
        el.disabled = false; if (signedOut(e)) return;
        // email / respond.io failed after the link was made: the link is shown so it can still be sent by hand
        if (e.data && e.data.text) {
          $('#lsOut').innerHTML = `<div class="src-err" role="alert">${esc(e.message)}</div><div class="src-note" role="status"><b>Send it yourself instead</b>
            <textarea readonly rows="5" id="lsDone">${esc(e.data.text)}</textarea><button type="button" class="btn sm" data-act="lscopy">Copy message</button></div>`;
          el.hidden = true; return;
        }
        toast(e.message, true);
      }
    },
    lscopy: async () => { const t = $('#lsDone'); try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch (e) { t.select(); toast('Copying was blocked: the text is selected, copy it yourself.', true); } },
    // save a signature's copies again (Drive, deal files): never a new signature and never a second Drive copy
    loistore: async (el) => {
      const l = leadById(S.open); if (!l) return; el.disabled = true;
      try {
        const r = await API.post(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}/${el.dataset.id}/store`, { role: el.dataset.role });
        const st = loiState(l), i = (st.lois || []).findIndex((y) => y.id === r.loi.id); if (i >= 0) st.lois[i] = r.loi;
        toast(r.store && r.store.status === 'saved' && !(r.deal && r.deal.status === 'failed') ? 'Signed copy saved.' : 'Still not saved: ' + ((r.store && r.store.error) || (r.deal && r.deal.error) || 'try again later'), !(r.store && r.store.status === 'saved'));
        renderDrawerBody();
      } catch (e) { el.disabled = false; if (!signedOut(e)) toast(e.message, true); }
    },    loisigned: async (el) => {
      const l = leadById(S.open); if (!l) return;
      try {
        const blob = await API.getBlob(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}/${el.dataset.id}/signed?fmt=${el.dataset.fmt}`);
        const a = document.createElement('a'), href = URL.createObjectURL(blob); a.href = href; a.download = `LOI-signed-${l.code || l.id}.${el.dataset.fmt}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      } catch (e) { if (!signedOut(e)) toast('Download failed: ' + e.message, true); }
    },
    dfopen: async (el) => {
      const l = leadById(S.open), u = l && unitFor(l); if (!u) return;
      try {
        const blob = await API.getBlob(`/api/deals/${loiSrc()}/${encodeURIComponent(l.id)}/${encodeURIComponent(u.key)}/${el.dataset.slot}/file${el.dataset.i ? '?i=' + el.dataset.i : ''}`);
        const a = document.createElement('a'), href = URL.createObjectURL(blob); a.href = href; a.download = el.textContent.trim(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    dfterm: async () => {
      const l = leadById(S.open), u = l && unitFor(l); if (!u) return;
      const t = SH.dealTerm($('#dfTermStart').value, $('#dfTermMonths').value); if (t.errors.length) return toast(t.errors[0], true);
      try { await API.put(`/api/deals/${loiSrc()}/${encodeURIComponent(l.id)}/${encodeURIComponent(u.key)}/term`, { start: t.value.start, months: t.value.months }); S.dealf = null; renderDrawerBody(); toast('Lease term saved.'); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    dfrm: async (el) => {
      const l = leadById(S.open), u = l && unitFor(l); if (!u) return;
      if (!confirm(`Remove "${SH.DEAL_SLOTS[el.dataset.slot]}" from this deal? The copy in Google Drive is kept.`)) return;
      try { await API.del(`/api/deals/${loiSrc()}/${encodeURIComponent(l.id)}/${encodeURIComponent(u.key)}/${el.dataset.slot}`); S.dealf = null; renderDrawerBody(); toast('Removed (kept in Drive).'); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    loitpldel: async (el) => {
      if (!confirm(`Remove the ${SH.LOI_SLOTS[el.dataset.slot]} template? LOIs already made are kept.`)) return;
      try { await API.del('/api/loi/templates/' + el.dataset.slot); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      S.loiTpl = null; S.loi = null; renderView();
    },
    loidl: async (el) => {
      const l = leadById(S.open); if (!l) return;
      try {
        const blob = await API.getBlob(`/api/loi/${loiSrc()}/${encodeURIComponent(l.id)}/${el.dataset.id}/docx`);
        const a = document.createElement('a'), href = URL.createObjectURL(blob);
        a.href = href; a.download = `LOI-${l.code || l.id}.docx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      } catch (e) { if (!signedOut(e)) toast('Download failed: ' + e.message, true); }
    },
    // the CSV is fetched (not a plain link), so an error is a message here, not a page that leaves the portal
    upcsv: async () => {
      const st = up();
      if (st.dirty) return toast('Save the offer first: the export uses the saved audience.', true);
      if (st.aud && !st.aud.counts.email) return toast('Nobody in this audience has an email address.', true);
      try {
        const csv = await API.getText('/api/upsell/campaigns/' + st.sel + '/csv');
        const a = document.createElement('a'), href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.href = href; a.download = `blackhouse-upsell-${st.sel}.csv`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      } catch (e) { if (!signedOut(e)) toast('Export failed: ' + e.message, true); }
    },
    upreview: (el) => upReview(el.dataset.v),
    upgo: () => upGo(),
    // the review: the exact message this recipient would get (worked out by the server, nothing is sent)
    uppv: async (el) => {
      const st = up();
      try { const pv = await API.get(`/api/upsell/campaigns/${st.sel}/preview?lead=${encodeURIComponent(el.dataset.id)}`); $('#upPvTo').textContent = `Exactly what ${pv.to} receives:`; $('#upPvText').textContent = pv.text; }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    upprojtext: async () => {
      const st = up(); if (!st.draft.projectId) return toast('Pick a project first.', true);
      try { const r = await API.get('/api/upsell/project-text/' + st.draft.projectId); if (!st.draft.text.trim() || confirm('Replace the message with this project\'s details?')) { st.draft.text = r.text; st.dirty = true; renderView(); } if (!r.published) toast('That project isn\'t published, so the message has no page link.', true); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    upimgdel: async () => { if (!confirm('Remove the image?')) return; try { const r = await API.del(`/api/upsell/campaigns/${up().sel}/image`); up().camp = r.campaign; up().draft.version = r.campaign.version; renderView(); upAudience(); } catch (e) { if (!signedOut(e)) toast(e.message, true); } },
    upresolve: async (el) => {
      if (!confirm(el.dataset.v === 'sent' ? 'Mark as sent? You checked the client\'s chat in respond.io and the message is there.' : 'Mark as not sent? It can then be retried.')) return;
      try { await API.post(`/api/upsell/campaigns/${up().sel}/resolve`, { leadId: el.dataset.id, outcome: el.dataset.v, action: el.dataset.a === 'tag' ? 'tag' : 'message' }); toast('Updated.'); upResults(); upAudience(); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    upundoopt: async (el) => { try { await API.post('/api/upsell/optout', { ids: [el.dataset.id], on: false }); toast('Opt-out removed.'); upAudience(); } catch (e) { if (!signedOut(e)) toast(e.message, true); } },
    // "Mark audience opted out…" (Index.html upOpt): the whole audience, with the count the operator saw
    upoptall: async () => {
      const st = up(), n = st.aud && st.aud.counts.audience; if (!n) return;
      if (!confirm(`Mark all ${n} client${n === 1 ? '' : 's'} in this audience as opted out? They are left out of every offer from now on (it can be undone per client).`)) return;
      try { const r = await API.post(`/api/upsell/campaigns/${st.sel}/optout-all`, { confirm: true, count: n }); toast(`${r.count} clients opted out.`); upAudience(); }
      catch (e) { if (!signedOut(e)) { toast(e.message, true); upAudience(); } }
    },
    upmailer: async () => {
      const st = up(); if (st.dirty) return toast('Save the offer first: the mailer uses the saved text.', true);
      try { st.mailer = await API.get(`/api/upsell/campaigns/${st.sel}/mailer`); renderView(); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    upmx: () => { up().mailer = null; renderView(); },
    upmcopy: () => { const st = up(); try { navigator.clipboard.writeText(upEspTags(st.mailer.html, st.esp)); toast('Mailer HTML copied — paste it into the ' + (st.esp === 'mailchimp' ? 'Mailchimp' : 'Brevo') + ' code editor'); } catch (e) { toast('Use Download instead', true); } },
    upmdl: () => { const st = up(), a = document.createElement('a'), href = URL.createObjectURL(new Blob([upEspTags(st.mailer.html, st.esp)], { type: 'text/html' })); a.href = href; a.download = 'blackhouse-mailer.html'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000); },
    upmtest: async () => { const st = up(); try { const r = await API.post('/api/upsell/mailer-test', { subject: st.mailer.subject, html: st.mailer.html }); toast('Test sent to ' + r.to); } catch (e) { if (!signedOut(e)) toast(e.message, true); } },
    upoptout: async (el) => {
      const st = up(), on = el.dataset.v === '1', ids = [...st.picked];
      if (on && !confirm(`Mark ${ids.length} client${ids.length === 1 ? '' : 's'} as opted out? They are left out of every offer.`)) return;
      try { await API.post('/api/upsell/optout', { ids, on }); st.picked = new Set(); toast(on ? 'Opted out.' : 'Opt-out removed.'); upAudience(); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
  });
  Object.assign(CH_PP, {
    upsel: (el) => upOpen(el.value),
    uppick: (el) => { const s = up().picked; if (el.checked) s.add(el.value); else s.delete(el.value); renderView(); },
    upimg: async (el) => {
      const f = el.files && el.files[0]; if (!f) return; if (f.size > UPS.imageMax) { el.value = ''; return toast('Images can be 5 MB at most.', true); }
      const st = up(); if (st.dirty) { el.value = ''; return toast('Save your changes first.', true); }
      try { const r = await API.upload(`/api/upsell/campaigns/${st.sel}/image`, f); st.camp = r.campaign; st.draft = JSON.parse(JSON.stringify(r.campaign)); toast('Image added.'); renderView(); upAudience(); } catch (e) { if (!signedOut(e)) toast(e.message, true); }
      el.value = '';
    },
  });

  // ---------- Calendar ----------
  function calendarView() {
    const m = S.calMonth || (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
    S.calMonth = m;
    const start = new Date(m); start.setDate(1 - m.getDay());
    // a broker filter that no longer matches any broker (source switch, Monday refresh) is dropped, never left hiding everything
    // (not while the viewings are still loading: an empty list says nothing yet; a source switch clears it anyway)
    if (S.calBroker && brokerNames().length && !brokerNames().includes(S.calBroker)) S.calBroker = '';
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
        ${me().role !== 'Broker' ? `<select data-ch="calbroker" style="padding:5px 8px"><option value="">All brokers</option>${brokerNames().map((b) => `<option ${S.calBroker === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : ''}
        <span class="spacer"></span><span class="legend">${LISTS.viewingStatuses.map((s) => `<span><span class="dot" style="background:${VSTAT_COLORS[s]}"></span> ${s} ${inMonth.filter((v) => v.status === s).length}</span>`).join('')}</span></div>
      <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>
      <div class="agenda" aria-label="Viewings this month">${inMonth.length ? inMonth.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((v) => { const l = leadById(v.leadId) || {}, x = unitOf(v);
        return `<button type="button" class="ag-item ${v.date === t ? 'today' : ''}" data-act="viewing" data-id="${esc(v.id)}"><span class="ag-date">${esc(fmtShort(v.date))}<b>${esc(v.time || '—')}</b></span>
          <span class="ag-main"><b>${esc(l.code || '')} ${esc(l.name || '')}</b><span class="sub">${esc([x.building, x.city, v.broker].filter(Boolean).join(' · '))}</span></span>${pill(v.status, VSTAT_COLORS[v.status])}</button>`; }).join('') : '<div class="empty">No viewings this month.</div>'}</div>
      <div class="foot-note">${viewSrc() === 'monday' ? 'Viewings from the Monday Calendar board (Final Schedule). A result you record sets the viewing\'s Status on Monday; its reasons and broker feedback are kept in the portal.'
        : `Portal bookings (${srcName()}). The live portal also shows the Monday Final Schedule for dates before 12 Oct 2026.`}</div></div>
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
      <div class="panel"><h3>By city <span class="muted">${srcName()}</span></h3><div class="scroll-x"><table class="t"><thead><tr><th>City</th><th class="num">Listings</th><th class="num">For rent</th><th class="num">For sale</th><th class="num">Available</th></tr></thead><tbody>
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
      <div class="cols2">${table('By AI Status', AI_STAGES, (l) => l.ai)}${table('By source', DEMO ? LISTS.sources : [...new Set(vis.map((l) => l.source || 'Not set'))].sort(), (l) => l.source || 'Not set')}</div>
      ${isManager() ? (() => { const names = vaNames(); return table('By VA', names.concat(['']), (l) => names.find((n) => SH.sameVa(n, l.va)) || (SH.vaKey(l.va) ? l.va : '')); })() : ''}
      ${closedDealsHtml()}`;
  }
  // client names, codes, phones, emails and free-text notes never go in broker-group messages: numeric lead IDs only (daily-report.js)
  // Daily Report controls (Code.gs drDate / jr_notes): the report date, which sections go in, and the team's own lines.
  // The generated part stays numeric-ID only; the extra lines are added exactly as the team types them.
  const DR_SECTIONS = [['today', 'Viewings that day'], ['tomorrow', 'Viewings the next day'], ['new', 'New client requirements'], ['lois', 'LOIs & contracts']];
  const drDate = () => (S.dr && SH.isYmd(S.dr.date) && S.dr.date <= today() ? S.dr.date : today());
  const drNext = () => { const d = parseYmd(drDate()); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); };
  const dailyText = () => window.BH_DAILY.buildDaily({ leads: visibleLeads(), viewings: visibleViewings(), listings: D.listings,
    today: drDate(), tomorrow: drNext(), now: Math.min(Date.now(), (parseYmd(drDate()) || new Date()).getTime() + 864e5 - 1), demo: DEMO })
    .split('\n\n').filter((block, i) => i === 0 || !(S.dr && S.dr.off && S.dr.off[DR_SECTIONS[i - 1] && DR_SECTIONS[i - 1][0]])).join('\n\n')
    + ((S.dr && S.dr.notes && S.dr.notes.call) ? '\n\nCALL PLAN\n' + S.dr.notes.call.trim() : '') + ((S.dr && S.dr.notes && S.dr.notes.extra) ? '\n\nNOTES\n' + S.dr.notes.extra.trim() : '');
  async function loadDailyNotes() {
    S.dr = S.dr || {};
    if (S.dr.loaded) return;
    S.dr.loaded = true;
    if (DEMO) { S.dr.notes = D.dailyNotes || { call: '', extra: '' }; return; }
    S.dr.err = '';
    try { S.dr.notes = (await API.get('/api/daily/notes')).notes; } catch (e) { if (signedOut(e)) return; S.dr.notes = { call: '', extra: '' }; S.dr.err = e.message; }
    if (S.view === 'daily') renderView();
  }
  async function saveDailyNotes(patch) {
    S.dr.notes = { ...(S.dr.notes || {}), ...patch };
    if (DEMO) { D.dailyNotes = S.dr.notes; persist(); return; }
    try { await API.put('/api/daily/notes', patch); } catch (e) { if (!signedOut(e)) toast('Not saved: ' + e.message, true); }
  }
  function dailyView() {
    if (!S.dr || !S.dr.loaded) setTimeout(loadDailyNotes, 0);
    // while the saved notes failed to load they can't be edited or cleared (that would overwrite them with blanks)
    const err = S.dr && S.dr.err, edit = access('daily') === 'edit' && !err, n = (S.dr && S.dr.notes) || { call: '', extra: '' }, off = (S.dr && S.dr.off) || {};
    return `<div class="panel"><h3>Daily Report <span class="muted">for the broker group · numeric lead IDs only, no client names, numbers or notes</span><span class="spacer"></span><button class="btn sm" data-act="copydaily">Copy text</button></h3>
      ${err ? `<div class="src-err" role="alert">Your saved call plan and notes could not be loaded (${esc(err)}), so they are left out of the text and can't be edited. <button class="linkbtn" data-act="drretry">Try again</button></div>` : ''}
      <div class="pad toolbar"><label>Report date <input type="date" data-ch="drdate" value="${esc(drDate())}" max="${esc(today())}"></label>
        ${DR_SECTIONS.map(([k, lab]) => `<label class="tagck"><input type="checkbox" data-ch="drsec" data-k="${k}" ${off[k] ? '' : 'checked'}> ${esc(lab)}</label>`).join('')}
        <button type="button" class="btn sm" data-act="drclear">Clear</button></div>
      <div class="pad grid"><label>Call plan <span class="muted">(added under CALL PLAN)</span><textarea data-ch="drnote" data-k="call" rows="2" maxlength="2000" ${edit ? '' : 'disabled'}>${esc(n.call || '')}</textarea></label>
        <label>Anything else <span class="muted">(added under NOTES)</span><textarea data-ch="drnote" data-k="extra" rows="2" maxlength="4000" ${edit ? '' : 'disabled'}>${esc(n.extra || '')}</textarea></label></div>
      <div class="sub pad">Your own lines are added exactly as typed, so leave out client names and numbers.</div>
      <pre class="report" id="drText">${esc(dailyText())}</pre></div>
      <div class="sub">Posting to the broker group is not connected: copy the text and paste it there.</div>`;
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
    const body = S.setTab === 'wa' ? waView() : S.setTab === 'files' ? (DEMO ? laterBox('Files (LOI templates)', 'upload the Lease and Sale LOI templates, stored in Google Drive.') : driveStorageView() + loiTemplatesView())
      : S.setTab === 'integ' ? integView()
      : S.setTab === 'sync' ? laterBox('Monday Sync', 'AI STATUS write-back and client subitem sync to Monday.com are not part of the portal. ' + (mondayWritesOn() ? 'Only the confirmed updates listed under Integrations are written to Monday.' : 'Monday updates are switched off on this server.')) : teamView();
    return `<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button class="btn ${S.setTab === k ? 'on' : ''}" role="tab" aria-selected="${S.setTab === k}" data-act="settab" data-v="${k}">${esc(l)}</button>`).join('')}</div>${body}`;
  }
  const DRIVE_RESULT = {
    connected: 'Google Drive storage is connected.', switched: 'Google Drive storage now uses the new Google account. Files saved before stay in the previous account\'s Drive.',
    cancelled: 'Connecting Google Drive was cancelled.', expired: 'That Google Drive connection attempt expired or came from another browser. Try again.',
    forbidden: 'Only a Manager can connect Google Drive storage.', scope: 'Google Drive was not connected: the Drive permission was not ticked on Google\'s screen. Try again and allow "See, edit, create and delete only the specific Google Drive files you use with this app".',
    offline: 'Google did not give lasting access. Try again (the portal asks Google for it each time).', folders: 'Google Drive was connected but the portal couldn\'t make its folders there. Try again.',
    other_account: 'That is a different Google account from the connected one, so nothing changed. Choose the same account to reconnect, or use "Use another Google account…" to move storage on purpose.',
    api: 'The Google Drive API is not enabled in the Google Cloud project of the portal\'s OAuth client. Enable it, then try again.', google: 'Google Drive could not be connected. Try again.',
  };
  /** Settings → Files: where signed LOIs and deal files are saved (src/driveStore.js). */
  function driveStorageView() {
    const st = S.driveSt || (S.driveSt = { loading: true });
    if (st.loading && !st.started) { st.started = true; API.get('/api/drive/storage').then((r) => { S.driveSt = { s: r.storage }; }, (e) => { if (!signedOut(e)) S.driveSt = { err: e.message }; }).then(() => { if (S.view === 'team') renderView(); }); }
    const s = st.s || {}, note = S.driveNote ? `<div class="${/^(connected|switched)$/.test(S.driveNote) ? 'ok-box' : 'src-err'}" role="status">${esc(DRIVE_RESULT[S.driveNote] || DRIVE_RESULT.google)}</div>` : '';
    const yes = (b) => (b ? '<span class="tag ok">ready</span>' : '<span class="tag warn">not ready</span>');
    let inner;
    if (st.err) inner = `<div class="src-err" role="alert">${esc(st.err)} <button class="linkbtn" data-act="drivestretry">Try again</button></div>`;
    else if (st.loading) inner = '<div class="empty">Loading…</div>';
    else if (!s.mode) inner = `<div class="sub">Not set up on this server. Signed LOI copies and deal files need one of: <b>GOOGLE_DRIVE_OAUTH=on</b> (a Google account's My Drive, connected here by a Manager) or <b>GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON</b> with folder IDs (a Shared Drive).</div>`;
    else if (s.mode === 'service-account') inner = `<div>Shared Drive, as the service account <b>${esc(s.account)}</b>. Signed LOIs ${yes(s.folders.loi)} · Deal files ${yes(s.folders.deals)}</div><div class="sub">The folders are set on the server (GOOGLE_DRIVE_LOI_FOLDER_ID, GOOGLE_DRIVE_DEALS_FOLDER_ID) and must be in a Shared Drive where the service account is a Content manager.</div>`;
    else {
      inner = s.connected ? `<div>Saving to the My Drive of <b>${esc(s.email)}</b>, in <b>${esc(s.folderNames.root)}</b>. Signed LOIs ${yes(s.folders.loi && !s.problem)} · Deal files ${yes(s.folders.deals && !s.problem)}</div>
          <div class="sub">Connected by ${esc(s.connectedBy || '—')} ${esc(ago(s.connectedAt))}${s.lastOkAt ? ` · last used ${esc(ago(s.lastOkAt))}` : ''}. The portal sees only the folders and files it made there.</div>
          ${s.problem ? `<div class="src-err" role="alert">${esc(s.problem)}</div>` : ''}`
        : '<div class="sub">Not connected yet. A Manager connects the Google account whose My Drive keeps signed LOIs and deal files. The portal makes a <b>Blackhouse Portal</b> folder there and can see nothing else in that Drive.</div>';
      if (isManager()) inner += `<div style="margin-top:8px"><button class="btn sm primary" data-act="driveconnect">${s.connected ? 'Reconnect' : 'Connect Google Drive'}</button>${s.connected ? ' <button class="btn sm" data-act="driveswitch">Use another Google account…</button> <button class="btn sm danger" data-act="drivedisconnect">Disconnect</button>' : ''}</div>
        <div class="sub">${s.connected ? 'Reconnect with the same Google account: files saved by the portal can only be opened through the account that saved them. ' : ''}Uses ${esc(s.client)}.</div>`;
      if ((s.ignored || []).length) inner += `<div class="sub">Ignored with My Drive storage: ${s.ignored.map(esc).join(', ')}.</div>`;
    }
    return `<div class="panel"><h3>Google Drive storage <span class="muted">where signed LOIs and deal files are saved</span></h3><div class="pad">${note}${inner}</div></div>`;
  }
  /** Settings → Files: the team's LOI Word templates (Code.gs LOI_TPL_*), kept in the portal's database. */
  function loiTemplatesView() {
    const st = S.loiTpl || (S.loiTpl = { loading: true });
    if (st.loading && !st.started) { st.started = true; API.get('/api/loi/templates').then((r) => { S.loiTpl = { list: r.templates }; }, (e) => { if (!signedOut(e)) S.loiTpl = { err: e.message }; }).then(() => { if (S.view === 'team') renderView(); }); }
    const edit = canEdit('team'), byS = Object.fromEntries((st.list || []).map((t) => [t.slot, t]));
    return `<div class="panel"><h3>LOI templates <span class="muted">the team's own Word (.docx) LOIs; the portal fills a copy for each client</span></h3><div class="pad">
      ${st.err ? `<div class="src-err" role="alert">${esc(st.err)} <button class="linkbtn" data-act="loitplretry">Try again</button></div>` : st.loading ? '<div class="empty">Loading…</div>' : `<table class="t deal-t"><tbody>${Object.entries(SH.LOI_SLOTS).map(([s, lab]) => { const t = byS[s];
        return `<tr><th scope="row">${esc(lab)}</th><td>${t ? `${esc(t.name)} <span class="sub">· ${Math.round(t.size / 1024)} KB · ${esc(t.by || '')} · ${esc(manilaTime(t.at))}</span>` : '<span class="tag warn">not uploaded</span>'}</td>
          <td>${edit ? `<label class="btn sm">${t ? 'Replace' : 'Upload'}<input type="file" data-ch="loitpl" data-slot="${s}" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></label>${t ? ` <button class="btn sm danger" data-act="loitpldel" data-slot="${s}">Remove</button>` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table>`}
      <div class="sub">The template's blank lines (Date, To, Dear), its Annex A rows (Lessor / Seller, Lessee / Buyer, Property, Lease Term, Monthly Rental, Advance Rental, Security Deposit, Total Purchase Price, Terms of Payment, Other Concessions), the broker's commission % and the names under the signature lines are filled; everything else is kept as written. Older .doc files must be saved as .docx first.</div></div></div>`;
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
  // Team & Access modules only: screens without a module setting (KPI Review, Review acknowledgment) are left out
  const MOD_KEYS = VIEWS.map((v) => v[0]).filter((k) => !MOD_ALIAS[k] && SH.MODULES.includes(k));
  /** VA Assigned / Salesperson labels: from the Monday board when connected (mongo mode), else the preview's lists. */
  function loadTeamLabels() {
    if (DEMO || S.teamLabels || S.teamLabelsBusy) return;
    S.teamLabelsBusy = true;
    API.get('/api/team/labels').then((r) => { S.teamLabels = r; }, (e) => { if (!signedOut(e)) S.teamLabels = { source: 'error', error: e.message, va: [], salesperson: [] }; })
      .finally(() => { S.teamLabelsBusy = false; if (S.view === 'team' && (S.setTab || 'team') === 'team') renderView(); });
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // the fictional lists only in demo mode or when the server has no Monday board (it then offers them itself)
  const vaChoices = () => [...new Set((DEMO || (S.teamLabels && S.teamLabels.source === 'preview') ? LISTS.vas : S.teamLabels && S.teamLabels.source === 'monday' ? S.teamLabels.va || [] : [])
    // plus the labels on the portal's own (MongoDB) leads, which the server accepts too
    .concat(!DEMO && viewSrc() === 'mongo' ? uniqueVals('va').filter(Boolean) : []))];
  // a Broker's exact Monday Salesperson label (Leads and Calendar boards); the preview's fictional list when not connected
  const salesChoices = () => (DEMO ? LISTS.brokers : S.teamLabels && S.teamLabels.source !== 'error' ? S.teamLabels.salesperson || [] : []);
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
    const u = (orig && D.users.find((x) => x.email === orig)) || {};
    const { value, errors } = SH.validateUser(input, { vaLabels: vaChoices().concat(u.vaLabel ? [u.vaLabel] : []), salesLabels: salesChoices() });
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
    // fields this member may update but whose Monday column isn't usable: say why, instead of hiding them silently
    const blocked = !DEMO && S.source === 'monday' && S.mw && S.mw.enabled ? MW_LEAD.map(([k]) => S.mw.actions[k]).filter((a) => a && !a.allowed && a.error) : [];
    const why = blocked.length ? `<div class="sub" role="note">${blocked.map((a) => `${esc(a.label)} can't be updated here: ${esc(a.error)}`).join('<br>')}</div>` : '';
    if (!rows.length) return why ? `<div class="section-title">Update on Monday</div>${why}` : '';
    const input = (k, a, v) => a.kind === 'status' ? `<select data-mwin="${k}" aria-label="${esc(a.label)}">${v && !a.labels.includes(v) ? `<option value="" selected>${esc(v)} (current)</option>` : !v ? '<option value="" selected>(not set)</option>' : ''}${a.labels.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
      : `<input data-mwin="${k}" aria-label="${esc(a.label)}" ${a.kind === 'number' ? 'type="number" min="1" step="any" inputmode="numeric"' : a.kind === 'date' ? 'type="date"' : 'type="text" maxlength="60"'} value="${esc(v)}">`;
    return `<div class="section-title">Update on Monday <span class="muted" style="text-transform:none;font-weight:400">· saved straight to the Direct Clients board, one field at a time, after you confirm</span></div>
      <div class="mwbox">${rows.map(([k, a, v]) => `<label class="mwrow"><span>${esc(a.label)}</span>${input(k, a, v)}<button type="button" class="btn sm" data-act="mwsave" data-k="${k}">Save to Monday</button></label>`).join('')}</div>${why}`;
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
      // changed on Monday meanwhile: the page now shows Monday's current value (the server sent it)
      if (e.stale) { S.modalReturn = null; closeModal(); if (e.data && e.data.record) m.onDone({ record: e.data.record, unchanged: true }); return toast('Monday was not updated: ' + e.message, true); }
      if (e.data && e.data.uncertain) { S.modalReturn = null; closeModal(); return toast(e.message, true); }
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
      else if (value.status) { if (value.status === 'asking') Object.assign(a, { answeredAt: null, sentAt: null, interestedAt: null }); else if (a.status !== value.status) a.answeredAt = nowIso(); a.status = value.status; }
      else if (a.status !== 'available') throw new Error('The owner hasn\'t confirmed this unit is available yet.');
      else if ('sent' in value) Object.assign(a, value.sent ? { sentAt: nowIso(), sentBy: me().name } : { sentAt: null });
      else Object.assign(a, value.interested ? { interestedAt: nowIso(), interestedBy: me().name } : { interestedAt: null });
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
  /** The Leads filters (and Project Pages state) belong to one sign-in: the next person in this tab starts with none. */
  function resetLeadFilters() { Object.assign(S, { q: '', va: '', ai: [], temp: [], wait: '', type: '', from: '', list: null, pp: null, up: null }); }
  function signedOut(e) {
    if (DEMO || !e || e.status !== 401) return false;
    S.user = null; D = EMPTY(); S.open = null; S.draft = {}; S.pend = null; S.deals = null; S.rnLog = null; S.plCells = null; S.dr = null; S.kr = null; S.loi = null; S.loiTpl = null; S.teamLabels = null; S.integ = null; S.mTest = null; S.vaAsk = null; S.sv = null; S.dealf = null; S.vapVa = '';
    resetLeadFilters();
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
    // KPI Review rights for this member (decided by the server); the screen is hidden if they can't be read
    // kept only for the same member (a Refresh keeps an unsaved review); anything loaded for another sign-in is dropped
    const keep = S.kr && S.kr.uid === b.user.id ? S.kr : {};
    S.kr = null;
    try { S.kr = { ...keep, uid: b.user.id, me: await API.get('/api/kpi-review/me') }; } catch (e) { if (e.status === 401) throw e; S.kr = { uid: b.user.id, me: null }; }
    if (S.kr.me && S.kr.me.signInAgain) setTimeout(() => toast('To open KPI Review, sign out and sign in again with your Google account.', true), 600);
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
    // the server reads Monday.com only for members with Leads access: without it there is nothing to load (no 403 error)
    if (!mondayAllowed()) { S.srcBusy = false; S.srcNoAccess = true; render(); return false; }
    S.srcNoAccess = false;
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
    if (!mondayAllowed()) return false;
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
    // returning from "Connect Google Drive" (Settings → Files)
    const drv = (location.hash.match(/^#drive=([a-z_]+)$/) || [])[1];
    if (drv) { S.driveNote = drv; S.setTab = 'files'; }
    if (err || drv || location.hash === '#') history.replaceState(null, '', location.pathname + location.search);
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
    // For Client Approval / For Scheduling (Code.gs apiMarkSent / apiMarkAvailable / apiSetCheck 'reset')
    apprsent: (el) => { const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.id); if (a) askDo(l, () => backend.askPatch(a, { sent: el.dataset.v === '1' }), el.dataset.v === '1' ? 'Marked as sent to the client. Nothing was sent by the portal.' : 'Updated.').then(() => renderDrawerBody()); },
    apprsched: (el) => { const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.id); if (a) askDo(l, () => backend.askPatch(a, { interested: true }), 'Moved to For Scheduling.').then(() => renderDrawerBody()); },
    // Index.html "For Scheduling (n)": the selected units that were sent to the client
    apprschedsel: async () => {
      const l = leadById(S.open); if (!l) return; const sel = S.apprSel || new Set();
      const list = (askState(l).list || []).filter((a) => sel.has(a.id) && a.status === 'available' && a.sentAt && !a.interestedAt);
      for (const a of list) { try { await backend.askPatch(a, { interested: true }); } catch (e) { if (!signedOut(e)) toast(e.message, true); break; } }
      list.forEach((a) => sel.delete(a.id)); toast(`${list.length} moved to For Scheduling.`); renderDrawerBody();
    },
    apprunsched: (el) => { const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.id); if (a) askDo(l, () => backend.askPatch(a, { interested: false }), 'Moved back to For Client Approval.').then(() => renderDrawerBody()); },
    apprback: (el) => {
      const l = leadById(S.open), a = l && (askState(l).list || []).find((x) => x.id === el.dataset.id); if (!a) return;
      if (!confirm('Move this unit back to Asking for Availability? The owner\'s answer is cleared.')) return;
      askDo(l, () => backend.askPatch(a, { status: 'asking' }), 'Moved back to Asking for Availability.').then(() => renderDrawerBody());
    },
    apprcopy: (el) => {
      const l = leadById(S.open); if (!l) return;
      const list = (askState(l).list || []).filter((a) => a.status === 'available' && !a.interestedAt && (el.dataset.v === 'sel' ? (S.apprSel || new Set()).has(a.id) : !a.sentAt));
      if (!list.length) return toast(el.dataset.v === 'sel' ? 'Select the units first.' : 'Every unit has been sent.', true);
      const units = list.map((a) => { const x = listingById(a.listingId) || {}; return { ...x, name: a.listingName || x.building }; });
      const text = SH.approvalText(units);
      try { navigator.clipboard.writeText(text); toast(`Message for ${list.length} unit${list.length > 1 ? 's' : ''} copied. Send it to the client, then "Mark as sent".`); } catch (e) { toast('Copy failed; select the text and copy it.', true); }
    },
    qdate: (el) => { $('#bDate').value = el.dataset.v; $$('.qd .btn').forEach((b) => b.classList.toggle('on', b === el)); },
    vstatus: (el) => setViewing(el.dataset.id, el.dataset.v),
    viewing: (el) => viewingModal(el.dataset.id),
    // Pending Broker Feedback: open the client, or record the result (the same dialog and save as the viewing details)
    pfbopen: (el) => openLead(el.dataset.id),
    pfbres: (el) => viewingModal(el.dataset.id, el.dataset.v),
    vconfirm: () => saveViewing(true),
    vback: () => { $('#vConfirm').innerHTML = ''; const s = $('#vSave'); if (s) { s.hidden = false; s.focus(); } },
    mclose: closeModal,
    // Service Requests
    svreload: () => { const st = sv(); st.data = null; st.err = ''; svLoad(); renderView(); },
    svscan: () => svScan(false),
    svtab: (el) => { sv().tab = el.dataset.v; renderView(); },
    svshow: (el) => { sv().show = el.dataset.v; renderView(); },
    svsend: (el) => svSendModal(el.dataset.id),
    svcopy: () => { const t = $('#svTxt'); try { navigator.clipboard.writeText(t.value); toast('Copied'); } catch (e) { t.select(); toast('Select and copy the text', true); } },
    svmark: async (el) => {
      try { const r = await API.post(`/api/services/${el.dataset.id}/mark-sent`, { supplierId: el.dataset.sp }); closeModal(); svRefreshRow(r.row); toast('Marked as sent to ' + r.row.supplier); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    // the supplier's own app opens with the text (nothing is sent by the portal); then it is marked as sent
    svopen: (el) => {
      const t = $('#svTxt').value, r = sv().data.rows.find((x) => x.id === el.dataset.id), links = SH.contactLinks('+' + el.dataset.num);
      if (el.dataset.kind !== 'email' && !links) return toast('This supplier\'s number doesn\'t look valid. Check it in Suppliers.', true);
      const href = el.dataset.kind === 'whatsapp' ? links.whatsapp + '?text=' + encodeURIComponent(t)
        : el.dataset.kind === 'email' ? 'mailto:' + el.dataset.to + '?subject=' + encodeURIComponent('Blackhouse request ' + (r ? r.ref : '')) + '&body=' + encodeURIComponent(t) : links.viber;
      if (el.dataset.kind === 'viber') { try { navigator.clipboard.writeText(t); toast('Text copied — paste it in Viber'); } catch (e) { /* ignore */ } }
      window.open(href, '_blank', 'noopener');
      setTimeout(() => ACT.svmark(el), 300);
    },
    svrio: async (el) => {
      if (!$('#svOk') || !$('#svOk').checked) return toast('Tick the box to confirm you checked the text.', true);
      const body = { supplierId: el.dataset.sp, text: $('#svTxt').value, confirm: true };
      const send = async () => { const r = await API.post(`/api/services/${el.dataset.id}/send`, body); closeModal(); svRefreshRow(r.row); toast('Sent to ' + r.row.supplier); };
      try { await send(); }
      catch (e) {
        // already sent to this supplier before: only again when the member says so
        if (e.already && confirm(e.message + '\n\nSend it again anyway?')) { body.resend = true; try { await send(); } catch (e2) { if (!signedOut(e2)) toast(e2.message, true); } return; }
        if (!signedOut(e)) toast(e.message, true);
      }
    },
    svsup: () => svSuppliersModal(),
    supadd: () => { const L = S.modal.supList; L.push({ svc: sv().tab !== 'all' ? sv().tab : 'movers', name: '', channel: 'whatsapp', contact: '', respondId: '', notes: '' }); svSuppliersModal(); },
    supdel: (el) => { S.modal.supList.splice(Number(el.dataset.v), 1); svSuppliersModal(); },
    supsave: async () => {
      const { errors } = SH.validateSuppliers(S.modal.supList); if (errors.length) return toast(errors[0], true);
      try { const r = await API.put('/api/services/suppliers', { suppliers: S.modal.supList }); sv().data.suppliers = r.suppliers; closeModal(); renderView(); toast('Suppliers saved'); }
      catch (e) { if (!signedOut(e)) toast(e.message, true); }
    },
    calmove: (el) => { const d = +el.dataset.v, m = S.calMonth; S.calMonth = d === 0 ? null : new Date(m.getFullYear(), m.getMonth() + d, 1); renderView(); },
    invmore: () => { S.inv.limit = (S.inv.limit || 120) + 120; renderInventory(); },
    invcity: (el) => { S.inv.city = el.dataset.v; S.inv.limit = 120; renderView(); const g = $('#invGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); },
    filterva: (el) => { if (!isManager()) return; S.view = 'leads'; S.va = el.dataset.v; S.wait = ''; savePrefs(); render(); },
    // KPI Review (Toby and Jonjo) and the VA's own Review acknowledgment
    krmode: (el) => { kr().mode = el.dataset.v; renderView(); },
    krsave: () => krSave(),
    krdiscussed: () => krDiscussed(),
    krsnap: () => krSnapshot(),
    krreload: () => { const st = kr(); if (st.empsErr || !st.emps) { st.emps = null; st.empsErr = ''; } else st.revTag = ''; renderView(); },
    krsnapreload: () => { kr().snapTag = ''; renderView(); },
    krack: (el) => krAck(el.dataset.p),
    krackreload: () => { const st = kr(); st.acks = null; st.acksErr = ''; renderView(); },
    // Renewals (Monday Calendar leases): segment tiles, Message (compose / copy / "I sent it" log; nothing is sent)
    rnseg: (el) => { S.rnSeg = el.dataset.v; renderView(); },
    rnmsg: (el) => rnMsgModal(el.dataset.id),
    rntpl: (el) => { const m = S.modal; if (m && m.kind === 'rnmsg') rnMsgModal(m.leadId, el.dataset.v); },
    rncopy: async () => { try { await copyText($('#rnText').value); toast('Copied. Paste it in respond.io; nothing was sent from the portal.'); } catch (e) { toast('Copy was blocked by the browser.', true); } },
    rnsent: () => rnSent(),
    // Daily Report: back to today, every section, no extra lines
    drclear: async () => {
      const n = (S.dr && S.dr.notes) || {}, wipe = access('daily') === 'edit' && !(S.dr && S.dr.err) && !!(String(n.call || '').trim() || String(n.extra || '').trim());
      if (wipe && !confirm('Clear the date and sections, and delete your saved call plan and notes?')) return;
      S.dr = { ...(S.dr || {}), date: '', off: {} }; if (wipe) await saveDailyNotes({ call: '', extra: '' }); renderView(); toast('Daily Report cleared.');
    },
    drretry: () => { S.dr = { ...(S.dr || {}), loaded: false, err: '' }; renderView(); },
    plretry: () => { S.plCells = null; renderView(); },
    rnlogretry: () => { S.rnLog = null; renderView(); },
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
      prefs.source = v; S.source = v; S.pend = null; S.deals = null; S.rnLog = null; S.vaAsk = null; S.loi = null; S.calBroker = ''; S.sv = null; S.dealf = null; savePrefs();
      if (v === 'monday') { await openMondaySource(false); toast(S.srcNoAccess ? 'No Monday.com data for your account: it needs Leads access.' : mondayWritesOn() ? 'Showing live Monday.com data.' : 'Showing live Monday.com data (read-only).'); return; }
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
      S.user = null; D = EMPTY(); S.open = null; S.draft = {}; S.pend = null; S.deals = null; S.rnLog = null; S.plCells = null; S.dr = null; S.source = SH.defaultSource(prefs.source); S.mongoRecords = null; S.srcFetchedAt = ''; S.srcErrors = {}; S.srcBoards = {}; S.srcLive = null; S.watch = (S.watch || 0) + 1;
      S.integ = null; S.chat = {}; S.teamLabels = null; S.srcToken++; S.rsInfo = null; S.mw = null; S.pend = null; S.deals = null; S.rnLog = null; S.plCells = null; S.dr = null; S.kr = null; S.loi = null; S.loiTpl = null; S.teamLabels = null; S.integ = null; S.mTest = null; S.vaAsk = null; S.sv = null; S.dealf = null; S.vapVa = '';
      resetLeadFilters();
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
    // "Message Lead" / "Call on respond.io": open this lead's own conversation in respond.io (the server checks the lead is
    // visible to this member and gives the address). Nothing is sent and no call is started by the portal.
    rioopen: async (el) => {
      const id = el.dataset.id, kind = el.dataset.v;
      const w = window.open('', '_blank');   // opened in the click itself, so the browser doesn't block it
      let r;
      try { r = await API.get(`/api/respond/link/${loiSrc()}/${encodeURIComponent(id)}`); }
      catch (e) { if (w) w.close(); if (signedOut(e)) return; return rioProblem(kind, e.message, e.data && e.data.tel); }
      if (S.open !== id) { if (w) w.close(); return; }   // another lead was opened meanwhile: never this one's link
      if (w) { w.opener = null; w.location.href = r.url; } else return rioProblem(kind, 'Your browser blocked the new tab. Allow pop-ups for the portal, or use this link:', r.tel, r.url);
      toast(kind === 'call' ? 'Opened ' + (r.name || 'the lead') + ' in respond.io. Press the phone icon in the conversation to call (the client must allow calls); the portal hasn\'t started a call.' : 'Opened ' + (r.name || 'the lead') + '\'s conversation in respond.io. Nothing was sent.');
    },
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
    svstage: async (el) => {
      const d = sv().data, r = d.rows.find((x) => x.id === el.dataset.id); if (!r) return;
      try { const x = await API.patch('/api/services/' + r.id, { stage: el.value, version: r.version }); svRefreshRow(x.row); toast('Stage updated'); }
      catch (e) { if (!signedOut(e)) { toast(e.message, true); renderView(); } }
    },
    svsp: (el) => svSendModal(el.dataset.id, el.value),
    upesp: (el) => { up().esp = el.value; },
    apprall: (el) => { const l = leadById(S.open); const s = S.apprSel = S.apprSel || new Set(); ((l && askState(l).list) || []).filter((a) => a.status === 'available' && !a.interestedAt).forEach((a) => (el.checked ? s.add(a.id) : s.delete(a.id))); renderDrawerBody(); },
    vapva: (el) => { S.vapVa = el.value; renderView(); },
    apprsel: (el) => { const s = S.apprSel = S.apprSel || new Set(); if (el.checked) s.add(el.dataset.id); else s.delete(el.dataset.id); renderDrawerBody(); },
    dfup: async (el) => {
      const file = el.files && el.files[0], l = leadById(S.open), u = l && unitFor(l); if (!file || !u) return;
      if (file.size > SH.DEAL_FILE_MAX) { el.value = ''; return toast('Files can be 15 MB at most.', true); }
      const slot = el.dataset.slot, s = $('#dfStart-' + slot), m = $('#dfMonths-' + slot);
      let q = '';
      if (s && (s.value || slot === 'renewal')) { const t = SH.dealTerm(s.value, m.value); if (t.errors.length) { el.value = ''; return toast(t.errors[0], true); } q = `?start=${s.value}&months=${m.value}`; }
      try { await API.upload(`/api/deals/${loiSrc()}/${encodeURIComponent(l.id)}/${encodeURIComponent(u.key)}/${slot}${q}`, file); S.dealf = null; renderDrawerBody(); toast('Saved to Google Drive.'); }
      catch (e) { if (!signedOut(e)) toast('Not saved: ' + e.message, true); }
      el.value = '';
    },
    loitpl: async (el) => {
      const file = el.files && el.files[0]; if (!file) return;
      try { await API.upload('/api/loi/templates/' + el.dataset.slot, file); toast('Template saved.'); } catch (e) { if (!signedOut(e)) toast('Not saved: ' + e.message, true); }
      S.loiTpl = null; S.loi = null; renderView();
    },
    loislot: (el) => { const l = leadById(S.open), st = l && loiState(l); if (st && st.form) { st.form.slot = el.value; st.form.touched = true; renderDrawerBody(); } },
    rng: (el) => { S.rng = { ...(S.rng || {}), [el.dataset.k]: el.value }; renderView(); },
    rnseg: (el) => { S.rnSeg = el.value; renderView(); },
    rnva: (el) => { S.rnVa = el.value; renderView(); },
    kremp: (el) => { const st = kr(); if (Object.keys(st.draft || {}).length && !confirm('Discard your unsaved review?')) { el.value = st.sel; return; } st.sel = el.value; st.draft = {}; renderView(); },
    krperiod: (el) => { const st = kr(); if (Object.keys(st.draft || {}).length && !confirm('Discard your unsaved review?')) { el.value = krPeriod(); return; } st.period = el.value; st.draft = {}; renderView(); },
    krackck: (el) => { const st = kr(); st.ackCk = { ...(st.ackCk || {}), [el.dataset.p]: el.checked }; },
    plcell: async (el) => {
      const { value, errors } = SH.validatePlCell({ line: el.dataset.line, month: el.dataset.m, value: el.value.trim() });
      if (errors.length) return toast(errors[0], true);
      try { await API.put('/api/pl/cells', value); } catch (e) { if (!signedOut(e)) toast('Not saved: ' + e.message, true); return; }
      const c = S.plCells.cells; c[value.line] = c[value.line] || {}; if (value.value === null) delete c[value.line][value.month]; else c[value.line][value.month] = value.value;
      renderView(); toast('Saved in the portal.');
    },
    drdate: (el) => { S.dr = { ...(S.dr || {}), date: el.value }; renderView(); },
    drsec: (el) => { S.dr = { ...(S.dr || {}), off: { ...((S.dr || {}).off || {}), [el.dataset.k]: !el.checked } }; renderView(); },
    drnote: async (el) => { if (access('daily') !== 'edit') return; await saveDailyNotes({ [el.dataset.k]: el.value }); renderView(); },
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
  Object.assign(ACT, ACT_PP); Object.assign(CH, CH_PP);
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
    if (el.dataset && (el.dataset.pp || el.dataset.ppu != null || el.dataset.ppm)) return ppField(el);
    if (el.dataset && el.dataset.up) return upField(el);
    if (el.dataset && el.dataset.upst != null && up().draft && upEdit()) { const s = up().draft.audience.statuses, v = el.dataset.upst; if (el.checked) { if (!s.includes(v)) s.push(v); } else s.splice(s.indexOf(v), 1); up().dirty = true; return renderView(); }
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
    else if (el.dataset.in === 'rnq') {   // Renewals search: redraw, then give the search box its focus and caret back
      clearTimeout(searchT); searchT = setTimeout(() => { S.rnQ = el.value; renderView(); const i = $('[data-in="rnq"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
    }
    else if (el.dataset.in === 'ppq') { clearTimeout(searchT); searchT = setTimeout(() => { pp().q = el.value; renderView(); const i = $('[data-in="ppq"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); }
    else if (el.dataset.pp || el.dataset.ppu != null || el.dataset.ppm) ppField(el);
    else if (el.dataset.up && el.tagName !== 'SELECT') upField(el);
    else if (el.dataset.in === 'krtext') { const st = kr(); st.draft = { ...(st.draft || {}), [el.dataset.k]: el.value }; }
    else if (el.dataset.sup) { const [i, k] = el.dataset.sup.split('|'); if (S.modal && S.modal.supList && S.modal.supList[i]) S.modal.supList[i][k] = el.value; }
    else if (el.dataset.in === 'loif') {
      // typing only updates the form (no redraw, so focus stays); "Still empty" is checked again when the LOI is made
      const l = leadById(S.open), st = l && loiState(l); if (st && st.form) { st.form.fields[el.dataset.k] = el.value; st.form.touched = true; }
    }
    else if (el.dataset.in === 'kraction') {
      // the action rows as on screen (saved rows plus blank lines); blank rows are dropped when saved
      const st = kr(), rv = st.rev, mine = rv && rv.reviews[rv.can.slot];
      const rows = ((st.draft && st.draft.actions) || (mine && mine.actions) || []).map((a) => ({ ...a }));
      const i = Number(el.dataset.i); while (rows.length <= i) rows.push({ text: '', date: '' });
      rows[i][el.dataset.f] = el.value; st.draft = { ...(st.draft || {}), actions: rows };
    }
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
      else if (f.dataset.submit === 'ppnew') ppCreate();
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
