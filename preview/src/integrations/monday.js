'use strict';
// Monday.com client. Column matching follows Code.gs (FIELD_DEFS, LISTING_TITLES, calendarViewings_, loiMap_):
// columns are found by TITLE on each board, so no column IDs are hard-coded.
// Reads (gql) can only send GraphQL `query` operations; mutations are refused before any request is made.
// The single exception is writeColumn(): one fixed single-column mutation, used only for the allowlisted actions in
// mondayWrite.js, only when MONDAY_WRITES=on, and checked again by assertAllowedWrite() right before it is sent.
const { IntegrationError, tracked } = require('./status');
const { canonCity, normPets } = require('../../public/shared');

// from Code.gs CONFIG.HIDE and CONFIG.LISTING_SKIP_GROUPS
const HIDE = ['Archive', 'Archived', 'For Validation', 'Broker Inquiries', 'Messaged Brokers for Viber', 'Copied to Broker Partnerships',
  'Relocation Specialists', 'Social Media Content', 'Email Marketing Inquiries'];
const LISTING_SKIP_GROUPS = ['archive', 'property rented out', 'clean up', 'office space', 'do not post'];

// subset of Code.gs FIELD_DEFS used by the preview: key → [titles in priority order, exact-only, allowed column types]
const LEAD_COLS = {
  nextAction: [['next action', 'status'], false, ['status', 'color', 'dropdown', 'text']],
  boardStatus: [['status'], true, ['status', 'color', 'dropdown']],
  va: [['va assigned', 'va assinged', 'assigned va', 'va']],
  leadsFrom: [['leads from', 'lead source', 'source']],
  inquiry: [['inquiry type', 'rent or buy', 'buy or rent', 'transaction type'], true],
  clientStatus: [['client status'], true],
  contactName: [['contact name', 'client name']],
  phone: [['contact phone number', 'contact phone', 'phone number', 'phone']],
  email: [['email', 'contact email', 'email address']],
  location: [['preferred location', 'location', 'client requirements']],
  city: [['city', 'preferred city'], true],
  budget: [['budget', 'maximum budget']],
  bedrooms: [['number of bedrooms', 'no of bedrooms', 'bedrooms']],
  occupancy: [['number of occupancy', 'no of occupants', 'occupancy', 'occupants']],
  moveIn: [['target move in date', 'target move-in date', 'move in date', 'move-in date']],
  leaseTerm: [['lease term']],
  pets: [['pets']],
  otherReqs: [['other requirements'], true],
  // Property Requirements report (exact titles only, so they never take another column)
  building: [['specific building', 'preferred building', 'building name', 'building'], true],
  sqm: [['sqm', 'preferred sqm', 'floor area', 'unit size', 'size'], true],
  bathrooms: [['number of bathrooms', 'no of bathrooms', 'bathrooms', 'bathroom'], true],
  parking: [['parking', 'parking slot', 'parking slots', 'no of parking'], true],
  furnishing: [['furnishing', 'furnished', 'furnished unfurnished'], true],
  failReason: [['reason for failure'], true],
  inquiryDate: [['date of inquiry', 'inquiry date', 'date inquired']],
  failedDate: [['failed date', 'date failed', 'lost date'], true],
  contractDate: [['contract date'], true],
  nationality: [['nationality'], true],
  salesperson: [['salesperson'], true],
  aiStatusLabel: [['ai status'], true, ['status', 'color']],
  aiStatusText: [['ai status', 'ai status detail'], true, ['text', 'long_text']],
  contactId: [['respond id', 'respond io id', 'respondio id', 'respond io contact id', 'respond contact id', 'contact id']],
};
// subset of Code.gs LISTING_TITLES (prefix matching only for titles longer than 3 characters, as in Code.gs)
const LISTING_COLS = {
  location: ['location', 'city', 'area', 'address', 'building location', 'neighborhood', 'district'],
  building: ['building name', 'building', 'project', 'condo', 'property name', 'development'],
  type: ['listing type', 'offer type', 'for rent sale', 'rent sale', 'transaction', 'type', 'category'],
  bedrooms: ['bedrooms', 'of bedrooms', 'bedroom', 'number of bedrooms', 'no of bedrooms', 'br', 'unit type'],
  bathrooms: ['bathrooms', 'of bathrooms', 'bathroom', 'number of bathrooms', 't b', 'toilet and bath', 'baths'],
  sqm: ['sqm', 'floor area', 'size', 'area sqm', 'floor area sqm', 'unit size'],
  parking: ['parking', 'parking slot', 'parking slots', 'number of parking'],
  price: ['price', 'monthly rent', 'rent', 'rental', 'rate', 'asking price', 'selling price', 'list price'],
  furnishing: ['furnishing', 'furnished', 'furniture'],
  pets: ['pet friendly', 'pets allowed', 'pets', 'pet'],
  unit: ['floor unit', 'floor unit no', 'unit no', 'unit number'],
  status: ['availability', 'status', 'unit status'],
  photos: ['photos', 'images', 'pictures', 'photo', 'gallery'],
  ownerPhone: ['owner number', 'owner phone', 'owner contact', 'owner mobile', 'contact number', 'mobile number', 'mobile', 'whatsapp', 'whatsapp number', 'phone', 'phone number', 'contact'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SKIP_TYPES = { name: 1, subtasks: 1 };

function matchLeadCols(columns) {
  const used = {}, out = {};
  for (const [key, [titles, exact, types]] of Object.entries(LEAD_COLS)) {
    const ok = (c) => !used[c.id] && !SKIP_TYPES[c.type] && (!types || types.includes(c.type));
    const wanted = titles.map(norm);
    let col = null;
    for (let i = 0; i < wanted.length && !col; i++) col = columns.find((c) => ok(c) && norm(c.title) === wanted[i]);
    if (!col && !exact) col = columns.find((c) => ok(c) && wanted.some((w) => norm(c.title).startsWith(w)));
    if (col) { out[key] = col.id; used[col.id] = 1; }
  }
  return out;
}
function matchListingCols(columns) {
  const used = {}, out = {};
  for (const [key, titles] of Object.entries(LISTING_COLS)) {
    const wanted = titles.map(norm), ok = (c) => !used[c.id] && !SKIP_TYPES[c.type] && (key !== 'photos' || c.type === 'file');
    const c = columns.find((x) => ok(x) && wanted.includes(norm(x.title))) || columns.find((x) => ok(x) && wanted.some((w) => w.length > 3 && norm(x.title).startsWith(w)));
    if (c) { out[key] = c.id; used[c.id] = 1; }
  }
  return out;
}
// Calendar: viewings (calendarViewings_) + LOI/contract evidence (loiMap_)
function matchCalendarCols(columns) {
  const find = (re, type) => { const c = columns.find((x) => re.test(String(x.title).trim()) && (!type || x.type === type)); return c ? c.id : ''; };
  const out = { fin: find(/^final schedule$/i, 'date'), client: find(/^clients?$/i, 'board_relation'), bld: find(/^building$/i), city: find(/^city$/i),
    time: find(/^time$/i), broker: find(/^salesperson$/i), status: find(/^status$/i),
    loi: find(/^date loi\s+submitted$/i, 'date'), loi2: find(/^loi creation date$/i, 'date'), file: find(/^loi$/i, 'file'),
    cdate: find(/^contract date$/i), cfile: find(/^contract$/i, 'file'), sfile: find(/^signed contract$/i, 'file'), paid: find(/^total paid$/i),
    // deals, commission and leases (Code.gs brokerCalendar_), read only: Leads Report, Renewals, P&L, Broker Management.
    // "Type" is the dropdown (the board also has a text column titled "Type").
    rate: find(/^rental rate$/i), price: find(/^monthly contract price$/i), comm: find(/^blackhouse commission$/i), ded: find(/^deductions$/i),
    pay: find(/^date of payment$/i, 'date'), coll: find(/^collection date$/i, 'date'), exp: find(/^contract expiration date$/i, 'date'),
    rdate: find(/^renewal date$/i, 'date'), rst: find(/^renewal status$/i, 'status'), ctype: find(/^type$/i, 'dropdown') };
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}
/**
 * One Calendar item as a deal / lease row (Code.gs brokerCalendar_), for every item — with or without a Final Schedule.
 * Amounts and dates only; no client name (the client is the linked Direct Clients item).
 */
function shapeDeal(it, cols) {
  const v = values(it, cols), rel = v._client && v._client.linked_item_ids;
  return { id: String(it.id), leadId: rel && rel[0] ? String(rel[0]) : '', group: (it.group && it.group.title) || '',
    fin: ymdIn(v.fin), sp: v.broker, status: v.status, type: v.ctype || '', rst: v.rst || '', rdate: ymdIn(v.rdate), exp: ymdIn(v.exp),
    contract: ymdIn(v.cdate), loi: ymdIn(v.loi) || ymdIn(v.loi2), pay: ymdIn(v.pay), coll: ymdIn(v.coll),
    rate: money(v.rate), price: money(v.price), comm: money(v.comm), paid: money(v.paid), ded: money(v.ded),
    building: String(v.bld || '').split(',')[0].trim(), city: String(v.city || '').split(',')[0].trim(),
    // whether the LOI / Contract / Signed Contract file columns hold a file (the files themselves are not read)
    files: { loi: !!String(v.file || '').trim(), contract: !!String(v.cfile || '').trim(), signed: !!String(v.sfile || '').trim() } };
}
/** Status/dropdown label names from a column's settings_str (Code.gs statusOptions_). */
function labelsOf(col) {
  if (!col) return [];
  try {
    const s = JSON.parse(col.settings_str || '{}'), l = s.labels || {};
    const names = Array.isArray(l) ? l.map((x) => x && x.name) : Object.keys(l).sort((a, b) => Number(a) - Number(b)).map((k) => l[k]);
    return [...new Set(names.map((x) => String(x || '').trim()).filter(Boolean))];
  } catch (e) { return []; }
}

// ---------- value helpers ----------
const cellText = (cv) => (cv ? String(cv.display_value || cv.text || '').trim() : '');
function values(item, cols) {
  const byId = {}; (item.column_values || []).forEach((cv) => { byId[cv.id] = cv; });
  const v = {};
  Object.entries(cols).forEach(([k, id]) => { v[k] = cellText(byId[id]); v['_' + k] = byId[id]; });
  return v;
}
const fileIds = (cv) => { try { return ((JSON.parse((cv && cv.value) || '{}') || {}).files || []).map((f) => String(f.assetId || '')).filter(Boolean); } catch (e) { return []; } };
/** Budget/price text → number: "₱150k", "150,000", "20M"; a range takes the upper value (data-points.xlsx "Lead value"). */
function money(t) {
  const s = String(t || '').toLowerCase().replace(/[,₱\s]|php/g, '');
  const all = [...s.matchAll(/(\d*\.?\d+)([km])?/g)].map((m) => parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
  return all.length ? Math.round(Math.max(...all)) : 0;
}
const ymdIn = (t) => (String(t || '').match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
const beds = (t) => /studio/i.test(t) ? 'Studio' : ((String(t || '').match(/\d+/) || [])[0] || String(t || ''));
function time24(t) {
  const m = String(t || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return '';
  let h = Number(m[1]); const min = m[2] || '00', ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return h < 24 ? String(h).padStart(2, '0') + ':' + min : '';
}
const hue = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 360; };

/** Raw lead record; AI Status / Temperature / Days are added later by pipeline.computeLead. */
function shapeLead(it, cols) {
  const v = values(it, cols), group = (it.group && it.group.title) || '';
  const inquiry = /buy|sale|purchase/i.test(v.inquiry) ? 'Buy' : /rent|lease/i.test(v.inquiry) ? 'Rent'
    : /sale|buy/i.test(group) ? 'Buy' : /rent|lease/i.test(group) ? 'Rent' : '';
  const contactId = v.contactId.replace(/\D/g, '');
  return {
    id: String(it.id), code: it.name, mondayItemId: String(it.id), group,
    name: v.contactName || it.name, phone: v.phone, email: v.email,
    status: v.clientStatus || v.nextAction || '', nextAction: v.nextAction, boardStatus: v.boardStatus, clientStatus: v.clientStatus,
    aiStatusLabel: v.aiStatusLabel, aiStatusText: v.aiStatusText,
    ai: '', temp: '', waiting: '',
    // inquiryLabel / budgetText keep Monday's own text (inquiry and budget are normalised), for the allowlisted updates
    inquiry, inquiryLabel: v.inquiry, va: v.va, salesperson: v.salesperson, source: v.leadsFrom,
    origin: /respond/i.test(v.leadsFrom) ? 'respond.io' : 'Monday',
    budget: money(v.budget), budgetText: v.budget, city: v.city || '', bedrooms: beds(v.bedrooms), occupants: v.occupancy,
    // only a clear answer becomes No Pets / With Pets; "Not Applicable", N/A, blanks and anything else stay '' (Not specified)
    pets: normPets(v.pets),
    requirements: [v.location, v.otherReqs].filter(Boolean).join('; ').slice(0, 500),
    location: v.location, building: v.building, sqm: v.sqm, bathrooms: v.bathrooms, parking: v.parking, furnishing: v.furnishing,
    nationality: v.nationality, moveIn: ymdIn(v.moveIn), leaseTerm: v.leaseTerm, failReason: v.failReason, leaseEnd: '',
    inquiryDate: ymdIn(v.inquiryDate), failedDate: ymdIn(v.failedDate), contractDate: ymdIn(v.contractDate),
    createdAt: it.created_at || '', updatedAt: it.updated_at || it.created_at || '',
    daysInStage: null, onRespond: !!contactId, contactId,
  };
}
function shapeListing(it, cols) {
  const v = values(it, cols), group = (it.group && it.group.title) || '';
  let phone = v.ownerPhone;
  try { const j = JSON.parse((v._ownerPhone && v._ownerPhone.value) || 'null'); if (j && j.phone) phone = j.phone; } catch (e) { /* plain text */ }
  // photos: files in the photos column first, then any other image asset on the item (Code.gs shapeListing_)
  const IMG = /^(jpe?g|png|gif|webp)$/i;
  const order = fileIds(v._photos);
  const assets = (it.assets || []).filter((a) => IMG.test(String(a.file_extension || '').replace(/^\./, '')))
    .sort((a, b) => { const ia = order.indexOf(String(a.id)), ib = order.indexOf(String(b.id)); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
  const st = v.status;
  return {
    id: String(it.id), code: String(it.id), building: v.building || it.name, tower: v.unit ? (/^unit\b/i.test(String(v.unit).trim()) ? String(v.unit).trim() : 'Unit ' + v.unit) : '',   // never "Unit Unit 5A" (Code.gs apiLoiDefaults) floor: null,
    // one city per listing ("Taguig", "BGC" and a BGC tower with no City all become "Taguig (BGC)"); cityRaw keeps Monday's text
    city: canonCity(v.location, v.building) || 'City not set', cityRaw: v.location,
    type: /sale|sell|buy/i.test(v.type + ' ' + group) ? 'For Sale' : 'For Rent', price: money(v.price),
    bedrooms: beds(v.bedrooms), bathrooms: parseInt(v.bathrooms, 10) || 0, sizeSqm: parseFloat(v.sqm) || 0, furnishing: v.furnishing,
    parking: !!v.parking && !/^(0|no|none)$/i.test(v.parking), petFriendly: /yes|allow|friendly|ok/i.test(v.pets) && !/^no/i.test(v.pets),
    availability: !st || /^avail/i.test(st) ? 'Available' : /reserv|hold|pending/i.test(st) ? 'Reserved' : 'Not Available', availabilityLabel: st,
    contact: it.name, contactPhone: phone, hue: hue(it.id), group,
    photos: assets.slice(0, 12).map((a) => String(a.id)),   // asset IDs only; the browser loads them through /api/monday/photo
    _assets: assets.slice(0, 12),
  };
}
function viewingStatus(label, date, today) {
  if (/cancel/i.test(label)) return 'Cancelled';
  // a result is recorded (Failed, Under Negotiations after an LOI): the viewing happened
  if (/done|viewed|complete|loi|contract|closed|fail|negotiat/i.test(label)) return 'Done';
  if (/confirm/i.test(label)) return 'Confirmed';
  if (/propos|pending|tentative/i.test(label)) return 'Proposed';
  return date < today ? 'Done' : 'Confirmed';
}
/**
 * One Calendar-board item as a viewing, or null without a Final Schedule date. group / loi / contract feed the
 * Pending Broker Feedback rules (Code.gs pendingFeedback_); no client details are taken from the Calendar board.
 */
function shapeViewing(it, cols, today) {
  const v = values(it, cols), group = (it.group && it.group.title) || '';
  const rel = v._client && v._client.linked_item_ids, lead = rel && rel[0] ? String(rel[0]) : '';
  const date = ymdIn(v.fin);
  if (!date) return null;
  return { id: String(it.id), leadId: lead, listingId: '', building: v.bld.split(',')[0].trim(), city: v.city.split(',')[0].trim(),
    date, time: time24(v.time), broker: v.broker, status: viewingStatus(v.status, date, today), statusLabel: v.status, feedback: '',
    group, loi: ymdIn(v.loi) || ymdIn(v.loi2), loiCreated: ymdIn(v.loi2), contract: ymdIn(v.cdate) };
}

// ---------- client ----------
const COL_FIELDS = 'id text value ... on MirrorValue { display_value } ... on BoardRelationValue { linked_item_ids }';
const ITEM_FIELDS = `id name created_at updated_at group { id title } column_values(ids: $c) { ${COL_FIELDS} }`;
const LISTING_FIELDS = `id name created_at updated_at group { id title } assets { id public_url url_thumbnail file_extension } column_values(ids: $c) { ${COL_FIELDS} }`;
const MAX_ITEMS = 5000, TTL_MS = 5 * 60e3, MIN_REFRESH_MS = 30e3, PHOTO_URL_TTL = 40 * 60e3, PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
/** Image type from a file's first bytes (JPEG, PNG, GIF, WebP); '' for anything else. */
function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

function assertReadOnly(query) {
  if (!/^\s*query\b/.test(query) || /\b(mutation|subscription)\b/i.test(query)) {
    throw new IntegrationError('monday', 'Blocked: only read queries are allowed in this phase.', { status: 500 });
  }
}

// The ONE mutation the portal can send: one value into one column of one item. Nothing else (no create, delete, move,
// archive, updates, files, several columns at once). Which board, column and value is decided by mondayWrite.js.
const WRITE_MUTATION = 'mutation ($b: ID!, $i: ID!, $c: String!, $v: String) { change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $v) { id } }';
/**
 * Second, independent guard right before a write is sent: the exact mutation text above, exactly the four variables,
 * a configured Leads, Listings or Calendar board, a numeric item, a plain column id and a short one-line value.
 * (Which columns of the Calendar board: only those viewingResult.js allows — a viewing's Status, LOI Creation Date and
 * the optional configured feedback column.)
 */
function assertAllowedWrite(query, variables, boards) {
  const v = variables || {}, keys = Object.keys(v).sort().join(','), b = boards || {};
  const ok = query === WRITE_MUTATION && keys === 'b,c,i,v'
    && [b.leads, b.listings, b.calendar].filter(Boolean).includes(v.b) && /^\d{1,20}$/.test(String(v.i)) && /^[a-z0-9_]{1,64}$/.test(String(v.c))
    && typeof v.v === 'string' && v.v.length <= 200 && !/[\r\n]/.test(v.v);
  if (!ok) throw new IntegrationError('monday', 'Blocked: this Monday change is not on the allowed list.', { status: 500 });
}

function createMonday(cfg, status, { now = Date.now } = {}) {
  const mockApi = /^http:\/\/(127\.0\.0\.1|localhost):/.test(cfg.apiUrl);

  /** Reads: queries only (the global read-only guard). */
  async function gql(query, variables) {
    assertReadOnly(query);
    return send(query, variables);
  }
  /**
   * The only write path: the fixed single-column mutation, after both guards (mondayWrite.js allowlist, then
   * assertAllowedWrite). Called only from an explicit user action; nothing in the app writes on its own.
   */
  async function writeColumn({ board, itemId, columnId, value }) {
    if (!cfg.writes) throw new IntegrationError('monday', 'Monday updates are switched off on this server (MONDAY_WRITES).', { status: 409, countsAsFailure: false });
    const variables = { b: cfg.boards[board], i: String(itemId), c: String(columnId), v: String(value) };
    assertAllowedWrite(WRITE_MUTATION, variables, cfg.boards);
    // Monday's error text may echo the submitted value: it is replaced before the status, the reply or the audit see it
    const hide = (m) => [variables.v, JSON.stringify(variables.v).slice(1, -1)].filter(Boolean).reduce((s, x) => s.split(x).join('[value]'), String(m));
    const d = await tracked(status, async () => {
      try { return await send(WRITE_MUTATION, variables); } catch (e) {
        throw new IntegrationError('monday', hide(e.message), { status: e.httpStatus || 502, countsAsFailure: e.countsAsFailure !== false });
      }
    });
    const done = d.change_simple_column_value;
    if (!done || String(done.id) !== variables.i) throw new IntegrationError('monday', 'Monday.com did not confirm the change.');
    return { id: String(done.id) };
  }
  // the token never appears in a message (e.g. a fetch error quoting a malformed header)
  const scrub = (s) => (cfg.token ? String(s).split(cfg.token).join('***') : String(s));
  async function send(query, variables) {
    let res;
    try {
      res = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: cfg.token },
        body: JSON.stringify({ query, variables: variables || {} }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // only a known error code is reported: a fetch message may quote the request (token header, submitted values)
      const code = e && e.cause && /^[A-Z][A-Z0-9_]{1,40}$/.test(String(e.cause.code)) ? e.cause.code : 'network error';
      throw new IntegrationError('monday', 'Could not reach Monday.com (' + (e.name === 'TimeoutError' ? 'timed out' : code) + ').');
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 401 || res.status === 403) throw new IntegrationError('monday', `Monday.com rejected MONDAY_TOKEN (HTTP ${res.status}).`);
    if (res.status === 429) throw new IntegrationError('monday', 'Monday.com is rate-limiting requests. Try again in a minute.');
    if (!body) throw new IntegrationError('monday', `Monday.com returned HTTP ${res.status}.`);
    if (res.status !== 200 || body.errors || body.error_message) {
      const msg = (body.errors && body.errors.map((e) => e.message).join('; ')) || body.error_message || 'HTTP ' + res.status;
      throw new IntegrationError('monday', 'Monday.com: ' + scrub(msg));
    }
    return body.data || {};
  }

  async function boardMeta(boardId) {
    const d = await gql('query ($b: [ID!]) { boards(ids: $b) { id name items_count columns { id title type settings_str } } }', { b: [boardId] });
    const b = (d.boards || [])[0];
    if (!b) throw new IntegrationError('monday', `Monday board ${boardId} was not found, or the MONDAY_TOKEN user can't see it.`);
    return b;
  }
  // page size: 500 (Monday's maximum, as Code.gs used for leads/calendar); 200 for listings, whose asset data is heavier
  // progress (optional): { read, total } updated after each page, so the page can show how far a long load has got
  async function allItems(boardId, colIds, fields = ITEM_FIELDS, pageSize = 500, progress = null) {
    const first = await gql(`query ($b: [ID!], $c: [String!]) { boards(ids: $b) { items_page(limit: ${pageSize}) { cursor items { ${fields} } } } }`, { b: [boardId], c: colIds });
    let page = ((first.boards || [])[0] || {}).items_page || { items: [] };
    const out = [...(page.items || [])];
    if (progress) progress.read = out.length;
    while (page.cursor && out.length < MAX_ITEMS) {
      page = (await gql(`query ($k: String!, $c: [String!]) { next_items_page(limit: ${pageSize}, cursor: $k) { cursor items { ${fields} } } }`, { k: page.cursor, c: colIds })).next_items_page || {};
      out.push(...(page.items || []));
      if (progress) progress.read = out.length;
    }
    return out.slice(0, MAX_ITEMS);
  }
  const startProgress = (p, meta) => { if (p) { p.total = Number(meta.items_count) || null; p.read = 0; } };

  const loaders = {
    async leads(id, p) {
      const meta = await boardMeta(id), cols = matchLeadCols(meta.columns);
      startProgress(p, meta);
      const hide = HIDE.map(norm);
      const leads = (await allItems(id, Object.values(cols), ITEM_FIELDS, 500, p)).map((it) => shapeLead(it, cols))
        .filter((l) => !hide.includes(norm(l.group)) && !hide.includes(norm(l.nextAction)));
      const colById = Object.fromEntries(meta.columns.map((c) => [c.id, c]));
      // VA Assigned / Salesperson labels as set up on the board (Code.gs statusOptions_), plus any value in use
      const used = (k) => leads.map((l) => l[k]).filter(Boolean);
      const labels = {
        va: [...new Set(labelsOf(colById[cols.va]).concat(used('va')))],
        salesperson: [...new Set(labelsOf(colById[cols.salesperson]).concat(used('salesperson')))],
        vaColumn: !!cols.va, salespersonColumn: !!cols.salesperson,
      };
      return { leads, labels, mapped: Object.keys(cols) };
    },
    async listings(id, p) {
      const meta = await boardMeta(id), cols = matchListingCols(meta.columns);
      startProgress(p, meta);
      const listings = (await allItems(id, Object.values(cols), LISTING_FIELDS, 200, p)).map((it) => shapeListing(it, cols))
        .filter((x) => !LISTING_SKIP_GROUPS.includes(norm(x.group)));
      const assets = new Map(), at = Date.now();
      listings.forEach((x) => { x._assets.forEach((a) => assets.set(String(a.id), { listingId: x.id, url: a.public_url, at })); delete x._assets; });
      return { listings, assets };
    },
    async calendar(id, p) {
      const meta = await boardMeta(id), cols = matchCalendarCols(meta.columns);
      if (!cols.fin) throw new IntegrationError('monday', `Calendar board ${id} has no "Final Schedule" date column.`);
      startProgress(p, meta);
      const items = await allItems(id, Object.values(cols), ITEM_FIELDS, 500, p);
      const today = new Date().toISOString().slice(0, 10), viewings = [], lm = {}, deals = [];
      items.forEach((it) => {
        const v = values(it, cols), group = (it.group && it.group.title) || '';
        const rel = v._client && v._client.linked_item_ids, lead = rel && rel[0] ? String(rel[0]) : '';
        const shaped = shapeViewing(it, cols, today);
        if (shaped) viewings.push(shaped);
        deals.push(shapeDeal(it, cols));
        // LOI / contract evidence per client (Code.gs loiMap_): Failed/Archive rows and Status Failed are skipped
        if (!lead || /failed|archive/i.test(group) || /fail/i.test(v.status || '')) return;
        const o = lm[lead] = lm[lead] || { d: '', ds: '', dc: '', cd: '', files: 0, cfiles: 0, sfiles: 0, paid: 0, booked: 0 };
        const created = Date.parse(it.created_at || '') || 0;
        if (created && (!o.booked || created < o.booked)) o.booked = created;   // first Calendar item = first viewing booked
        const ds = ymdIn(v.loi), dc = ymdIn(v.loi2), cd = ymdIn(v.cdate);
        if (ds > o.ds) o.ds = ds; if (dc && (!o.dc || dc < o.dc)) o.dc = dc; if ((ds || dc) > o.d) o.d = ds || dc; if (cd > o.cd) o.cd = cd;
        o.files += fileIds(v._file).length; o.cfiles += fileIds(v._cfile).length; o.sfiles += fileIds(v._sfile).length;
        o.paid += money(v.paid);
      });
      // the Calendar board's own Salesperson labels (and any value in use): what a broker's label must match exactly
      const spCol = meta.columns.find((c) => c.id === cols.broker);
      const salesperson = [...new Set(labelsOf(spCol).concat(viewings.map((x) => x.broker).filter(Boolean)))];
      return { viewings, lm, salesperson, deals };
    },
  };
  const BOARD_OF = { leads: 'leads', listings: 'listings', calendar: 'calendar' };

  /*
   * Server memory only: nothing from Monday is written to MongoDB, and the page keeps it only in memory too.
   * One request in flight per board. The first load is waited for; a failure means that board has no data (never
   * substituted). After that the last successful copy is served while a newer one loads in the background, and a
   * failed refresh keeps that copy, records the error and its time, and waits MIN_REFRESH_MS before retrying on its own.
   * Each copy carries the time its read *started*, so data read over several minutes never looks newer than it is.
   */
  const cache = new Map();
  const entry = (key) => {
    if (!cache.has(key)) cache.set(key, { value: null, readFrom: 0, at: 0, pending: null, error: '', failedAt: 0 });
    return cache.get(key);
  };
  function refresh(e, fn) {
    if (e.pending) return e.pending;
    const startedAt = now();
    e.progress = { read: 0, total: null, startedAt };
    const p = tracked(status, () => fn(e.progress)).then(
      (value) => {
        try { keepPatches(e, value, startedAt); } catch (err) { /* never leaves the board stuck "refreshing" */ }
        // a change the portal made after this read started still needs a fresh read (e.g. the clients' LOI evidence)
        Object.assign(e, { value, readFrom: startedAt, at: now(), error: '', failedAt: 0, pending: null, patches: new Map(), stale: !!(e.stale && e.staleAt >= startedAt) });
      },
      (err) => { Object.assign(e, { error: err.message, failedAt: now(), pending: null, patches: new Map() }); throw err; });
    p.catch(() => {});   // a background refresh reports through e.error; a first load rethrows to its caller
    e.pending = p;
    return p;
  }
  /** Items re-read after a write while this board read was running are newer than what it read: keep them. */
  function keepPatches(e, value, startedAt) {
    for (const [id, p] of e.patches || []) {
      if (!(p.at >= startedAt && value && value[p.list])) continue;
      value[p.list] = value[p.list].map((x) => (x.id === id ? p.rec : x));   // replaces only items the read still lists
      if (p.assets && value.assets) p.assets.forEach(([k, v]) => value.assets.set(k, v));   // its photos stay viewable
    }
  }
  function due(e, force) {
    if (e.pending) return false;
    const t = now(), backoff = e.failedAt && t - e.failedAt < MIN_REFRESH_MS;
    if (!e.value) return !backoff;
    if (e.stale && !backoff) return true;   // an item was changed on Monday by the portal: reload in the background
    return force ? t - e.at >= MIN_REFRESH_MS : t - e.at >= TTL_MS && !backoff;
  }
  async function cached(key, force, fn) {
    const e = entry(key);
    if (!e.value) { await refresh(e, fn); return e; }
    if (due(e, force)) refresh(e, fn);   // not awaited: the last good copy is returned now
    return e;
  }
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  /** What the page needs to label a board's data honestly (no data values). */
  const meta = (e) => ({
    loaded: !!e.value, fetchedAt: iso(e.readFrom), loadedAt: iso(e.at), refreshing: !!e.pending,
    progress: e.pending && e.progress ? { read: e.progress.read, total: e.progress.total, startedAt: iso(e.progress.startedAt) } : null,
    refreshError: e.value && e.error ? e.error : '', refreshFailedAt: e.value && e.error ? iso(e.failedAt) : null,
  });
  const boardList = () => Object.keys(BOARD_OF).map((ds) => ({ ds, name: ds === 'calendar' ? 'viewings' : ds, boardId: cfg.boards[BOARD_OF[ds]] }));
  const summary = (boards) => {
    const times = Object.values(boards).map((b) => b.fetchedAt).filter(Boolean).sort();
    return { boards, fetchedAt: times[0] || null, refreshing: Object.values(boards).some((b) => b.refreshing), staleAfterMs: TTL_MS };
  };

  /** Loads every configured board; each one succeeds or reports its own error (never substituted). */
  async function loadAll(force) {
    const raw = {}, errors = {}, notConfigured = [], boards = {};
    await Promise.all(boardList().map(async ({ ds, name, boardId }) => {
      if (!boardId) { notConfigured.push(name); return; }
      const key = ds + ':' + boardId;
      try { raw[ds] = (await cached(key, force, () => loaders[ds](boardId))).value; } catch (err) { errors[name] = err.message; }
      boards[name] = meta(entry(key));
    }));
    return {
      leads: raw.leads ? raw.leads.leads : [], labels: raw.leads ? raw.leads.labels : null,
      listings: raw.listings ? raw.listings.listings : [], viewings: raw.calendar ? raw.calendar.viewings : [], lm: raw.calendar ? raw.calendar.lm : {},
      calendarOk: !!raw.calendar, calendarSalesperson: raw.calendar ? raw.calendar.salesperson || [] : null, deals: raw.calendar ? raw.calendar.deals || [] : [],
      errors, notConfigured, ...summary(boards),
    };
  }

  /** Age and refresh state of each board without waiting or sending data; starts a background refresh when one is due. */
  function freshness() {
    const boards = {};
    for (const { ds, name, boardId } of boardList()) {
      if (!boardId) continue;
      const e = entry(ds + ':' + boardId);
      if (due(e, false)) refresh(e, () => loaders[ds](boardId));
      boards[name] = { ...meta(e), error: !e.value && !e.pending ? e.error : '' };
    }
    return summary(boards);
  }
  /** Resolves once no board is loading (tests). */
  const settled = () => Promise.allSettled([...cache.values()].map((e) => e.pending).filter(Boolean));

  async function notes(itemId) {
    const d = await tracked(status, () => gql('query ($i: [ID!]) { items(ids: $i) { id updates(limit: 50) { id text_body created_at creator { name } } } }', { i: [itemId] }));
    const item = (d.items || [])[0];
    return ((item && item.updates) || []).map((u) => ({ id: String(u.id), by: (u.creator && u.creator.name) || 'Monday', text: String(u.text_body || '').slice(0, 4000), at: u.created_at }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  /**
   * One listing photo through the server (the browser never gets Monday's file links).
   * Always Monday's signed public_url: url_thumbnail is a monday.com/protected_static link that only answers a signed-in
   * Monday user, so thumbnails failed (the page now scales the photo instead). public_url links expire after about an
   * hour, so links older than 40 minutes are refreshed with a read query, and a link the file host refuses (expired early or
   * replaced) is renewed once. The Monday token is NOT sent to the file host.
   * Only JPEG/PNG/GIF/WebP up to 10 MB are passed on (the download stops past 10 MB), recognised by their first bytes
   * when S3 labels them generically.
   * Read-only: this never changes, replaces or deletes a file on Monday.
   */
  async function photo(assetId) {
    const entry = cache.get('listings:' + cfg.boards.listings);
    const map = entry && entry.value && entry.value.assets;
    const a = map && map.get(String(assetId));
    if (!a) return null;   // only photos of listings on the configured Listings board
    const fresh = async () => {
      const d = await tracked(status, () => gql('query ($ids: [ID!]!) { assets(ids: $ids) { id public_url } }', { ids: [String(assetId)] }));
      const f = (d.assets || [])[0];
      if (!f || !f.public_url) throw new IntegrationError('monday', 'That photo is no longer on Monday.', { status: 404, countsAsFailure: false });
      Object.assign(a, { url: f.public_url, at: Date.now() });
    };
    let renewed = false;
    if (Date.now() - a.at > PHOTO_URL_TTL || !a.url) { await fresh(); renewed = true; }
    let res = await fetchPhoto(a.url);
    // a signed link that expired early or was replaced answers 400/403/404: ask Monday for a new link once
    if ([400, 403, 404].includes(res.status) && !renewed) {
      res.body && res.body.cancel().catch(() => {});
      await fresh();
      res = await fetchPhoto(a.url);
    }
    if (res.status !== 200) {
      res.body && res.body.cancel().catch(() => {});
      throw new IntegrationError('monday', `Photo request returned HTTP ${res.status}.`, { status: res.status === 404 ? 404 : 502, countsAsFailure: false });
    }
    const tooBig = () => new IntegrationError('monday', 'Photo is too large.', { status: 413, countsAsFailure: false });
    const notPhoto = () => new IntegrationError('monday', 'That file is not a supported photo type.', { status: 415, countsAsFailure: false });
    const declared = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!PHOTO_TYPES.includes(declared) && !/^(application\/octet-stream|binary\/octet-stream|)$/.test(declared)) { res.body && res.body.cancel().catch(() => {}); throw notPhoto(); }
    if (Number(res.headers.get('content-length') || 0) > PHOTO_MAX_BYTES) { res.body && res.body.cancel().catch(() => {}); throw tooBig(); }
    // read at most 10 MB: a file host that sends more (or no length) is cut off, not buffered
    const parts = []; let size = 0;
    try {
      for await (const chunk of res.body || []) {
        size += chunk.length;
        if (size > PHOTO_MAX_BYTES) throw tooBig();
        parts.push(Buffer.from(chunk));
      }
    } catch (e) {
      if (e instanceof IntegrationError) { res.body.cancel().catch(() => {}); throw e; }
      throw new IntegrationError('monday', 'Could not load the photo from Monday.', { countsAsFailure: false });
    }
    const buf = Buffer.concat(parts);
    // the bytes decide: a file labelled image/png that isn't one (or an SVG/HTML page) is refused
    const type = imageType(buf);
    if (!type) throw notPhoto();
    return { type, body: buf };
  }
  /** GET one Monday file link: HTTPS only (local fake in tests), no Authorization header, 20 s limit. */
  async function fetchPhoto(url) {
    const okUrl = (u) => /^https:\/\//.test(u) || (mockApi && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(u));
    if (!okUrl(url)) throw new IntegrationError('monday', 'Photo link is not HTTPS.', { status: 502, countsAsFailure: false });
    let res;
    try { res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) }); }   // no Authorization header
    catch (e) { throw new IntegrationError('monday', 'Could not load the photo from Monday.', { countsAsFailure: false }); }
    if (!okUrl(res.url || url)) { res.body && res.body.cancel().catch(() => {}); throw new IntegrationError('monday', 'Photo link redirected to a non-HTTPS address.', { countsAsFailure: false }); }
    return res;
  }

  async function test() {
    const ids = Object.values(cfg.boards).filter(Boolean);
    const d = await tracked(status, () => gql('query ($b: [ID!]) { me { name } boards(ids: $b) { id name } }', { b: ids.length ? ids : ['0'] }));
    const names = Object.fromEntries((d.boards || []).map((b) => [String(b.id), b.name]));
    return { user: (d.me && d.me.name) || '', boards: Object.fromEntries(Object.entries(cfg.boards).map(([k, id]) => [k, id ? (names[id] ? { found: true, name: names[id] } : { found: false }) : null])) };
  }

  /**
   * Up to `n` respond.io contact IDs from the Leads board's Respond ID column: one page, that column only (for the
   * connection check; much lighter than a full load). Returns the IDs and how many rows on that page had one.
   */
  async function respondIdSample(n = 3) {
    const id = cfg.boards.leads;
    if (!id) throw new IntegrationError('monday', 'MONDAY_LEADS_BOARD_ID is not set, so there are no Respond IDs to test with.');
    const col = matchLeadCols((await boardMeta(id)).columns).contactId;
    if (!col) return { column: false, rows: 0, withId: 0, ids: [] };
    const d = await gql(`query ($b: [ID!], $c: [String!]) { boards(ids: $b) { items_page(limit: 200) { items { id column_values(ids: $c) { id text } } } } }`, { b: [id], c: [col] });
    const items = ((((d.boards || [])[0] || {}).items_page || {}).items) || [];
    const ids = items.map((it) => String(((it.column_values || [])[0] || {}).text || '').replace(/\D/g, '')).filter(Boolean);
    return { column: true, rows: items.length, withId: ids.length, ids: [...new Set(ids)].slice(0, n) };
  }

  /** A board's columns right now (id, title, type, label settings), for resolving where an allowlisted write goes. */
  async function boardColumns(board) {
    const id = cfg.boards[board];
    if (!id) throw new IntegrationError('monday', `The Monday ${board} board is not configured.`, { status: 409 });
    return (await tracked(status, () => boardMeta(id))).columns || [];
  }
  /**
   * After a write: re-read that one item (a read query) and replace it in the in-memory copy, so the page shows what
   * Monday now holds. The board's "read at" time is left as it was (the rest of the board wasn't re-read).
   * { remember: false } only reads (the check before a write): the copy is left alone and nothing is kept for later.
   */
  async function refreshItem(board, itemId, { remember = true } = {}) {
    const boardId = cfg.boards[board], e = cache.get(board + ':' + boardId);
    if (board === 'calendar') return refreshViewing(itemId, e, remember);
    const cols = board === 'leads' ? matchLeadCols(await boardColumns('leads')) : matchListingCols(await boardColumns('listings'));
    const fields = board === 'leads' ? ITEM_FIELDS : LISTING_FIELDS;
    const d = await tracked(status, () => gql(`query ($i: [ID!], $c: [String!]) { items(ids: $i) { ${fields} } }`, { i: [String(itemId)], c: Object.values(cols) }));
    const it = (d.items || [])[0];
    if (!it) return null;
    if (!remember) { if (board === 'leads') return shapeLead(it, cols); const r = shapeListing(it, cols); delete r._assets; return r; }
    // remembered until the next full read of the board, so a read that started earlier can't bring back the old value
    const patch = (list, rec, assets) => { if (e && e.pending) (e.patches = e.patches || new Map()).set(rec.id, { list, rec, assets, at: now() }); };
    if (board === 'leads') {
      const l = shapeLead(it, cols);
      if (e && e.value) e.value.leads = e.value.leads.map((x) => (x.id === l.id ? l : x));
      patch('leads', l);
      return l;
    }
    const x = shapeListing(it, cols), at = Date.now();
    if (e && e.value) {
      x._assets.forEach((a) => e.value.assets.set(String(a.id), { listingId: x.id, url: a.public_url, at }));
      e.value.listings = e.value.listings.map((y) => (y.id === x.id ? x : y));
    }
    const assets = x._assets.map((a) => [String(a.id), { listingId: x.id, url: a.public_url, at }]);
    delete x._assets;
    patch('listings', x, assets);
    return x;
  }
  /**
   * A Calendar item as a viewing (see refreshItem). After a remembered re-read the whole board is marked for a
   * background reload, because the clients' LOI evidence (lm) is built from every Calendar item.
   */
  async function refreshViewing(itemId, e, remember) {
    const cols = matchCalendarCols(await boardColumns('calendar'));
    const d = await tracked(status, () => gql(`query ($i: [ID!], $c: [String!]) { items(ids: $i) { ${ITEM_FIELDS} } }`, { i: [String(itemId)], c: Object.values(cols) }));
    const it = (d.items || [])[0], v = it ? shapeViewing(it, cols, new Date().toISOString().slice(0, 10)) : null;
    if (!v || !remember) return v;
    if (e && e.value) { e.value.viewings = e.value.viewings.map((x) => (x.id === v.id ? v : x)); e.stale = true; e.staleAt = now(); }
    if (e && e.pending) (e.patches = e.patches || new Map()).set(v.id, { list: 'viewings', rec: v, at: now() });
    return v;
  }
  /** The cached record (as on screen) for a board item, or null. */
  function cachedItem(board, itemId) {
    const e = cache.get(board + ':' + cfg.boards[board]), list = e && e.value && (board === 'leads' ? e.value.leads : e.value.listings);
    return (list || []).find((x) => x.id === String(itemId)) || null;
  }

  return { loadAll, freshness, settled, notes, photo, test, respondIdSample, writeColumn, boardColumns, refreshItem, cachedItem, writesEnabled: !!cfg.writes };
}

module.exports = { createMonday, assertReadOnly, assertAllowedWrite, WRITE_MUTATION, matchLeadCols, matchListingCols, matchCalendarCols, labelsOf, shapeLead, shapeListing, shapeViewing, money, time24, imageType, HIDE };
