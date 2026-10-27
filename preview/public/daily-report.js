/*
 * Daily Report for the broker group: plain text built from records already loaded in the app.
 * Broker channel rule: clients appear only as a numeric lead ID. Never a name (Monday's item name is the client's
 * "Full Name"), lead code, phone, email or free-text field typed by staff (it can hold names or numbers).
 * Read-only: takes records in, returns text. No storage, no network. Browser: window.BH_DAILY; tests: require.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BH_DAILY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** The numeric lead ID: the Monday item ID (Monday leads), a stored numeric Monday ID (MongoDB), or the demo ID. '' when none. */
  const leadNumber = (l) => [l && l.mondayItemId, l && l.id].map((v) => String(v == null ? '' : v).trim()).find((v) => /^\d{1,20}$/.test(v)) || '';
  const ref = (l) => 'Lead #' + (leadNumber(l) || '—');
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** "2026-10-27" → "Tue, Oct 27" (the date as written; no time zone involved). */
  function dayLabel(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return `${DOW[d.getUTCDay()]}, ${MON[+m[2] - 1]} ${+m[3]}`;
  }
  /** Same short money format as the screens: ₱150k, ₱25M. */
  const money = (n) => (!n ? '' : '₱' + (n >= 1e6 ? (+(n / 1e6).toFixed(1)) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : n));

  /**
   * opts: { leads, viewings, listings, today: 'YYYY-MM-DD', tomorrow: 'YYYY-MM-DD', now: ms, demo }
   * leads / viewings are what the signed-in user may see (the caller passes visibleLeads() / visibleViewings()).
   */
  function buildDaily(opts) {
    const leads = opts.leads || [], viewings = opts.viewings || [], listings = opts.listings || [], now = opts.now == null ? Date.now() : opts.now;
    const lead = (id) => leads.find((l) => l.id === id) || {};
    const unit = (v) => listings.find((x) => x.id === v.listingId) || { building: v.building, city: v.city };
    const vv = viewings.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const on = (d) => vv.filter((v) => v.date === d && v.status !== 'Cancelled');
    const line = (v) => { const x = unit(v); return `• ${v.time || '--:--'} · ${clean(x.building) || '?'} (${clean(x.city)}) · ${ref(lead(v.leadId))} · broker ${clean(v.broker) || '?'} · ${v.status}`; };
    const newLeads = leads.filter((l) => now - new Date(l.createdAt) < 3 * 864e5);
    const lois = leads.filter((l) => ['LOI', 'Contract'].includes(l.ai));
    const beds = (b) => (!clean(b) ? 'BR n/a' : b === 'Studio' ? 'Studio' : clean(b) + ' BR');
    return [`BLACKHOUSE DAILY REPORT · ${dayLabel(opts.today)}${opts.demo ? ' (DEMO DATA)' : ''}`, '',
      `VIEWINGS TODAY (${on(opts.today).length})`, ...on(opts.today).map(line), '',
      `VIEWINGS TOMORROW (${on(opts.tomorrow).length})`, ...on(opts.tomorrow).map(line), '',
      // structured fields only: the free-text requirements notes are left out (they can contain names or numbers)
      `NEW CLIENT REQUIREMENTS (${newLeads.length})`, ...newLeads.map((l) => `• ${ref(l)} · ${clean(l.inquiry) || 'type n/a'} · ${clean(l.city) || 'city n/a'} · ${beds(l.bedrooms)} · ${money(l.budget) || 'budget n/a'}`), '',
      `LOIs & CONTRACTS IN PROGRESS (${lois.length})`, ...lois.map((l) => `• ${ref(l)} · ${l.ai}${l.daysInStage != null ? ' · ' + l.daysInStage + ' days in stage' : ''}`)].join('\n');
  }

  return { buildDaily, leadNumber, dayLabel };
});
