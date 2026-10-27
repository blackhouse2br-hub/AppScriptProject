/*
 * Client Requirements: a copy-ready daily message listing what each active Property Sourcing client is looking for.
 * Built from lead records already loaded in the app. Read-only: takes leads in, returns text. No storage, no network.
 * Eligibility is the app's existing rule (prop-report.js sourcingLeads), so both reports always agree on who qualifies.
 * Shared by the browser (window.BH_CLIENTREQ) and the tests (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./prop-report'), require('./shared'));
  else root.BH_CLIENTREQ = factory(root.BH_PROPREPORT, root.BH_SHARED);
})(typeof self !== 'undefined' ? self : this, function (PR, SH) {
  'use strict';

  const NA = 'Not specified';
  // the business day is Manila time (as the pipeline's dates and the original portal), whatever the device's clock zone
  const TZ = 'Asia/Manila';

  /** Today's date in Manila as YYYY-MM-DD. */
  function businessYmd(now) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now == null ? Date.now() : now)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  /** One line of text: inner line breaks and repeated spaces collapsed, so a value can't break the message layout. */
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const val = (v) => clean(v) || NA;
  const kind = (l) => (l.inquiry === 'Buy' ? 'SALE' : l.inquiry === 'Rent' ? 'RENT' : '');
  const pesos = (n) => '₱' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  /** The client's budget as stored (a number); monthly for rentals. 0 / missing = not given. */
  function budget(l) {
    const n = Number(l.budget);
    return n > 0 ? pesos(n) + (kind(l) === 'RENT' ? '/month' : '') : NA;
  }
  // shared wording (shared.js petWords): only a clear answer is reported; Not Applicable / blank / unknown → "Not specified"
  const pets = (p) => SH.petWords(p);

  /**
   * One client block. Labels are "Client N" only: no names, phone numbers, emails or lead IDs.
   * Building Name only when one was given; furnishing and pets only for rentals.
   */
  function block(l, i) {
    const k = kind(l), building = clean(l.building);
    const lines = [`${i + 1}. Client ${i + 1}`, k || 'RENT/SALE: ' + NA];
    if (building) lines.push(`Building Name: ${building}`);
    // Location is the structured City only, never the free-text "Client Requirements" text (it can hold personal details)
    lines.push(`Location: ${val(l.city)}`, `SQM: ${val(l.sqm)}`, `Bedroom: ${val(l.bedrooms)}`,
      `Bathroom: ${val(l.bathrooms)}`, `Parking: ${val(l.parking)}`);
    if (k === 'RENT') lines.push(`Furnished/Unfurnished: ${val(l.furnishing)}`, `Pet Friendly/Not Pet Friendly: ${pets(l.pets)}`);
    lines.push(`Budget: ${budget(l)}`);
    return lines.join('\n');
  }

  /** The leads that qualify, in message order (rentals, then sales, oldest inquiry first): prop-report.js rules. */
  const clients = (leads) => PR.sourcingLeads(leads);

  /** The message for the given business day (YYYY-MM-DD; default today in Manila). */
  function buildMessage(leads, ymd) {
    const list = clients(leads);
    const head = `Client Requirements for ${PR.dateLabel(ymd || businessYmd())}`;
    return [head, '', list.length ? list.map(block).join('\n\n') : 'No active Property Sourcing clients today.'].join('\n');
  }

  return { NA, TZ, businessYmd, clients, buildMessage };
});
