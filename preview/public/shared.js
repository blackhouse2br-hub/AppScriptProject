/*
 * Business rules shared by the browser (demo mode) and the server (MongoDB mode):
 * picklists, module access, input validation and the side effects of saving a lead or booking a viewing.
 * The server always re-validates; the browser copy only gives fast feedback.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BH_SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LISTS = {
    vas: ['Ana', 'Bea', 'Carlo', 'Dina'],
    brokers: ['Ely Santos', 'Fritz Lim', 'Gia Cruz'],
    sources: ['Respond IO', 'Website', 'Facebook', 'Referral', 'Walk-in'],
    clientStatuses: ['New Inquiry', 'Qualified', 'For Viewing', 'Negotiation', 'Closed', 'Failed'],
    cities: ['Makati', 'Taguig (BGC)', 'Pasig (Ortigas)', 'Mandaluyong', 'Quezon City', 'Muntinlupa (Alabang)', 'Pasay'],
    bedrooms: ['Studio', '1', '2', '3', '4+'],
    occupants: ['1', '2', '3', '4', '5+'],
    pets: ['No Pets', 'With Pets'],
    furnishing: ['Fully Furnished', 'Semi Furnished', 'Unfurnished'],
    bathrooms: ['1', '2', '3', '4+'],
    parking: ['No Parking', '1 Slot', '2 Slots', '3+ Slots'],
    availability: ['Available', 'Reserved', 'Not Available'],
    viewingStatuses: ['Proposed', 'Confirmed', 'Done', 'Cancelled'],
    nationalities: ['Filipino', 'Korean', 'Japanese', 'American', 'Australian', 'Chinese', 'Singaporean', 'British'],
    failReasons: ['Budget too low', 'Found another unit', 'No longer moving', 'Not responsive'],
  };
  // from the original Index.html
  const AI_STAGES = ['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection', 'Active', 'For Renewal', 'Failed', 'Not on Respond.io'];
  // 'Unchecked': linked to respond.io, but its chat hasn't been read yet (no status is implied)
  const TEMPS = ['Hot', 'Warm', 'Cold', 'Lost', 'Dead', 'Not on Respond.io', 'Active', 'Unchecked'];
  const MODULES = ['leads', 'vaportal', 'monitor', 'calendar', 'invdash', 'ldash', 'brokers', 'renewals', 'upsell', 'daily', 'propreq', 'services', 'pages', 'pl', 'team'];
  const ROLES = ['Manager', 'VA', 'Broker'];
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
  const MIN_PASSWORD = 12;

  // editable lead fields: [label, kind, picklist]
  const LEAD_FIELDS = {
    status: ['Client Status', 'select', LISTS.clientStatuses], va: ['VA Assigned', 'select', [''].concat(LISTS.vas)],
    source: ['Source', 'select', LISTS.sources], inquiry: ['Inquiry Type', 'select', ['Rent', 'Buy']],
    name: ['Contact Name', 'text'], phone: ['Phone', 'text'], email: ['Email', 'email'],
    budget: ['Budget (₱)', 'number'], city: ['City', 'select', LISTS.cities], bedrooms: ['No. of Bedrooms', 'select', LISTS.bedrooms],
    occupants: ['No. of Occupants', 'select', LISTS.occupants], pets: ['Pets', 'select', LISTS.pets], moveIn: ['Target Move-in Date', 'date'],
    nationality: ['Nationality', 'text'], requirements: ['Client Requirements', 'textarea'],
    // Property Requirements report: unit specifics the client asked for (empty = not stated)
    building: ['Specific Building', 'text'], sqm: ['SQM', 'text'], bathrooms: ['No. of Bathrooms', 'select', [''].concat(LISTS.bathrooms)],
    parking: ['Parking', 'select', [''].concat(LISTS.parking)], furnishing: ['Furnishing', 'select', [''].concat(LISTS.furnishing)],
  };
  const TEXT_MAX = { name: 120, phone: 20, email: 120, nationality: 60, requirements: 500, building: 120, sqm: 40 };

  const isYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
  const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

  function access(user, mod) {
    if (!user) return 'none';
    if (user.role === 'Manager') return 'edit';
    const a = (user.modules || {})[mod];
    return a === 'view' || a === 'edit' ? a : 'none';
  }

  /** Validates a partial lead update. Returns { value, errors } with trimmed/normalised values. */
  function validateLeadPatch(patch) {
    const errors = [], value = {};
    if (!isPlainObject(patch)) return { value, errors: ['Invalid request.'] };
    for (const [k, raw] of Object.entries(patch)) {
      const f = LEAD_FIELDS[k];
      if (!f) { errors.push('Unknown field: ' + k); continue; }
      if (typeof raw !== 'string' && typeof raw !== 'number') { errors.push(f[0] + ' has an invalid value.'); continue; }
      const v = typeof raw === 'string' ? raw.trim() : raw;
      if (f[1] === 'select') { if (!f[2].includes(String(v))) errors.push(f[0] + ' has an unknown value.'); else value[k] = String(v); continue; }
      if (k === 'budget') { const n = v === '' ? 0 : Number(v); if (!(n >= 0 && n <= 1e10)) errors.push('Budget must be a positive number.'); else value[k] = Math.round(n); continue; }
      if (k === 'moveIn') { if (v && !isYmd(String(v))) errors.push('Move-in date is not a valid date.'); else value[k] = String(v); continue; }
      const s = String(v);
      if (s.length > TEXT_MAX[k]) { errors.push(f[0] + ' is too long.'); continue; }
      if (k === 'name' && !s) errors.push('Contact Name is required.');
      else if (k === 'email' && s && !EMAIL_RE.test(s)) errors.push('Email doesn\'t look valid.');
      else if (k === 'phone' && s && !/^[+\d\s()-]{7,20}$/.test(s)) errors.push('Phone can only contain digits, spaces, + ( ) -.');
      else value[k] = k === 'email' ? s.toLowerCase() : s;
    }
    if (!errors.length && !Object.keys(value).length) errors.push('Nothing to save.');
    return { value, errors };
  }
  const leadUpdateNote = (keys) => 'Updated: ' + keys.map((k) => LEAD_FIELDS[k][0]).join(', ');

  function validateNote(text) {
    if (typeof text !== 'string' || !text.trim()) return { errors: ['Write a note first.'] };
    return { value: text.trim().slice(0, 2000), errors: [] };
  }

  function validateBooking(b) {
    if (!isPlainObject(b)) return { errors: ['Invalid request.'] };
    const { date, time, broker } = b;
    if (typeof date !== 'string' || !isYmd(date)) return { errors: ['Pick a valid date.'] };
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time < '07:00' || time > '21:00') return { errors: ['Pick a time between 07:00 and 21:00.'] };
    if (!LISTS.brokers.includes(broker)) return { errors: ['Pick a broker.'] };
    return { value: { date, time, broker }, errors: [] };
  }
  /** Booking the first viewing moves a lead from Property Matching to Scheduling (workStage too, for leads not on respond.io). */
  const bookingLeadChanges = (lead) => ({
    ...(lead.ai === 'Property Matching' ? { ai: 'Scheduling', status: 'For Viewing', daysInStage: 0 } : {}),
    ...(lead.workStage === 'Property Matching' ? { workStage: 'Scheduling', status: 'For Viewing', daysInStage: 0 } : {}),
  });
  const bookingNote = (listingCode, date, time) => `Viewing proposed: ${listingCode} on ${date} ${time}`;

  function validateViewingPatch(p) {
    if (!isPlainObject(p)) return { errors: ['Invalid request.'] };
    const value = {};
    if ('status' in p) { if (!LISTS.viewingStatuses.includes(p.status)) return { errors: ['Unknown viewing status.'] }; value.status = p.status; }
    if ('feedback' in p) { if (typeof p.feedback !== 'string') return { errors: ['Feedback must be text.'] }; value.feedback = p.feedback.trim().slice(0, 1000); }
    for (const k of Object.keys(p)) if (k !== 'status' && k !== 'feedback') return { errors: ['Unknown field: ' + k] };
    if (!Object.keys(value).length) return { errors: ['Nothing to save.'] };
    return { value, errors: [] };
  }

  function validateAvailability(p) {
    if (!isPlainObject(p) || !LISTS.availability.includes(p.availability) || Object.keys(p).length !== 1) return { errors: ['Unknown availability.'] };
    return { value: { availability: p.availability }, errors: [] };
  }

  /**
   * Team member. password is optional here (required on create by the caller).
   * opts.vaLabels: allowed VA labels (the preview list plus the Monday board's VA Assigned labels when connected).
   * opts.salesLabels: allowed Monday Salesperson labels for a Broker (exact board labels). A Broker's salesLabel is the
   * one label that identifies them on Monday; it may be left empty (they then see no Monday viewings until it is set).
   */
  function validateUser(u, opts) {
    const vaAllowed = (opts && opts.vaLabels) || LISTS.vas, salesAllowed = (opts && opts.salesLabels) || LISTS.brokers;
    if (!isPlainObject(u)) return { errors: ['Invalid request.'] };
    const name = typeof u.name === 'string' ? u.name.trim() : '', email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
    if (!name || name.length > 80) return { errors: ['Name is required (80 characters max).'] };
    if (!EMAIL_RE.test(email) || email.length > 120) return { errors: ['Enter a valid email.'] };
    if (!ROLES.includes(u.role)) return { errors: ['Pick a role.'] };
    const vaLabel = u.role === 'VA' ? u.vaLabel : '';
    if (u.role === 'VA' && (typeof vaLabel !== 'string' || !vaAllowed.includes(vaLabel))) return { errors: ['Pick the VA label this person uses on Monday.'] };
    const salesLabel = u.role === 'Broker' && u.salesLabel !== undefined ? u.salesLabel : '';
    if (typeof salesLabel !== 'string' || (salesLabel && !salesAllowed.includes(salesLabel))) return { errors: ['Pick this broker\'s exact Salesperson label on Monday (or leave it empty).'] };
    const modules = {};
    if (u.modules !== undefined && !isPlainObject(u.modules)) return { errors: ['Invalid module access.'] };
    for (const [k, a] of Object.entries(u.modules || {})) {
      if (!MODULES.includes(k) || !['none', 'view', 'edit'].includes(a)) return { errors: ['Invalid module access.'] };
      if (a !== 'none') modules[k] = a;
    }
    const value = { name, email, role: u.role, vaLabel: vaLabel || '', salesLabel, modules };
    if (u.password !== undefined && u.password !== '') {
      if (typeof u.password !== 'string' || u.password.length < MIN_PASSWORD || u.password.length > 200) return { errors: [`Password must be at least ${MIN_PASSWORD} characters.`] };
      value.password = u.password;
    }
    return { value, errors: [] };
  }

  function validateTemplate(t) {
    if (!isPlainObject(t)) return { errors: ['Invalid request.'] };
    const name = typeof t.name === 'string' ? t.name.trim() : '', language = typeof t.language === 'string' ? t.language.trim() : '', body = typeof t.body === 'string' ? t.body.trim() : '';
    if (!/^[a-z0-9_]{1,60}$/.test(name)) return { errors: ['Name: lowercase letters, digits and _ only.'] };
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) return { errors: ['Language like en or en_US.'] };
    if (!body || body.length > 1024) return { errors: ['Body is required (1024 characters max).'] };
    return { value: { name, language, body }, errors: [] };
  }

  /** MongoDB mode: Monday.com (read-only) is the default source for leads/listings/calendar; MongoDB only when chosen by hand. */
  const defaultSource = (manualChoice) => (manualChoice === 'mongo' ? 'mongo' : 'monday');

  // ---------- pets ----------
  /**
   * A lead's pet answer as 'With Pets', 'No Pets' or '' (not specified). Only clear answers count: the Monday label
   * "Not Applicable", N/A, Any, Not specified, blanks and anything else (e.g. "Small pets only", "Dog") stay ''.
   * "No…" is checked first, because "not pet friendly" contains "pet friendly".
   */
  function normPets(v) {
    const s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    if (/^(no|none|wala|0|no pets?|no pets? allowed|pets? not allowed|not pet[- ]friendly)$/i.test(s)) return 'No Pets';
    if (/^(yes|with pets?|pets? allowed|pet[- ]friendly)$/i.test(s)) return 'With Pets';
    return '';
  }
  /** The wording both requirement messages use. */
  const PET_WORDS = { 'With Pets': 'Pet Friendly', 'No Pets': 'Not Pet Friendly' };
  const petWords = (v) => PET_WORDS[normPets(v)] || 'Not specified';

  // ---------- cities ----------
  // The Monday Listings board's City (mirrored from the Building Database) says "Taguig", "Makati", "Rockwell"…, and is
  // empty for listings not linked to a building; the preview groups by the LISTS.cities labels ("Taguig (BGC)").
  // Each listing gets exactly one city, so BGC and Taguig are one group and nothing is counted twice.
  const normT = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // [label, words in a City value, words in a building name (used only when City is empty)]
  // Order matters: Muntinlupa comes before Makati so "Ayala Alabang" isn't read as Makati's Ayala. Building names that
  // exist in more than one city (Trump Tower and One Central are in Makati; Pacific Plaza is ambiguous) are left out.
  const CITY_RULES = [
    ['Taguig (BGC)', /\b(taguig|bgc|bonifacio|fort|mckinley|uptown|serendra|forbestown|high street|market market|arca south|burgos circle)\b/,
      /\b(bgc|bonifacio|the fort|mckinley|uptown|serendra|forbestown|forbeswood|high street|market market|grand hyatt|arya|verve|maridien|gallery place|east gallery|west gallery|park west|park triangle|icon residences|bellagio|essensa|shangri la the fort|shangri la at the fort|horizon homes|seasons residences|8 forbestown|avant)\b/],
    ['Muntinlupa (Alabang)', /\b(muntinlupa|alabang|filinvest)\b/, /\b(alabang|filinvest)\b/],
    ['Makati', /\b(makati|rockwell|salcedo|legaspi|legazpi|poblacion|bel air|forbes park|dasmarinas|urdaneta|san lorenzo|ayala|circuit|magallanes)\b/,
      /\b(makati|rockwell|salcedo|legaspi|legazpi|poblacion|forbes park|dasmarinas|urdaneta|san lorenzo|greenbelt|edades|proscenium|garden towers?|one rockwell|the residences at greenbelt)\b/],
    ['Pasig (Ortigas)', /\b(pasig|ortigas|kapitolyo|capitol commons)\b/, /\b(ortigas|kapitolyo|capitol commons|arcovia)\b/],
    ['Mandaluyong', /\b(mandaluyong|shaw)\b/, /\b(mandaluyong|shaw)\b/],
    ['Quezon City', /\b(quezon|qc|eastwood|cubao)\b/, /\b(eastwood|cubao|quezon)\b/],
    ['Pasay', /\b(pasay|moa|newport)\b/, /\b(newport|moa)\b/],
  ];
  const titleCase = (s) => String(s).trim().replace(/\s+city$/i, '').replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());
  /** One city label for a listing: its City value first (only the first of several linked buildings), else its building name. '' when unknown. */
  function canonCity(city, building) {
    const c = normT(String(city || '').split(/[,;/]/)[0]);
    if (c) { const r = CITY_RULES.find(([, re]) => re.test(c)); return r ? r[0] : titleCase(String(city).split(/[,;/]/)[0]); }
    const b = normT(building);
    const r = b && CITY_RULES.find(([, , re]) => re.test(b));
    return r ? r[0] : '';
  }
  /** Every city a free-text location names ("BGC or Makati" → ['Taguig (BGC)', 'Makati']). */
  const citiesIn = (text) => { const t = normT(text); return t ? CITY_RULES.filter(([, re]) => re.test(t)).map((r) => r[0]) : []; };

  // ---------- Properties tab: the VA's own search ----------
  const bedsNum = (b) => (/studio/i.test(b) ? 0 : parseInt(b, 10));
  /**
   * f: { q, cities[], beds[] ('Studio','1','2','3','4+'), type ('For Rent'|'For Sale'|''), priceMin, priceMax, furnishing, pets, available }
   * Several picks in one row match any of them; different rows must all match. Empty or missing = no filter.
   */
  function filterListings(listings, f) {
    f = f || {};
    const q = normT(f.q), cities = f.cities || [], beds = f.beds || [], pmin = Number(f.priceMin) || 0, pmax = Number(f.priceMax) || 0;
    return listings.filter((x) => {
      if (q && !q.split(' ').every((w) => normT([x.building, x.code, x.tower, x.city].join(' ')).includes(w))) return false;
      if (cities.length && !cities.includes(x.city)) return false;
      if (beds.length && !beds.some((b) => (b === '4+' ? bedsNum(x.bedrooms) >= 4 : b === 'Studio' ? bedsNum(x.bedrooms) === 0 : bedsNum(x.bedrooms) === Number(b)))) return false;
      if (f.type && x.type !== f.type) return false;
      if (pmin && !(x.price >= pmin)) return false;
      if (pmax && !(x.price > 0 && x.price <= pmax)) return false;
      if (f.furnishing && normT(x.furnishing).replace(/[^a-z]/g, '') !== normT(f.furnishing).replace(/[^a-z]/g, '')) return false;
      if (f.pets && !x.petFriendly) return false;
      if (f.available && x.availability === 'Not Available') return false;
      return true;
    });
  }

  // ---------- Asking for Availability (portal records; nothing is sent to owners) ----------
  const ASK = { statuses: ['asking', 'available', 'unavailable'], vias: ['call', 'whatsapp', 'viber'], maxPerLead: 60, logMax: 20 };
  const isRecId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);
  function validateAsk(b) {
    if (!isPlainObject(b) || !isRecId(b.listingId) || Object.keys(b).some((k) => k !== 'listingId')) return { errors: ['Pick a listing.'] };
    return { value: { listingId: b.listingId }, errors: [] };
  }
  function validateAskPatch(b) {
    if (!isPlainObject(b) || Object.keys(b).length !== 1) return { errors: ['Invalid request.'] };
    if ('status' in b) return ASK.statuses.includes(b.status) ? { value: { status: b.status }, errors: [] } : { errors: ['Unknown status.'] };
    if ('contacted' in b) return ASK.vias.includes(b.contacted) ? { value: { contacted: b.contacted }, errors: [] } : { errors: ['Unknown contact method.'] };
    // For Client Approval (Code.gs apiMarkSent / apiMarkAvailable): sent to the client; the client wants to view it
    if ('sent' in b) return typeof b.sent === 'boolean' ? { value: { sent: b.sent }, errors: [] } : { errors: ['Invalid request.'] };
    if ('interested' in b) return typeof b.interested === 'boolean' ? { value: { interested: b.interested }, errors: [] } : { errors: ['Invalid request.'] };
    return { errors: ['Invalid request.'] };
  }
  /**
   * Code.gs apiGetVaPortal: where an Asking for Availability record stands. asking → (owner says available) apprNew →
   * (units sent to the client) apprSent → (client wants to view) sched. Unavailable records are in none of them.
   */
  const askStage = (a) => (a.status === 'asking' ? 'asking' : a.status !== 'available' ? '' : a.interestedAt ? 'sched' : a.sentAt ? 'apprSent' : 'apprNew');
  /** Index.html sendListingsToChat / listingMessage: the text that goes to the client with the confirmed units. */
  function approvalText(units) {
    const peso = (n) => (Number(n) > 0 ? '₱' + Math.round(Number(n)).toLocaleString('en-US') : '');
    const one = (L) => [`🏠 ${L.name || L.building || 'Unit'}`, [L.building, L.city].filter(Boolean).length ? `📍 ${[L.building, L.city].filter(Boolean).join(', ')}` : '',
      L.price ? `💰 ${peso(L.price)}${L.type === 'For Rent' ? ' / month' : ''}` : '',
      [L.bedrooms ? `🛏 ${L.bedrooms} BR` : '', L.bathrooms ? `🛁 ${L.bathrooms}` : '', L.sizeSqm ? `📐 ${L.sizeSqm} sqm` : '', L.parking ? '🚗 parking' : ''].filter(Boolean).join(' · '),
      [L.furnishing ? `🛋 ${L.furnishing}` : '', L.petFriendly ? '🐾 pets allowed' : ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    return (units.length > 1 ? 'Hi! Good news — these units are available and match what you\'re looking for:' : 'Hi! Good news — this unit is available and matches what you\'re looking for:')
      + '\n\n' + units.map(one).join('\n\n');
  }
  /** Call / WhatsApp / Viber links for an owner's number (PH numbers normalised to +63). null when it isn't a usable number. */
  function contactLinks(phone) {
    let d = String(phone || '').replace(/[^\d+]/g, '');
    if (/^09\d{9}$/.test(d)) d = '+63' + d.slice(1);
    else if (/^9\d{9}$/.test(d)) d = '+63' + d;
    else if (/^63\d{10}$/.test(d)) d = '+' + d;
    if (!/^\+\d{10,15}$/.test(d)) return null;
    const n = d.slice(1);
    return { number: d, call: 'tel:' + d, whatsapp: 'https://wa.me/' + n, viber: 'viber://chat?number=%2B' + n };
  }

  // ---------- portal overrides (stored in the portal only, never written to Monday) ----------
  function validateFailOverride(b) {
    if (!isPlainObject(b) || Object.keys(b).some((k) => k !== 'reason')) return { errors: ['Invalid request.'] };
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length > 300) return { errors: ['Give a reason (300 characters max).'] };
    return { value: { reason }, errors: [] };
  }
  /** A lead with a portal "Failed" override: AI Status shows Failed, labelled as a portal override (Monday unchanged). */
  function applyOverride(lead, ov) {
    if (!ov || !ov.failed) return lead;
    return Object.assign(lead, { ai: 'Failed', aiSub: 'Portal override: ' + ov.failed.reason, aiSource: 'override', workStage: 'Failed',
      override: { failed: true, reason: ov.failed.reason, by: ov.failed.by, at: ov.failed.at } });
  }

  // ---------- viewing results and broker feedback (Code.gs FEEDBACK_TAGS, apiSetOutcome, pendingFeedback_) ----------
  const FEEDBACK_TAGS = {
    too_expensive: 'Too expensive', too_small: 'Too small', more_bedrooms: 'Needs more bedrooms',
    liked_building: 'Liked the building', disliked_building: "Didn't like the building",
    liked_area: 'Liked the area', disliked_area: "Didn't like the area",
    condition: 'Unit condition', view_floor: 'View / floor', layout: 'Layout',
  };
  const RESULT = { outcomes: ['loi', 'failed'], feedbackMax: 1000, stateMax: 500, from: '2026-10-12', days: 60 };
  /**
   * A viewing result from the page: { outcome: 'loi'|'failed', tags[], feedback, conf (0–100, LOI only), state }.
   * LOI needs a confidence level; Failed needs a reason or some feedback (as the Apps Script panel did).
   * feedbackMax: a lower limit when the text also goes into a one-line Monday column.
   */
  function validateResult(b, feedbackMax) {
    const max = feedbackMax || RESULT.feedbackMax;
    if (!isPlainObject(b) || Object.keys(b).some((k) => !['outcome', 'tags', 'feedback', 'conf', 'state'].includes(k))) return { errors: ['Invalid request.'] };
    if (!RESULT.outcomes.includes(b.outcome)) return { errors: ['Choose Create LOI or Failed.'] };
    const tags = b.tags === undefined ? [] : b.tags;
    if (!Array.isArray(tags) || tags.length > 10 || tags.some((t) => typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(FEEDBACK_TAGS, t))) return { errors: ['Unknown feedback reason.'] };
    if (b.feedback !== undefined && typeof b.feedback !== 'string') return { errors: ['Feedback must be text.'] };
    const feedback = String(b.feedback || '').trim();
    if (feedback.length > max) return { errors: [`Broker feedback: ${max} characters at most.`] };
    const value = { outcome: b.outcome, tags: [...new Set(tags)], feedback };
    if (b.outcome === 'loi') {
      const n = Number(b.conf);
      if (b.conf === '' || b.conf == null || !Number.isFinite(n) || n < 0 || n > 100) return { errors: ['Set the LOI confidence level — a number from 0 to 100%.'] };
      if (b.state !== undefined && typeof b.state !== 'string') return { errors: ['Current state must be text.'] };
      value.conf = { pct: Math.round(n), state: String(b.state || '').trim().slice(0, RESULT.stateMax) };
    } else {
      if (b.conf !== undefined || b.state !== undefined) return { errors: ['A confidence level is only for Create LOI.'] };
      if (!value.tags.length && !feedback) return { errors: ['Pick a reason or write what the client said.'] };
    }
    return { value, errors: [] };
  }
  /** Start of the pending-feedback window: 60 days back, never before 12 Oct 2026 (older viewings are not chased). */
  const pendingSince = (now) => Math.max(now - RESULT.days * 864e5, Date.parse(RESULT.from + 'T00:00:00+08:00'));
  /** A portal viewing's start time (Manila), or 0. */
  const viewingAt = (v) => (isYmd(v.date) ? Date.parse(v.date + 'T' + (/^\d{2}:\d{2}$/.test(v.time || '') ? v.time : '12:00') + ':00+08:00') || 0 : 0);
  /** A portal booking that happened (Confirmed / Done, in the window) and has no result yet. */
  const portalPending = (v, now) => { const t = viewingAt(v); return ['Confirmed', 'Done'].includes(v.status) && !v.outcome && !!t && t <= now && t >= pendingSince(now); };

  // property suggestions shaped by viewing feedback (Code.gs fbInfer_ / feedbackPrefs_ / applyFeedback_, unchanged rules)
  function numOf(v) {
    const s = String(v == null ? '' : v).toLowerCase().replace(/[,₱\s]|php/g, '');
    if (!s) return null;
    if (/studio/.test(s)) return 0;
    const m = s.match(/(\d+(?:\.\d+)?)(k|m)?/);
    return m ? parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1) : null;
  }
  /** Reasons read from free-text feedback (used when no reason was picked). */
  function fbInfer(text) {
    const t = String(text || '').toLowerCase(), out = [];
    if (/expensive|pricey|over ?budget|too high|cheaper|lower (price|rent)|mahal/.test(t)) out.push('too_expensive');
    if (/too small|small|cramped|tiny|bigger|more space|larger/.test(t)) out.push('too_small');
    if (/more (bed)?rooms|another bedroom|need \d ?br|bigger family/.test(t)) out.push('more_bedrooms');
    if (/(didn'?t|did not|doesn'?t|does not|not) like (the )?(building|tower|condo)|old building|building (is )?old/.test(t)) out.push('disliked_building');
    if (/(didn'?t|did not|doesn'?t|does not|not) like (the )?(area|location|neighbou?rhood)|too far|far from/.test(t)) out.push('disliked_area');
    if (/condition|dirty|old unit|needs repair|smell|mold|mould|worn/.test(t)) out.push('condition');
    if (/higher floor|low floor|view/.test(t)) out.push('view_floor');
    if (/layout/.test(t)) out.push('layout');
    return out;
  }
  /** entries: [{ tags[], feedback, name, price, sqm, bedrooms, building, location }] (one per viewing with feedback) → { rules, summary, notes } */
  function feedbackPrefs(entries) {
    const rules = [], summary = [], notes = [];
    (entries || []).forEach((f) => {
      const name = f.name || f.building || 'a unit', tags = f.tags && f.tags.length ? f.tags : fbInfer(f.feedback);
      const price = numOf(f.price), sqm = numOf(f.sqm), br = numOf(f.bedrooms), bld = normT(f.building || name), area = normT(f.location);
      tags.forEach((t) => {
        if (t === 'too_expensive' && price) { rules.push({ t, price }); summary.push('Under ' + Math.round(price).toLocaleString() + ' (' + name + ' was too expensive)'); }
        if (t === 'too_small' && sqm) { rules.push({ t, sqm }); summary.push('Bigger than ' + sqm + ' sqm (' + name + ' was too small)'); }
        if (t === 'more_bedrooms' && br != null) { rules.push({ t, br }); summary.push('More than ' + br + ' BR'); }
        if (t === 'disliked_building' && bld) { rules.push({ t, bld }); summary.push('Not ' + (f.building || name)); }
        if (t === 'liked_building' && bld) { rules.push({ t, bld }); summary.push('Same building as ' + (f.building || name) + ' first'); }
        if (t === 'liked_area' && area) { rules.push({ t, area }); summary.push(f.location + ' first'); }
        if (t === 'disliked_area' && area) { rules.push({ t, area }); summary.push(f.location + ' last'); }
      });
      if (f.feedback) notes.push(name + ': “' + String(f.feedback).slice(0, 140) + '”');
    });
    return { rules, summary: summary.filter((x, i, a) => a.indexOf(x) === i), notes };
  }
  /** One listing ({ price, sqm, bedrooms, building, location }) against those rules → { hide, boost, chips[] }. */
  function applyFeedback(L, fb) {
    const out = { hide: false, boost: 0, chips: [] };
    const price = numOf(L.price), sqm = numOf(L.sqm), br = numOf(L.bedrooms), bld = normT(L.building), area = normT(L.location);
    const sameBld = (b) => !!bld && !!b && (bld.indexOf(b) >= 0 || b.indexOf(bld) >= 0);
    (fb && fb.rules || []).forEach((r) => {
      if (r.t === 'too_expensive' && price != null && price >= r.price) out.hide = true;
      if (r.t === 'too_small' && sqm != null && sqm <= r.sqm) out.hide = true;
      if (r.t === 'more_bedrooms' && br != null && br <= r.br) out.hide = true;
      if (r.t === 'disliked_building' && sameBld(r.bld)) out.hide = true;
      if (r.t === 'liked_building' && sameBld(r.bld)) { out.boost += 6; out.chips.push('same building they liked'); }
      if (r.t === 'liked_area' && area && area === r.area) { out.boost += 3; out.chips.push('area they liked'); }
      if (r.t === 'disliked_area' && area && area === r.area) { out.boost -= 6; out.chips.push('area they disliked'); }
      if (r.t === 'too_expensive' && price != null && price < r.price) { out.boost += 1; }
      if (r.t === 'too_small' && sqm != null && sqm > r.sqm) { out.boost += 2; out.chips.push('bigger'); }
    });
    out.chips = out.chips.filter((x, i, a) => a.indexOf(x) === i);
    return out;
  }

  // ---------- Renewals: message templates (Code.gs CONFIG.RENEWAL_TEMPLATES, unchanged); composed and copied, not sent ----------
  const RENEWAL_TEMPLATES = [
    { k: 'renew90', group: 'Renewal', label: 'Renewal — 90 days', text: 'Hi {firstName}! This is {va} from Blackhouse. Your lease at {building} ends on {date}. Are you planning to renew, or would you like us to start looking for your next home? We can handle the renewal talks with the owner for you.' },
    { k: 'renew60', group: 'Renewal', label: 'Renewal — 60 days', text: 'Hi {firstName}! {va} from Blackhouse here. Just a reminder that your lease at {building} ends on {date} ({days} days). Would you like us to arrange the renewal with the owner, or help you find a new place?' },
    { k: 'renew30', group: 'Renewal', label: 'Renewal — 30 days', text: 'Hi {firstName}, your lease at {building} ends on {date} — only {days} days to go. Let us know today if you\'d like to renew so we can secure the same terms with the owner, or if you need options for your move.' },
    { k: 'renewDone', group: 'Renewal', label: 'Thank you — renewed', text: 'Hi {firstName}! Thank you for renewing your lease at {building} with Blackhouse. If you need anything during your stay — repairs, cleaning or furniture — just message us here.' },
    { k: 'movers', group: 'Services', label: 'Movers', text: 'Hi {firstName}! Moving soon? Blackhouse can arrange trusted movers for you — packing, truck and set-up at your new place, all handled. Would you like a quote?' },
    { k: 'cleaners', group: 'Services', label: 'Cleaning', text: 'Hi {firstName}! Need your unit cleaned? We offer deep cleaning, move-in / move-out cleaning and regular housekeeping. Would you like us to book a schedule?' },
    { k: 'aircon', group: 'Services', label: 'AC Cleaning', text: 'Hi {firstName}! When was your aircon last cleaned? Regular AC cleaning keeps it cool, saves on electricity and avoids breakdowns. We can book a trusted technician at {building} — how many units do you have, and what day works for you?' },
    { k: 'repairs', group: 'Services', label: 'Repairs & maintenance', text: 'Hi {firstName}! Anything at {building} that needs fixing — aircon, plumbing, electrical or appliances? Our maintenance team can take care of it. Just send us a photo and we\'ll arrange it.' },
    { k: 'interiors', group: 'Services', label: 'Interior design', text: 'Hi {firstName}! Thinking of refreshing your space? Our interior design partners can style your unit — from a simple makeover to a full fit-out. Would you like to see a few ideas?' },
    { k: 'furniture', group: 'Services', label: 'Furniture', text: 'Hi {firstName}! Need furniture for your unit? We can source and deliver complete packages or individual pieces at partner prices. What are you looking for?' },
    { k: 'legal', group: 'Services', label: 'Legal assistance', text: 'Hi {firstName}! Blackhouse also offers legal assistance — lease reviews, contract renewals, notarization and property documents. Would you like help with anything?' },
  ];
  // ---------- P&L manual lines (Code.gs PL_LINES_); everything else on the P&L is read from the Calendar board ----------
  const PL_LINES = { cos: 'Cost of Services', salaries: 'Salaries', comm_inhouse: 'Commission (in-house)', benefits: 'Benefits', contracted: 'Contracted services',
    advertising: 'Advertising', misc: 'Miscellaneous', permits: 'Permits & licenses', medical: 'Medical', corporate: 'Corporate', supplies: 'Supplies', dues: 'Dues & subscriptions' };
  /** A P&L cell from the page: { line, month 'YYYY-MM', value } — value '' / null clears it. */
  function validatePlCell(b) {
    if (!isPlainObject(b) || Object.keys(b).some((k) => !['line', 'month', 'value'].includes(k))) return { errors: ['Invalid request.'] };
    if (!Object.prototype.hasOwnProperty.call(PL_LINES, b.line)) return { errors: ['Unknown P&L line.'] };
    if (typeof b.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)) return { errors: ['Pick a month.'] };
    if (b.value === '' || b.value === null) return { value: { line: b.line, month: b.month, value: null }, errors: [] };
    const n = typeof b.value === 'number' ? b.value : Number(String(b.value).replace(/[,₱\s]/g, ''));
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { errors: ['Enter an amount.'] };
    return { value: { line: b.line, month: b.month, value: Math.round(n * 100) / 100 }, errors: [] };
  }

  // ---------- VA labels ----------
  /**
   * The key a VA label is matched on everywhere (server scoping, the Leads VA filter, VA Management, KPI Review):
   * case, spacing and punctuation don't count, so "Ana", "ana" and "Ana " are one VA. '' = unassigned.
   */
  const vaKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameVa = (a, b) => vaKey(a) === vaKey(b);
  /** One label per VA from a list of label values: the most used spelling of each (ties: a tidy one, then sort order). */
  function vaLabels(values) {
    const by = new Map(), untidy = (v) => (String(v) === String(v).trim().replace(/\s+/g, ' ') ? 0 : 1);
    values.filter((v) => vaKey(v)).forEach((v) => { const k = vaKey(v), m = by.get(k) || new Map(); m.set(v, (m.get(v) || 0) + 1); by.set(k, m); });
    return [...by.values()].map((m) => [...m.entries()].sort((a, b) => b[1] - a[1] || untidy(a[0]) - untidy(b[0]) || String(a[0]).localeCompare(String(b[0])))[0][0])
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  // ---------- VA Management KPIs (one calculation for the VA Management screen, KPI Review and its snapshots) ----------
  const LEAD_PLUS = ['LOI', 'Contract', 'Collection', 'Active', 'For Renewal'];
  const dealFailed = (d) => /fail/i.test(d.status) || /failed|archive/i.test(d.group);
  /** "Response monitor & KPIs per VA" for one VA label: the leads assigned to it now (not tied to a month). */
  function vaWorkload(leads, viewings, va) {
    const ls = leads.filter((l) => sameVa(l.va, va)), ids = new Set(ls.map((l) => l.id));
    return { leads: ls.length, needsReply: ls.filter((l) => l.waiting === 'va' && l.onRespond).length, hot: ls.filter((l) => l.temp === 'Hot').length,
      viewings: viewings.filter((v) => ids.has(v.leadId) && v.status !== 'Cancelled').length, loiPlus: ls.filter((l) => LEAD_PLUS.includes(l.ai)).length,
      failed: ls.filter((l) => l.ai === 'Failed').length };
  }
  /**
   * "VA Performance & Ranking" for one VA label: clients assigned from `from` (and up to `to`, when given; 'YYYY-MM-DD'),
   * and how many of them reached a viewing / a sale (Monday Calendar deals) or were lost. Percentages, rounded.
   */
  function vaPerformance(leads, deals, va, from, to, today) {
    const viewed = new Set(deals.filter((d) => d.fin && d.fin <= today && !/renewal/i.test(d.type)).map((d) => d.leadId));
    const sold = new Set(deals.filter((d) => !dealFailed(d) && !/renewal/i.test(d.type) && (d.contract || /^closed$/i.test(String(d.status).trim()))).map((d) => d.leadId));
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const ls = leads.filter((l) => { const d = String(l.inquiryDate || l.createdAt || '').slice(0, 10); return sameVa(l.va, va) && d >= from && (!to || d <= to); });
    const v = ls.filter((l) => viewed.has(l.id)).length, s = ls.filter((l) => sold.has(l.id)).length, lost = ls.filter((l) => l.ai === 'Failed').length;
    return { va, n: ls.length, vp: pct(v, ls.length), sp: pct(s, ls.length), lp: pct(lost, ls.length) };
  }

  // ---------- KPI Review (coaching and feedback per VA and reporting month; reporting periods in Manila time) ----------
  const KPI_REVIEW = {
    reviewers: [{ key: 'toby', label: 'Toby' }, { key: 'jonjo', label: 'Jonjo' }],
    textMax: 4000, timezone: 'Asia/Manila', monthsBack: 24, scope: 'all-vas',
    // the coaching form (kpi ref.png): achievements / gaps, then action plan rows with a commitment date
    actionsMax: 10, actionMax: 300, actionRows: 5,
    fieldLabels: { achievements: 'Performance Achievements / Gaps', coaching: 'Coaching', feedback: 'Feedback' },
    // shared accounts that may never be a reviewer (the coaching is private to Toby's and Jonjo's own accounts)
    neverReviewers: ['blackhouse2br@gmail.com'],
  };
  /** The current reporting month in Manila ('YYYY-MM'). Manila is UTC+8 all year (no daylight saving). */
  const manilaMonth = (now) => new Date((now == null ? Date.now() : now) + 8 * 3600e3).toISOString().slice(0, 7);
  const manilaDay = (now) => new Date((now == null ? Date.now() : now) + 8 * 3600e3).toISOString().slice(0, 10);
  /** A reporting month the review may use: 'YYYY-MM', not after the current Manila month, at most monthsBack earlier. */
  function validPeriod(p, now) {
    if (typeof p !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return false;
    const cur = manilaMonth(now), [cy, cm] = cur.split('-').map(Number), [y, m] = p.split('-').map(Number);
    const back = (cy - y) * 12 + (cm - m);
    return back >= 0 && back <= KPI_REVIEW.monthsBack;
  }
  /** First and last day of a reporting month ('YYYY-MM-DD'). */
  const periodDays = (p) => { const [y, m] = p.split('-').map(Number); return { from: p + '-01', to: p + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0') }; };
  /**
   * The KPI values for one VA label and month, labelled as on VA Management. `deals` is null when the Monday Calendar
   * board isn't available: the conversion figures are then left empty (null), never guessed.
   */
  function kpiReviewValues({ leads, viewings, deals, va, period, today }) {
    const w = vaWorkload(leads, viewings, va), { from, to } = periodDays(period), perf = vaPerformance(leads, deals || [], va, from, to, today);
    return {
      month: [
        { key: 'clients', label: 'Clients assigned in the month', value: perf.n, unit: '' },
        { key: 'toViewing', label: 'To viewing', value: deals ? perf.vp : null, unit: '%' },
        { key: 'toSale', label: 'To sale', value: deals ? perf.sp : null, unit: '%' },
        { key: 'lost', label: 'Lost', value: perf.lp, unit: '%' },
      ],
      current: [
        { key: 'leads', label: 'Leads', value: w.leads, unit: '' }, { key: 'needsReply', label: 'Needs reply', value: w.needsReply, unit: '' },
        { key: 'hot', label: 'Hot', value: w.hot, unit: '' }, { key: 'viewings', label: 'Viewings', value: w.viewings, unit: '' },
        { key: 'loiPlus', label: 'LOI or later', value: w.loiPlus, unit: '' }, { key: 'failed', label: 'Failed', value: w.failed, unit: '' },
      ],
    };
  }
  /**
   * A reviewer's section from the page (the coaching form: Performance Achievements / Gaps, Action Plan rows with a
   * Commitment Date). { achievements, actions: [{ text, date }], coaching?, feedback?, version } (version 0 = first save).
   * Coaching and Feedback are the earlier free-text fields: only the ones sent are changed, so a save never blanks them.
   * Returns { value } with only the fields sent; the caller checks the merged record isn't empty (kpiReviewEmpty).
   */
  function validateKpiFeedback(b) {
    const KEYS = ['achievements', 'actions', 'coaching', 'feedback', 'version'];
    if (!isPlainObject(b) || Object.keys(b).some((k) => !KEYS.includes(k))) return { errors: ['Invalid request.'] };
    if (!Number.isInteger(b.version) || b.version < 0) return { errors: ['Reload the review and try again.'] };
    const value = { version: b.version };
    for (const k of ['achievements', 'coaching', 'feedback']) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'string') return { errors: ['The review must be text.'] };
      const s = b[k].replace(/\r\n/g, '\n').trim();
      if (s.length > KPI_REVIEW.textMax) return { errors: [`${KPI_REVIEW.fieldLabels[k]}: ${KPI_REVIEW.textMax} characters at most.`] };
      value[k] = s;
    }
    if (b.actions !== undefined) {
      if (!Array.isArray(b.actions) || b.actions.length > 50) return { errors: ['Invalid action plan.'] };
      const rows = [];
      for (const r of b.actions) {
        if (!isPlainObject(r) || Object.keys(r).some((k) => k !== 'text' && k !== 'date') || typeof (r.text ?? '') !== 'string' || typeof (r.date ?? '') !== 'string') return { errors: ['Invalid action plan.'] };
        const text = (r.text || '').trim(), date = (r.date || '').trim();
        if (!text && !date) continue;   // an empty row is just an unused line
        if (!text) return { errors: [`Commitment date ${date} has no action. Write the action, or clear the date.`] };
        if (text.length > KPI_REVIEW.actionMax) return { errors: [`Each action: ${KPI_REVIEW.actionMax} characters at most.`] };
        if (date && !isYmd(date)) return { errors: [`The commitment date for “${text.slice(0, 40)}” isn't a valid date.`] };
        rows.push({ text, date });
      }
      if (rows.length > KPI_REVIEW.actionsMax) return { errors: [`At most ${KPI_REVIEW.actionsMax} actions.`] };
      value.actions = rows;
    }
    if (Object.keys(value).length === 1) return { errors: ['Write the review first.'] };
    return { value, errors: [] };
  }
  /** True when a review (saved fields merged with the new ones) has nothing in it. */
  const kpiReviewEmpty = (r) => !String(r.achievements || '').trim() && !(r.actions || []).length && !String(r.coaching || '').trim() && !String(r.feedback || '').trim();

  // ---------- Project Pages (the original Apps Script fields; server: src/projects.js) ----------
  const PROJECT = {
    kinds: ['photo', 'floorplan', 'brochure', 'other'], kindLabels: { photo: 'Photo', floorplan: 'Floor plan', brochure: 'Brochure', other: 'Other' },
    statuses: ['Pre-selling', 'RFO', 'Under construction', 'Sold out'],   // suggestions (the original's Add list); free text allowed
    text: { name: 120, developer: 120, location: 160, status: 40, turnover: 60, priceFrom: 60, tagline: 200, map: 200, video: 300, pageUrl: 300, driveLink: 300 },
    descriptionMax: 6000, listMax: 30, itemMax: 200, unitsMax: 40, mediaMax: 200, unitText: { type: 80, bedrooms: 20, sizeSqm: 20, priceFrom: 60, availability: 40, notes: 300 },
    fillable: ['developer', 'tagline', 'description', 'status', 'turnover', 'priceFrom', 'location', 'map'],   // Build from Drive (empty fields only)
  };
  const isId24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/.test(s);
  /** A Google Drive / Docs link (or a bare id) → { id, resourceKey } or null. Only drive.google.com and docs.google.com. */
  function parseDriveLink(link) {
    const s = String(link || '').trim();
    if (/^[A-Za-z0-9_-]{10,100}$/.test(s)) return { id: s, resourceKey: '' };
    let u; try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' || !/^(drive|docs)\.google\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:drive\/(?:u\/\d+\/)?folders|file\/d|(?:document|spreadsheets|presentation|drawings|forms)\/d)\/([A-Za-z0-9_-]{10,100})/)
      || (/^\/(open|uc)$/.test(u.pathname) && /^[A-Za-z0-9_-]{10,100}$/.test(u.searchParams.get('id') || '') ? [0, u.searchParams.get('id')] : null);
    return m ? { id: m[1], resourceKey: (u.searchParams.get('resourcekey') || '').slice(0, 100) } : null;
  }
  /** A YouTube link → its video id, or '' (only youtube.com / youtu.be, https). */
  function youtubeId(link) {
    let u; try { u = new URL(String(link || '').trim()); } catch (e) { return ''; }
    if (u.protocol !== 'https:') return '';
    const h = u.hostname.replace(/^(www|m)\./, ''), id = h === 'youtu.be' ? u.pathname.slice(1) : h === 'youtube.com' ? (u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/) || [])[1] || '') : '';
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
  }
  const isHttpsUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch (e) { return false; } };
  /** The inquiry form's endpoint: the Apps Script public hook (a /exec link), as in the original; '' clears it. */
  const validHook = (s) => s === '' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/.test(s);
  /** A list typed one per line (or given as an array) → trimmed, non-empty, de-duplicated, capped. */
  const toList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()).filter(Boolean))];
  /**
   * A project save from the page → { value, errors }. value holds only the editable fields; media changes are limited
   * to caption / kind / use of files the project already has (mediaIds), and units / cover may only point at its images.
   */
  function validateProject(b, { mediaIds = [], imageIds = [] } = {}) {
    if (!isPlainObject(b)) return { errors: ['Invalid request.'] };
    const allowed = Object.keys(PROJECT.text).concat(['description', 'highlights', 'amenities', 'units', 'media', 'cover', 'version']);
    const extra = Object.keys(b).find((k) => !allowed.includes(k)); if (extra) return { errors: ['Unknown field: ' + extra] };
    const value = {};
    for (const [k, max] of Object.entries(PROJECT.text)) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'string') return { errors: [k + ' must be text.'] };
      const s = b[k].replace(/\s+/g, ' ').trim(); if (s.length > max) return { errors: [`${k}: ${max} characters at most.`] };
      value[k] = s;
    }
    if ('name' in value && !value.name) return { errors: ['Project name is required.'] };
    if (value.video && !youtubeId(value.video)) return { errors: ['YouTube video link: use a youtube.com or youtu.be link.'] };
    if (value.pageUrl && !isHttpsUrl(value.pageUrl)) return { errors: ['Live page link must be a secure (https) address.'] };
    if (value.driveLink && !parseDriveLink(value.driveLink)) return { errors: ['That doesn\'t look like a Google Drive folder or file link.'] };
    if (b.description !== undefined) { if (typeof b.description !== 'string') return { errors: ['Description must be text.'] }; value.description = b.description.trim(); if (value.description.length > PROJECT.descriptionMax) return { errors: [`Description: ${PROJECT.descriptionMax} characters at most.`] }; }
    for (const k of ['highlights', 'amenities']) {
      if (b[k] === undefined) continue;
      if (!Array.isArray(b[k]) && typeof b[k] !== 'string') return { errors: [k + ' must be a list.'] };
      const l = toList(b[k]); if (l.length > PROJECT.listMax || l.some((x) => x.length > PROJECT.itemMax)) return { errors: [`${k}: at most ${PROJECT.listMax} lines of ${PROJECT.itemMax} characters.`] };
      value[k] = l;
    }
    if (b.units !== undefined) {
      if (!Array.isArray(b.units) || b.units.length > PROJECT.unitsMax) return { errors: [`Units: at most ${PROJECT.unitsMax}.`] };
      value.units = [];
      for (const u of b.units) {
        if (!isPlainObject(u) || Object.keys(u).some((k) => !(k in PROJECT.unitText) && k !== 'media')) return { errors: ['Invalid unit.'] };
        const out = {};
        for (const [k, max] of Object.entries(PROJECT.unitText)) { const s = u[k] == null ? '' : u[k]; if (typeof s !== 'string' && typeof s !== 'number') return { errors: ['Invalid unit.'] }; out[k] = String(s).replace(/\s+/g, ' ').trim(); if (out[k].length > max) return { errors: [`Unit ${k}: ${max} characters at most.`] }; }
        out.media = u.media ? String(u.media) : '';
        if (out.media && !imageIds.includes(out.media)) return { errors: ['A unit\'s photo / floor plan must be one of this project\'s images.'] };
        if (!out.availability) out.availability = 'Available';
        if (Object.values(out).some(Boolean)) value.units.push(out);
      }
    }
    if (b.media !== undefined) {
      if (!Array.isArray(b.media) || b.media.length > PROJECT.mediaMax) return { errors: ['Invalid media.'] };
      value.media = [];
      for (const m of b.media) {
        if (!isPlainObject(m) || !mediaIds.includes(m.id) || Object.keys(m).some((k) => !['id', 'caption', 'kind', 'use'].includes(k))) return { errors: ['Invalid media (only files already in this project).'] };
        if (m.kind !== undefined && !PROJECT.kinds.includes(m.kind)) return { errors: ['Unknown media kind.'] };
        if (m.caption !== undefined && (typeof m.caption !== 'string' || m.caption.length > 200)) return { errors: ['Caption: 200 characters at most.'] };
        if (m.use !== undefined && typeof m.use !== 'boolean') return { errors: ['Invalid media.'] };
        value.media.push({ id: m.id, ...(m.caption !== undefined ? { caption: m.caption.trim() } : {}), ...(m.kind ? { kind: m.kind } : {}), ...(m.use !== undefined ? { use: m.use } : {}) });
      }
    }
    if (b.cover !== undefined) { if (b.cover !== '' && !imageIds.includes(b.cover)) return { errors: ['The cover must be one of this project\'s images.'] }; value.cover = b.cover; }
    if (!Number.isInteger(b.version) || b.version < 1) return { errors: ['Reload the project and try again.'] };
    value.version = b.version;
    return { value, errors: [] };
  }
  /** Media kind from a file's name and type (the original's caption rules): floor plans and brochures by name. */
  function mediaKind(name, type) {
    const n = String(name || '');
    if (type === 'image') return /floor|plan|layout/i.test(n) ? 'floorplan' : 'photo';
    return /brochure|price|pricelist|fact ?sheet|primer|presentation|deck|e-?brochure/i.test(n) ? 'brochure' : 'other';
  }
  /**
   * Build from Drive: what the found values would change. Only empty fields are proposed for filling (checked by
   * default); a found value that differs from one already entered is offered as "replace" (unchecked). Lists and
   * units: only when the project has none. Blank or uncertain found values are never proposed.
   */
  function driveProposal(p, found) {
    const out = [];
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    // values are cut to what Save accepts, so using a proposal can't make the save fail
    PROJECT.fillable.forEach((k) => {
      const v = (k === 'description' ? String(found[k] || '').trim() : clean(found[k])).slice(0, k === 'description' ? PROJECT.descriptionMax : PROJECT.text[k]);
      if (!v || /^(n\/?a|unknown|not (stated|specified|found)|tbd|-+)$/i.test(v)) return;
      const cur = String(p[k] || '').trim();
      if (!cur) out.push({ field: k, value: v, current: '', apply: true });
      else if (cur !== v) out.push({ field: k, value: v, current: cur, apply: false });
    });
    ['highlights', 'amenities'].forEach((k) => { const l = toList(Array.isArray(found[k]) ? found[k] : []).map((x) => x.slice(0, PROJECT.itemMax)).slice(0, PROJECT.listMax); if (l.length) out.push({ field: k, value: l, current: p[k] || [], apply: !(p[k] || []).length }); });
    const ut = PROJECT.unitText, cut = (v, k) => clean(v).slice(0, ut[k]);
    const units = (Array.isArray(found.units) ? found.units : []).filter((u) => u && clean(u.type)).slice(0, PROJECT.unitsMax)
      .map((u) => ({ type: cut(u.type, 'type'), bedrooms: cut(u.bedrooms, 'bedrooms'), sizeSqm: cut(u.sizeSqm, 'sizeSqm'), priceFrom: cut(u.priceFrom, 'priceFrom'), availability: 'Available', notes: cut(u.notes, 'notes'), media: '' }));
    if (units.length) out.push({ field: 'units', value: units, current: p.units || [], apply: !(p.units || []).length });
    return out;
  }

  // ---------- LOI / Contract (Code.gs apiLoiDefaults, apiSaveCalFeedback listing match, dealTerm_) — read only here ----------
  /**
   * What generating, sending and signing LOIs / contracts needs and the portal doesn't have (Code.gs LOI_TPL_*,
   * DocumentApp/DriveApp, LOI_OUT_FOLDER, PUBLIC_HOOK_URL signing page, MailApp / respond.io sending).
   */
  // e-signature and the signed copy (Code.gs apiSendLoi / loiSignPage_ / apiSubmitLoiSignature / apiSendLoiOwner)
  const LOI_SETUP = [
    'A public signing page that clients and owners can open without a portal account (the Apps Script public hook ?sign=), with sign-link storage and expiry',
    'Turning the LOI into a PDF to show and sign (the Apps Script exported it through Google Drive; the portal has no document converter)',
    'Sending the signing link: email (the Apps Script used MailApp; the portal has no mail service) or respond.io (sending is switched off: RESPOND_SENDS)',
    'Where the signed copy is kept: Google Drive with write access (the portal can only read Drive), or the portal\'s own storage, once decided',
  ];
  const pesoText = (n) => (Number(n) > 0 ? '₱' + Math.round(Number(n)).toLocaleString('en-US') : '');
  // the LOI templates (Settings → Files): one per kind, as the Apps Script LOI_TPL_lease / _absolute / _conditional
  const LOI_SLOTS = { lease: 'Lease (Contract of Lease)', absolute: 'Sale: Deed of Absolute Sale', conditional: 'Sale: Deed of Conditional Sale' };
  // the fields the Prepare LOI form edits (Code.gs apiLoiDefaults); OWNER / OWNER_SIGN / CLIENT_SIGN follow TO_1 / CLIENT
  const LOI_TERMS_DEFAULT = { absolute: 'Full payment upon signing of the Deed of Absolute Sale, unless otherwise stated', conditional: 'As stated in the payment schedule under Annex "A"' };
  const LOI_FIELDS = ['DATE', 'TO_1', 'TO_2', 'TO_3', 'DEAR', 'CLIENT', 'BROKER_SIGN', 'PROPERTY', 'LEASE_TERM', 'MONTHLY_RENT', 'ADVANCE', 'DEPOSIT', 'PRICE', 'TERMS', 'CONCESSIONS', 'COMM_PCT'];
  /** Code.gs numberWords_: 3 → "Three", 2.5 → "Two point five". */
  function numberWords(n) {
    n = Number(n); if (!isFinite(n) || n < 0) return '';
    const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const int = (w) => (w < 20 ? ones[w] : w < 100 ? tens[Math.floor(w / 10)] + (w % 10 ? '-' + ones[w % 10] : '') : w === 100 ? 'one hundred' : String(w));
    const [a, b] = String(n).split('.');
    const words = int(Number(a)) + (b ? ' point ' + b.split('').map((d) => ones[Number(d)]).join(' ') : '');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  /**
   * The Prepare LOI form, checked: { slot, fields } → { value: { slot, fields (all template keys) }, missing: [labels], errors }.
   * Missing values are allowed (the document keeps the template's blank line) and listed, never filled in.
   */
  function validateLoi(b) {
    if (!isPlainObject(b) || !LOI_SLOTS[b.slot] || !isPlainObject(b.fields) || Object.keys(b.fields).some((k) => !LOI_FIELDS.includes(k))) return { errors: ['Invalid request.'] };
    const f = {};
    for (const k of LOI_FIELDS) {
      const v = b.fields[k] == null ? '' : b.fields[k];
      if (typeof v !== 'string') return { errors: ['Invalid request.'] };
      // control characters would make the Word document unreadable: removed (they are never visible text)
      const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/\s+/g, ' ').trim();
      if (s.length > (k === 'TERMS' ? 1000 : 300)) return { errors: [`${k}: too long.`] };
      f[k] = s;
    }
    if (f.COMM_PCT && !(/^\d{1,3}(\.\d{1,2})?$/.test(f.COMM_PCT) && Number(f.COMM_PCT) <= 100)) return { errors: ['Commission % must be a number from 0 to 100.'] };
    const lease = b.slot === 'lease';
    // Code.gs apiMakeLoi: the original's default Terms of Payment for a sale when none is typed
    if (!f.TERMS) f.TERMS = LOI_TERMS_DEFAULT[b.slot] || '';
    const fields = { ...f, OWNER: f.TO_1, OWNER_SIGN: f.TO_1, CLIENT_SIGN: f.CLIENT, COMM_WORDS: f.COMM_PCT ? numberWords(f.COMM_PCT) : '',
      ...(lease ? { PRICE: '' } : { MONTHLY_RENT: '', ADVANCE: '', DEPOSIT: '', LEASE_TERM: '' }) };
    const need = { DATE: 'Date', TO_1: 'Owner', TO_2: 'Unit, building', CLIENT: 'Client', BROKER_SIGN: 'Broker', PROPERTY: 'Property', COMM_PCT: 'Commission %', ...(lease ? { LEASE_TERM: 'Lease term', MONTHLY_RENT: 'Monthly rent' } : { PRICE: 'Price' }) };
    const missing = Object.keys(need).filter((k) => !fields[k]).map((k) => need[k]);
    return { value: { slot: b.slot, fields }, missing, errors: [] };
  }
  /**
   * The listing a Calendar deal is about (Code.gs apiSaveCalFeedback): same building (either name containing the other),
   * closest price, and only if within 15 % of the deal's rental rate / price. → { listing, ambiguous }
   */
  function loiListing(listings, building, price) {
    const b = normT(building); if (!b) return { listing: null, ambiguous: false };
    const p = Number(price) || 0, near = (x) => !p || Math.abs((Number(x.price) || 0) - p) <= p * 0.15;
    const same = listings.filter((x) => { const xb = normT(x.building); return xb && (xb.includes(b) || b.includes(xb)); })
      .sort((x, y) => Math.abs((Number(x.price) || 0) - p) - Math.abs((Number(y.price) || 0) - p));
    const ok = same.filter(near);
    return { listing: ok[0] || null, ambiguous: ok.length > 1 };
  }
  /**
   * The LOI fields as the Apps Script would pre-fill them (apiLoiDefaults), each with where it comes from and its state:
   * 'ok' (from the records), 'default' (the original's fixed default), 'missing', 'entered' (typed when preparing).
   * Plus warnings for conflicting records. Nothing here is invented: an unknown value stays empty.
   * { lead, listing, deal (Calendar row), ambiguous, today 'YYYY-MM-DD' }
   */
  function loiDraft({ lead, listing, deal, ambiguous, today }) {
    const L = listing || {}, d = deal || {}, warn = [];
    // lease or sale: the listing first, then the client's inquiry (loiIsLease_)
    const lease = listing ? L.type !== 'For Sale' : d.type ? !/sale/i.test(d.type) : lead.inquiry !== 'Buy';
    if (listing && lead.inquiry && (lead.inquiry === 'Buy') === lease) warn.push(`The listing is ${L.type}, but the client's inquiry is ${lead.inquiry === 'Buy' ? 'Buy' : 'Rent'}. Check which LOI applies.`);
    if (!listing) warn.push(d.building ? `No listing matches “${d.building}” at the deal's price (within 15 %), so property, owner and price are unknown.` : 'No viewing with a building to match a listing yet.');
    if (ambiguous) warn.push('More than one listing in that building is near the deal\'s price; the closest one is shown. Check it is the right unit.');
    const dealPrice = Number(d.rate || d.price) || 0;
    if (listing && dealPrice && L.price && Math.abs(L.price - dealPrice) > 1) warn.push(`The listing's price (${pesoText(L.price)}) differs from the Calendar's ${d.rate ? 'Rental Rate' : 'Monthly Contract Price'} (${pesoText(dealPrice)}). The LOI used the listing's price; confirm the agreed amount.`);
    const broker = d.sp || lead.salesperson || '';
    if (d.sp && lead.salesperson && d.sp !== lead.salesperson) warn.push(`The viewing's broker (${d.sp}) differs from the client's Salesperson (${lead.salesperson}); the LOI uses the viewing's broker.`);
    const owner = L.contact || '', unit = L.tower || '', building = L.building || d.building || '', location = L.cityRaw || d.city || '';
    const specs = [L.bedrooms && (/^\d+$/.test(L.bedrooms) ? L.bedrooms + ' BR' : L.bedrooms), L.sizeSqm && L.sizeSqm + ' sqm', L.furnishing].filter(Boolean).join(', ');
    const f = (key, label, value, state, note) => ({ key, label, value: value || '', state: value ? state || 'ok' : state === 'entered' ? 'entered' : 'missing', note: note || '' });
    const fields = [
      f('DATE', 'Date', today, 'ok', 'The day it is prepared (Manila)'),
      f('TO_1', 'To (owner)', owner, 'ok', 'The listing\'s owner (its Monday item name)'),
      f('TO_2', 'Unit, building', [unit, building].filter(Boolean).join(', ')),
      f('TO_3', 'Location', location),
      f('DEAR', 'Dear', owner || 'Sir/Madam', owner ? 'ok' : 'default'),
      f('CLIENT', 'Client', lead.name), f('BROKER_SIGN', 'Broker', broker, 'ok', d.sp ? 'From the Calendar viewing' : 'From the client\'s Salesperson'),
      f('PROPERTY', 'Property', [unit, building, location].filter(Boolean).join(', ') + (specs ? ' (' + specs + ')' : '')),
      ...(lease ? [f('LEASE_TERM', 'Lease term', lead.leaseTerm || 'One (1) year', lead.leaseTerm ? 'ok' : 'default'), f('MONTHLY_RENT', 'Monthly rent', pesoText(L.price)),
        f('ADVANCE', 'Advance', 'One (1) month', 'default'), f('DEPOSIT', 'Deposit', 'Two (2) months', 'default')] : [f('PRICE', 'Price', pesoText(L.price))]),
      f('CONCESSIONS', 'Concessions', '', 'entered', lead.pets === 'With Pets' ? 'The client has pets; the number of pets isn\'t read by the portal, so it is typed when preparing.' : 'Typed when preparing, if any'),
      f('COMM_PCT', 'Commission %', '', 'entered', 'Typed when preparing'),
    ];
    return { kind: lease ? 'Lease (Contract of Lease)' : 'Sale (Deed of Absolute or Conditional Sale)', lease, fields, warnings: warn };
  }
  /**
   * A lead's deal stages from its Calendar rows (Code.gs loiMap_ / dealTerm_ / the 5-day rule): the latest row with a
   * Contract Date, else with an LOI date, else the latest viewing. Dates as on Monday; nothing is computed that Monday doesn't hold.
   */
  function dealStages(deals, today) {
    const all = (deals || []).slice().sort((a, b) => String(b.contract || b.loi || b.fin || '').localeCompare(String(a.contract || a.loi || a.fin || '')));
    if (!all.length) return null;
    // as Code.gs loiMap_: failed items (Status, or a Failed / Archive group) don't count
    const rows = all.filter((x) => !/fail/i.test(String(x.status || '')) && !/failed|archive/i.test(String(x.group || '')));
    if (!rows.length) return { deal: null, others: 0, failed: all.length, warnings: [`This client's Calendar item${all.length > 1 ? 's are' : ' is'} marked Failed, so there is no deal to show.`] };
    // the furthest stage: a row with a Contract Date (the deal), else one with an LOI date, else the latest viewing
    const d = rows.find((x) => x.contract) || rows.find((x) => x.loi) || rows[0];
    // across all the client's items (loiMap_): latest contract date, total paid, any LOI / contract / signed file
    const f = (k) => rows.some((x) => (x.files || {})[k]);
    const cd = rows.map((x) => x.contract).filter(Boolean).sort().pop() || '', loi = rows.map((x) => x.loi).filter(Boolean).sort().pop() || '';
    const paid = rows.reduce((a, x) => a + (Number(x.paid) || 0), 0);
    const days = (s) => Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(s + 'T00:00:00Z')) / 864e5);
    // the 5-day rules (Code.gs stage rules 4588-4596): signed contract or payment → no rule; contract date not signed;
    // LOI not signed by the owner (a contract file on the Calendar counts as the owner's signature)
    const warn = [];
    if (!f('signed') && !(paid > 0)) {
      if (cd && days(cd) > 5) warn.push(`Contract Date was ${days(cd)} days ago and no Signed Contract file is on the Calendar item (the 5-day rule moves the client back to Property Matching).`);
      else if (!cd && loi && !f('contract') && days(loi) > 5) warn.push(`The LOI was ${days(loi)} days ago and the owner hasn't signed (no Contract Date or Contract file): the 5-day rule moves the client back to Property Matching.`);
    }
    return { deal: { ...d, files: { loi: f('loi'), contract: f('contract'), signed: f('signed') } }, others: rows.length - 1, failed: all.length - rows.length, warnings: warn };
  }

  // ---------- Upselling (Code.gs / Index.html Upselling; server: src/upsell.js) ----------
  const UPSELL = {
    presets: ['tenants', 'active', 'past', 'all'],
    presetLabels: { tenants: 'Tenants (closed / renewing)', active: 'Active leads', past: 'Past leads (failed / unresponsive)', all: 'Everyone' },
    contacts: ['any', 'respond', 'email', 'phone'], contactLabels: { any: 'Any', respond: 'On respond.io', email: 'Has email', phone: 'Has phone' },
    textMax: 1500, batchMax: 40, imageMax: 5 * 1024 * 1024, gapMs: 700,
    // tagging is a light request: bigger batches, shorter gaps (the Apps Script tagged up to 3000 per click)
    tagBatchMax: 200, tagGapMs: 150,
    // the Client Status chip for clients with no status (Index.html upRows '(blank)')
    blank: '(blank)',
    // the original's default offer text (Index.html UP_CONCIERGE), unchanged
    concierge: 'Hi {firstName},\n\nJust wanted to check up on you. How are things with the unit?\n\nAlso, we want to remind you of our Blackhouse Concierge service — we can help with the following services:\n\nMovers, Cleaners, AC Cleaning, Furniture, Repairs, Legal Assistance\n\nWe also have partnerships with Ayala Land, SM Prime, Shangri-La, Arthaland, Federal Land and Rockwell if you are interested in pre-selling investments for property.\n\nJust message us if you need any help!\n\nBlackhouse Concierge Team',
  };
  /** The offers to start from: the Concierge text and the Services templates of Renewals → Message. */
  const upsellTemplates = () => [{ k: 'concierge', label: 'Blackhouse Concierge (all services)', text: UPSELL.concierge }]
    .concat(RENEWAL_TEMPLATES.filter((t) => t.group === 'Services').map((t) => ({ k: t.k, label: t.label, text: t.text })));
  /** A respond.io tag as the original allowed it: letters, digits, _ - and spaces, at most 40. */
  const upsellTag = (s) => String(s || '').replace(/[^\w\- ]/g, '').trim().slice(0, 40);
  /** The text one client receives: {firstName} (first word of their name, else "there"), {va} (the sender), {building}. */
  function upsellText(text, lead, senderName) {
    const first = String((lead && lead.name) || '').trim().split(/\s+/)[0] || 'there';
    return String(text || '').replace(/\{firstName\}/g, first).replace(/\{va\}/g, String(senderName || '').trim().split(/\s+/)[0] || 'Blackhouse')
      .replace(/\{building\}/g, (lead && lead.building) || 'your unit');
  }
  /** A campaign draft from the page → { value, errors } (only these fields; the audience is validated as a whole). */
  function validateCampaign(b, { projectIds = [] } = {}) {
    if (!isPlainObject(b)) return { errors: ['Invalid request.'] };
    if (Object.keys(b).some((k) => !['name', 'template', 'projectId', 'text', 'tag', 'audience', 'channelId', 'version'].includes(k))) return { errors: ['Invalid request.'] };
    const value = {};
    // the respond.io channel for 1:1 sends ('' = Auto, the channel the client last used; Index.html upChan)
    if (b.channelId !== undefined) { if (typeof b.channelId !== 'string' || !/^\d{0,20}$/.test(b.channelId)) return { errors: ['Pick a respond.io channel.'] }; value.channelId = b.channelId; }
    if (b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) return { errors: ['Give the offer a name (80 characters max).'] }; value.name = b.name.trim(); }
    if (b.template !== undefined) { if (!['project'].concat(upsellTemplates().map((t) => t.k)).includes(b.template)) return { errors: ['Unknown message template.'] }; value.template = b.template; }
    if (b.projectId !== undefined) { if (b.projectId !== '' && !projectIds.includes(b.projectId)) return { errors: ['Pick a project from Project Pages.'] }; value.projectId = b.projectId; }
    if (b.text !== undefined) { if (typeof b.text !== 'string' || b.text.length > UPSELL.textMax) return { errors: [`The message can be ${UPSELL.textMax} characters at most.`] }; value.text = b.text.replace(/\r\n/g, '\n').trim(); }
    if (b.tag !== undefined) { if (typeof b.tag !== 'string' || b.tag.length > 60) return { errors: ['Invalid tag.'] }; value.tag = upsellTag(b.tag); }
    if (b.audience !== undefined) {
      const a = b.audience;
      if (!isPlainObject(a) || Object.keys(a).some((k) => !['preset', 'statuses', 'type', 'city', 'contact', 'skipDays'].includes(k))) return { errors: ['Invalid audience.'] };
      if (!UPSELL.presets.includes(a.preset) || !UPSELL.contacts.includes(a.contact) || !['', 'Rent', 'Buy'].includes(a.type)) return { errors: ['Invalid audience.'] };
      if (!Array.isArray(a.statuses) || a.statuses.length > 30 || a.statuses.some((s) => typeof s !== 'string' || s.length > 60)) return { errors: ['Invalid client status filter.'] };
      if (typeof a.city !== 'string' || a.city.length > 60) return { errors: ['Invalid city.'] };
      const d = Number(a.skipDays); if (!Number.isInteger(d) || d < 0 || d > 365) return { errors: ['"Skip if offered in the last N days" must be 0 to 365.'] };
      value.audience = { preset: a.preset, statuses: [...new Set(a.statuses.map((s) => s.trim()).filter(Boolean))], type: a.type, city: a.city.trim(), contact: a.contact, skipDays: d };
    }
    if (!Number.isInteger(b.version) || b.version < 1) return { errors: ['Reload the offer and try again.'] };
    value.version = b.version;
    return { value, errors: [] };
  }
  /**
   * Who the offer goes to (Index.html upRows): rows { status, type, city, onRespond, email, phone, tenant, lastOffer (ms),
   * optedOut }. Opted-out clients are always left out.
   */
  function upsellAudience(rows, a, now) {
    const preset = { tenants: (r) => r.tenant, active: (r) => /active|qualif|late/i.test(r.status), past: (r) => /fail|unresp|disqual/i.test(r.status), all: () => true }[a.preset] || (() => true);
    const city = String(a.city || '').toLowerCase(), gap = (Number(a.skipDays) || 0) * 864e5;
    return rows.filter((r) => !r.optedOut && preset(r) && (!a.statuses.length || a.statuses.includes(r.status || UPSELL.blank)) && (!a.type || r.type === a.type)
      && (!city || String(r.city || '').toLowerCase().includes(city))
      && (a.contact === 'any' || (a.contact === 'respond' ? r.onRespond : a.contact === 'email' ? !!r.email : !!r.phone))
      && (!gap || !r.lastOffer || now - r.lastOffer >= gap));
  }

  // ---------- Deal files (Code.gs DEAL_SLOTS_ / dealTerm_ / apiDealUpload; Index.html deal tabs) ----------
  const DEAL_SLOTS = { clientLoi: 'LOI signed by the client', ownerLoi: 'LOI signed by the owner', contract: 'Signed contract (both parties)', deposit: 'Deposit slip', renewal: 'Renewal contract' };
  // which slots each lead tab shows (Index.html 6186)
  const DEAL_TAB_SLOTS = { loic: ['clientLoi'], loio: ['clientLoi', 'ownerLoi'], contract: ['clientLoi', 'ownerLoi', 'contract'], collection: ['contract', 'deposit'],
    active: ['clientLoi', 'ownerLoi', 'contract', 'deposit'], renewal: ['clientLoi', 'ownerLoi', 'contract', 'deposit', 'renewal'] };
  const DEAL_FILE_MAX = 15 * 1024 * 1024;
  const ymdAdd = (s, months, days) => { const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + months, d + days)); return t.toISOString().slice(0, 10); };
  /** Code.gs dealTerm_: start + months → { start, months, end (the day before the anniversary), renewFrom (2 months before it) }. */
  function dealTerm(start, months) {
    const n = Number(months);
    if (!isYmd(start)) return { errors: ['Enter the lease start date.'] };
    if (!Number.isInteger(n) || n < 1 || n > 240) return { errors: ['Lease months must be a whole number from 1 to 240.'] };
    return { value: { start, months: n, end: ymdAdd(start, n, -1), renewFrom: ymdAdd(start, n - 2, 0) }, errors: [] };
  }
  /** Index.html 6143: the deal tab a lead belongs in, from its files (renewal once a lease's renewal date has come). */
  function dealStageOf(rec, lease, today) {
    const s = (rec && rec.slots) || {};
    if (!s.clientLoi) return 'loic';
    if (!s.ownerLoi) return 'loio';
    if (!s.contract) return 'contract';
    if (!s.deposit) return 'collection';
    return lease && rec.term && rec.term.renewFrom && today >= rec.term.renewFrom ? 'renewal' : 'active';
  }

  // ---------- Service Requests (Code.gs apiServiceScan / apiGetServiceBoard / apiServiceUpdate / apiSaveSuppliers / apiSupplierSend) ----------
  const SERVICES = {
    keys: ['movers', 'cleaners', 'aircon', 'repairs', 'interiors', 'furniture', 'legal'],
    stages: ['New', 'Sent to supplier', 'Quoted', 'Client confirmed', 'Booked', 'Collected', 'Supplier paid', 'Done', 'Not proceeding'],
    interests: ['interested', 'asking', 'not interested', 'no reply'],
    detailKeys: ['date', 'area', 'from', 'to', 'unit', 'items', 'issue', 'budget', 'notes'],
    channels: ['whatsapp', 'viber', 'email', 'respond'],
    maxSuppliers: 60, offerDays: 120, rescanHours: 3, textMax: 4000,
  };
  const serviceLabel = (k) => (RENEWAL_TEMPLATES.find((t) => t.k === k) || { label: k }).label;
  /** Code.gs apiGetServiceBoard ref: SR-<last 5 of the lead>-<SVC>. */
  const serviceRef = (leadId, svc) => 'SR-' + String(leadId).slice(-5) + '-' + String(svc).slice(0, 3).toUpperCase();
  /** Index.html svSupplierText: the request a supplier gets — no client name, number or email. */
  function serviceSupplierText(r) {
    const det = SERVICES.detailKeys.filter((k) => r.details && r.details[k]).map((k) => '• ' + k.charAt(0).toUpperCase() + k.slice(1) + ': ' + r.details[k]).join('\n');
    const loc = [r.area, r.city].filter(Boolean).join(', ');
    return `Hi! New ${serviceLabel(r.svc)} request from Blackhouse — ref ${r.ref}\n` + (loc ? `Location: ${loc}\n` : '') + (r.summary ? `Request: ${r.summary}\n` : '') + (det ? det + '\n' : '')
      + '\nPlease send your quote and earliest schedule to us. Blackhouse handles coordination with the client, collection and payment.';
  }
  /** The service offers a client was sent: [{ kind, at }] → { svc: first sent ms } (the Concierge text offers every service). */
  function serviceOffers(sends) {
    const out = {};
    (sends || []).forEach((x) => (x.kind === 'concierge' ? SERVICES.keys : [x.kind]).forEach((k) => { if (SERVICES.keys.includes(k) && (!out[k] || x.at < out[k])) out[k] = x.at; }));
    return out;
  }
  /** Code.gs apiSaveSuppliers: the cleaned list (blank names dropped, at most 60). */
  function validateSuppliers(list) {
    if (!Array.isArray(list) || list.length > 200) return { errors: ['Invalid supplier list.'] };
    const out = [];
    for (const x of list) {
      if (!isPlainObject(x)) return { errors: ['Invalid supplier list.'] };
      const name = typeof x.name === 'string' ? x.name.trim() : '';
      if (!name) continue;
      const contact = typeof x.contact === 'string' ? x.contact.trim() : '', channel = SERVICES.channels.includes(x.channel) ? x.channel : 'whatsapp';
      if (!SERVICES.keys.includes(x.svc)) return { errors: [`Pick a service for ${name}.`] };
      if (name.length > 80 || contact.length > 120 || String(x.notes || '').length > 300) return { errors: [`${name}: a field is too long.`] };
      if (channel === 'email' && contact && !EMAIL_RE.test(contact)) return { errors: [`${name}: the email doesn't look valid.`] };
      if ((channel === 'whatsapp' || channel === 'viber') && contact && !/^[+\d\s()-]{7,20}$/.test(contact)) return { errors: [`${name}: the number can only contain digits, spaces, + ( ) -.`] };
      const respondId = String(x.respondId || '').replace(/\D/g, '').slice(0, 20);
      if (channel === 'respond' && !respondId) return { errors: [`${name}: a respond.io supplier needs its respond.io contact ID.`] };
      out.push({ id: /^[a-f0-9]{24}$/.test(String(x.id || '')) ? String(x.id) : '', svc: x.svc, name, channel, contact, respondId, notes: String(x.notes || '').trim().slice(0, 300) });
    }
    if (out.length > SERVICES.maxSuppliers) return { errors: [`At most ${SERVICES.maxSuppliers} suppliers.`] };
    return { value: out, errors: [] };
  }
  function validateServicePatch(b) {
    if (!isPlainObject(b) || Object.keys(b).some((k) => !['stage', 'interest', 'notes', 'version'].includes(k))) return { errors: ['Invalid request.'] };
    if (!Number.isInteger(b.version) || b.version < 1) return { errors: ['Reload and try again.'] };
    const v = { version: b.version };
    if (b.stage !== undefined) { if (!SERVICES.stages.includes(b.stage)) return { errors: ['Unknown stage.'] }; v.stage = b.stage; }
    if (b.interest !== undefined) { if (!SERVICES.interests.includes(b.interest)) return { errors: ['Unknown interest.'] }; v.interest = b.interest; }
    if (b.notes !== undefined) { if (typeof b.notes !== 'string' || b.notes.length > 500) return { errors: ['Notes: 500 characters at most.'] }; v.notes = b.notes.trim(); }
    if (Object.keys(v).length === 1) return { errors: ['Nothing to save.'] };
    return { value: v, errors: [] };
  }
  const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
  /**
   * A run of digits that is a phone number, not a date ("2026-11-05", "05/11/2026") or a range of amounts or sizes
   * ("15000-20000", "40-60"): those are what a supplier needs and must survive the redaction.
   */
  function isPhoneLike(m) {
    const t = String(m).trim();
    if (t.replace(/\D/g, '').length < 7) return false;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}(\s+\d{1,2})?$/.test(t) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}(\s+\d{1,2})?$/.test(t)) return false;
    const r = t.match(/^(\d{2,6})\s*-\s*(\d{2,6})$/);
    return !(r && r[1][0] !== '0' && Number(r[2]) > Number(r[1]) && Number(r[2]) <= Number(r[1]) * 5);
  }
  const scrubPhones = (s, mark) => s.replace(PHONE_RE, (m) => (isPhoneLike(m) ? mark : m));
  const hasPhone = (s) => (String(s).match(PHONE_RE) || []).some(isPhoneLike);
  /** Removes anything that looks like a phone number, email or link from AI text that goes to a supplier. */
  const stripContacts = (s) => scrubPhones(String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[removed]').replace(/https?:\/\/\S+/g, '[removed]'), '[removed]');
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // a name part as a pattern that matches it with or without accents ("María" ↔ "Maria")
  const ACC = { a: 'aàáâãäåā', e: 'eèéêëē', i: 'iìíîïī', o: 'oòóôõöō', u: 'uùúûüū', n: 'nñ', c: 'cç', y: 'yýÿ' };
  const namePattern = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').split('').map((ch) => (ACC[ch.toLowerCase()] ? '[' + ACC[ch.toLowerCase()] + ']' : reEsc(ch))).join('');
  const nameRe = (w, g) => new RegExp('(^|[^\\p{L}])' + namePattern(w) + '(?=$|[^\\p{L}])', g ? 'giu' : 'iu');
  const UNIT_RE = /\b(unit|rm|room|apt|apartment|suite|condo|flr|floor)\.?\s*(no\.?|number|#)?\s*([A-Za-z]?\d[\w-]*)/gi;
  /** The unit numbers a text mentions ("Unit 12B" → "12B", "#1203" → "1203"), to remove them wherever they reappear. */
  const unitsIn = (text) => [...String(text || '').matchAll(UNIT_RE)].map((m) => m[3]).concat([...String(text || '').matchAll(/#\s?(\d{1,5}[A-Za-z]?)\b/g)].map((m) => m[1]));
  /**
   * Client chat text made safe to send to the AI service (Service Requests "Check replies"): the client's name (whole
   * and each part), their email, phone and respond.io ID, any other email, phone number or link, and unit numbers
   * ("Unit 12B", "#1203", "Rm 5") are replaced, so none of it leaves the portal. client: { name, email, phone, contactId }.
   */
  function redactForAi(text, client) {
    const c = client || {};
    let s = String(text || '');
    // exact known identifiers first (before the generic patterns change their shape)
    [c.email, c.phone, c.contactId].filter((x) => String(x || '').trim().length >= 4).forEach((x) => { s = s.split(String(x).trim()).join('[id]'); });
    const digits = String(c.phone || '').replace(/\D/g, '');
    if (digits.length >= 7) s = s.replace(new RegExp(digits.slice(-7).split('').join('[\\s().-]*'), 'g'), '[phone]');
    s = scrubPhones(s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/(https?:\/\/|www\.)\S+/gi, '[link]'), '[phone]');
    // unit numbers: "Unit 12B", "#1203", and any the client mentioned before (c.units), even written bare ("12B")
    s = s.replace(UNIT_RE, '[unit]').replace(/#\s?\d{1,5}[A-Za-z]?\b/g, '[unit]');
    (c.units || []).filter((u) => String(u).length >= 2).forEach((u) => { s = s.replace(new RegExp('(^|[^\\w])' + reEsc(u) + '(?=$|[^\\w])', 'gi'), '$1[unit]'); });
    const name = String(c.name || '').trim();
    if (name) {
      const parts = [name].concat(name.split(/[\s,.]+/)).filter((w) => w.replace(/[^A-Za-zÀ-ɏ]/g, '').length >= 2);
      parts.sort((a, b) => b.length - a.length).forEach((w) => { s = s.replace(nameRe(w, true), '$1[client]'); });
    }
    return s;
  }
  /** True when text still holds one of the client's identifiers (for a last check of what the AI returned). */
  function leaksClient(text, client) {
    const c = client || {}, s = String(text || '');
    if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(s) || hasPhone(s)) return true;
    const digits = String(c.phone || '').replace(/\D/g, '');
    if (digits.length >= 7 && s.replace(/\D/g, '').includes(digits.slice(-7))) return true;
    if (c.contactId && String(c.contactId).length >= 4 && s.includes(String(c.contactId))) return true;
    if ((c.units || []).some((u) => String(u).length >= 2 && new RegExp('(^|[^\\w])' + reEsc(u) + '(?=$|[^\\w])', 'i').test(s))) return true;
    return String(c.name || '').split(/[\s,.]+/).filter((w) => w.replace(/[^A-Za-zÀ-ɏ]/g, '').length >= 3).some((w) => nameRe(w, false).test(s));
  }

  return { defaultSource, LISTS, AI_STAGES, TEMPS, MODULES, ROLES, EMAIL_RE, MIN_PASSWORD, LEAD_FIELDS, isYmd, access,
    askStage, approvalText, DEAL_SLOTS, DEAL_TAB_SLOTS, DEAL_FILE_MAX, dealTerm, dealStageOf, SERVICES, serviceLabel, serviceRef, serviceSupplierText, serviceOffers, validateSuppliers, validateServicePatch, stripContacts, redactForAi, leaksClient, unitsIn,
    UPSELL, upsellTemplates, upsellTag, upsellText, validateCampaign, upsellAudience, LOI_SETUP, LOI_SLOTS, LOI_FIELDS, numberWords, validateLoi, loiListing, loiDraft, dealStages,
    PROJECT, parseDriveLink, youtubeId, isHttpsUrl, validHook, toList, validateProject, mediaKind, driveProposal, isId24,
    vaKey, sameVa, vaLabels, LEAD_PLUS, dealFailed, vaWorkload, vaPerformance, KPI_REVIEW, manilaMonth, manilaDay, validPeriod, periodDays, kpiReviewValues, validateKpiFeedback, kpiReviewEmpty,
    validateLeadPatch, leadUpdateNote, validateNote, validateBooking, bookingLeadChanges, bookingNote,
    validateViewingPatch, validateAvailability, validateUser, validateTemplate,
    normPets, petWords, canonCity, citiesIn, filterListings, ASK, validateAsk, validateAskPatch, contactLinks, validateFailOverride, applyOverride,
    FEEDBACK_TAGS, RESULT, validateResult, pendingSince, viewingAt, portalPending, numOf, fbInfer, feedbackPrefs, applyFeedback,
    RENEWAL_TEMPLATES, PL_LINES, validatePlCell };
});
