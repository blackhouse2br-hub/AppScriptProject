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
    return { errors: ['Invalid request.'] };
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

  return { defaultSource, LISTS, AI_STAGES, TEMPS, MODULES, ROLES, EMAIL_RE, MIN_PASSWORD, LEAD_FIELDS, isYmd, access,
    validateLeadPatch, leadUpdateNote, validateNote, validateBooking, bookingLeadChanges, bookingNote,
    validateViewingPatch, validateAvailability, validateUser, validateTemplate,
    normPets, petWords, canonCity, citiesIn, filterListings, ASK, validateAsk, validateAskPatch, contactLinks, validateFailOverride, applyOverride,
    FEEDBACK_TAGS, RESULT, validateResult, pendingSince, viewingAt, portalPending, numOf, fbInfer, feedbackPrefs, applyFeedback };
});
