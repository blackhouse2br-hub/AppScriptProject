/*
 * Property Requirements report: plain text for the broker channel, built from lead records already loaded in the app.
 * Read-only: takes leads in, returns text. No storage, no network, nothing written anywhere.
 * Shared by the browser (window.BH_PROPREPORT) and the tests (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shared'));
  else root.BH_PROPREPORT = factory(root.BH_SHARED);
})(typeof self !== 'undefined' ? self : this, function (SH) {
  'use strict';

  const NA = 'Not specified';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Client Status / Next Action text that means the lead is no longer active (Mongo: 'Closed', 'Failed'; Monday: free labels).
  // "Unresponsive" counts as inactive here too, as it does everywhere else in the app (pipeline failedHand, VA Portal, reports).
  const INACTIVE_STATUS = /\b(fail(ed)?|lost|dead|closed|disqualified|cancell?ed|not interested|junk|unresponsive)\b/i;
  // Temperature values that mean the conversation went quiet (pipeline.temperature: 3+ / 7+ days without a reply)
  const INACTIVE_TEMPS = ['Lost', 'Dead'];

  /**
   * A lead is in property sourcing when its stage is Property Matching (the app's stage rule: Calendar proof, then
   * Monday AI STATUS, then the Next Action / Status text), and nothing marks it inactive: no Lost/Dead temperature and
   * no closed/failed Client Status. The stage is workStage when present, so a lead with no respond.io chat (AI Status
   * "Not on Respond.io") still qualifies on its Monday evidence; otherwise it is the AI Status.
   */
  const stageOf = (l) => l.workStage || l.ai;
  function isSourcingLead(l) {
    return !!l && stageOf(l) === 'Property Matching' && !INACTIVE_TEMPS.includes(l.temp) && !INACTIVE_STATUS.test(String(l.status || ''));
  }
  const kind = (l) => (l.inquiry === 'Buy' ? 'SALE' : l.inquiry === 'Rent' ? 'RENT' : '');
  const RANK = { RENT: 0, SALE: 1, '': 2 };
  /** Qualifying leads: rentals, then sales, then unknown type; oldest inquiry first within each. */
  function sourcingLeads(leads) {
    return (leads || []).filter(isSourcingLead)
      .sort((a, b) => RANK[kind(a)] - RANK[kind(b)] || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.code || '').localeCompare(String(b.code || '')));
  }

  /** One line of text: inner line breaks and repeated spaces collapsed, so a value can't break the report layout. */
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const val = (v) => clean(v) || NA;
  const pesos = (n) => '₱' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function price(l) {
    const n = Number(l.budget);
    return n > 0 ? pesos(n) + (l.inquiry === 'Rent' ? '/month' : '') : NA;
  }
  // shared wording (shared.js petWords): Pet Friendly / Not Pet Friendly for a clear answer, otherwise "Not specified"
  const pets = (p) => SH.petWords(p);
  /** "2026-10-26" → "October 26, 2026" (no locale or time zone involved). */
  function dateLabel(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : NA;
  }

  function block(l, i) {
    const k = kind(l);
    const lines = [`${i + 1}. ${k || 'RENT/SALE: ' + NA}`,
      `Price: ${price(l)}`,
      // the structured City only: the free-text "Client Requirements" text (lead.location) can hold personal details
      `Location: ${val(l.city)}`,
      `Specific Building: ${val(l.building)}`,
      `SQM: ${val(l.sqm)}`,
      `Bedroom: ${val(l.bedrooms)}`,
      `Bathroom: ${val(l.bathrooms)}`,
      `Parking: ${val(l.parking)}`];
    if (k === 'RENT') lines.push(`Furnished/Unfurnished: ${val(l.furnishing)}`, `Pet Friendly/Not Pet Friendly: ${pets(l.pets)}`);
    return lines.join('\n');
  }

  /**
   * The full report for the given day (YYYY-MM-DD). The date is the heading only; leads are the current records.
   * Broker channel rule (same as the Daily Report): no client names, phone numbers, emails or lead IDs.
   */
  function buildReport(leads, ymd) {
    const list = sourcingLeads(leads);
    const head = `Property Requirements for today ${dateLabel(ymd)}`;
    return [head, '', list.length ? list.map(block).join('\n\n') : 'No active property-sourcing requirements.'].join('\n');
  }

  return { NA, isSourcingLead, sourcingLeads, buildReport, dateLabel };
});
