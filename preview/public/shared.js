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
    availability: ['Available', 'Reserved', 'Not Available'],
    viewingStatuses: ['Proposed', 'Confirmed', 'Done', 'Cancelled'],
    nationalities: ['Filipino', 'Korean', 'Japanese', 'American', 'Australian', 'Chinese', 'Singaporean', 'British'],
    failReasons: ['Budget too low', 'Found another unit', 'No longer moving', 'Not responsive'],
  };
  // from the original Index.html
  const AI_STAGES = ['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection', 'Active', 'For Renewal', 'Failed', 'Not on Respond.io'];
  const TEMPS = ['Hot', 'Warm', 'Cold', 'Lost', 'Dead', 'Not on Respond.io', 'Active'];
  const MODULES = ['leads', 'vaportal', 'monitor', 'calendar', 'invdash', 'ldash', 'brokers', 'renewals', 'upsell', 'daily', 'services', 'pages', 'pl', 'team'];
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
  };
  const TEXT_MAX = { name: 120, phone: 20, email: 120, nationality: 60, requirements: 500 };

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
  /** Booking the first viewing moves a lead from Property Matching to Scheduling. */
  const bookingLeadChanges = (lead) => lead.ai === 'Property Matching' ? { ai: 'Scheduling', status: 'For Viewing', daysInStage: 0 } : {};
  const bookingNote = (listingCode, date, time) => `Viewing proposed: ${listingCode} on ${date} ${time}`;

  function validateViewingPatch(p) {
    if (!isPlainObject(p)) return { errors: ['Invalid request.'] };
    const value = {};
    if ('status' in p) { if (!LISTS.viewingStatuses.includes(p.status)) return { errors: ['Unknown viewing status.'] }; value.status = p.status; }
    if ('feedback' in p) { if (typeof p.feedback !== 'string') return { errors: ['Feedback must be text.'] }; value.feedback = p.feedback.trim().slice(0, 500); }
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
   */
  function validateUser(u, opts) {
    const vaAllowed = (opts && opts.vaLabels) || LISTS.vas;
    if (!isPlainObject(u)) return { errors: ['Invalid request.'] };
    const name = typeof u.name === 'string' ? u.name.trim() : '', email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
    if (!name || name.length > 80) return { errors: ['Name is required (80 characters max).'] };
    if (!EMAIL_RE.test(email) || email.length > 120) return { errors: ['Enter a valid email.'] };
    if (!ROLES.includes(u.role)) return { errors: ['Pick a role.'] };
    const vaLabel = u.role === 'VA' ? u.vaLabel : '';
    if (u.role === 'VA' && (typeof vaLabel !== 'string' || !vaAllowed.includes(vaLabel))) return { errors: ['Pick the VA label this person uses on Monday.'] };
    const modules = {};
    if (u.modules !== undefined && !isPlainObject(u.modules)) return { errors: ['Invalid module access.'] };
    for (const [k, a] of Object.entries(u.modules || {})) {
      if (!MODULES.includes(k) || !['none', 'view', 'edit'].includes(a)) return { errors: ['Invalid module access.'] };
      if (a !== 'none') modules[k] = a;
    }
    const value = { name, email, role: u.role, vaLabel: vaLabel || '', modules };
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

  return { LISTS, AI_STAGES, TEMPS, MODULES, ROLES, EMAIL_RE, MIN_PASSWORD, LEAD_FIELDS, isYmd, access,
    validateLeadPatch, leadUpdateNote, validateNote, validateBooking, bookingLeadChanges, bookingNote,
    validateViewingPatch, validateAvailability, validateUser, validateTemplate };
});
