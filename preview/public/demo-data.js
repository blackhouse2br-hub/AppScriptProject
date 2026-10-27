/*
 * Fictional sample data for the local preview. Every name, phone number, email and building
 * below is made up; nothing is read from Monday.com, respond.io or Google.
 * The generator is seeded, so "Reset demo data" always gives the same starting set
 * (dates are placed relative to the day you reset).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shared'));
  else root.BH_DEMO = factory(root.BH_SHARED);
})(typeof self !== 'undefined' ? self : this, function (SHARED) {
  'use strict';

  const LISTS = SHARED.LISTS;
  const AI_WEIGHTS = [['Property Matching', 30], ['Scheduling', 18], ['LOI', 8], ['Contract', 6], ['Collection', 4],
    ['Active', 9], ['For Renewal', 4], ['Failed', 15], ['Not on Respond.io', 6]];
  const STATUS_FOR_AI = { 'Property Matching': ['New Inquiry', 'Qualified'], 'Scheduling': ['For Viewing'], 'LOI': ['Negotiation'],
    'Contract': ['Negotiation'], 'Collection': ['Negotiation'], 'Active': ['Closed'], 'For Renewal': ['Closed'], 'Failed': ['Failed'],
    'Not on Respond.io': ['New Inquiry'] };
  const FIRST = ['Alex', 'Bianca', 'Carmen', 'Daniel', 'Elena', 'Felix', 'Grace', 'Hiro', 'Isabel', 'Jae', 'Kara', 'Leo', 'Mira',
    'Noel', 'Olivia', 'Paolo', 'Quinn', 'Rina', 'Sam', 'Tess', 'Uma', 'Victor', 'Wren', 'Yuna', 'Zed'];
  const LAST = ['Abad', 'Bautista', 'Chen', 'Dizon', 'Evans', 'Flores', 'Garcia', 'Han', 'Ito', 'Javier', 'Kim', 'Lopez', 'Mendoza',
    'Navarro', 'Ortiz', 'Park', 'Quiambao', 'Reyes', 'Sato', 'Tan', 'Uy', 'Villanueva', 'Wong', 'Yap', 'Zamora'];
  const BUILDINGS = ['Acacia Demo Residences', 'Banyan Sample Tower', 'Cedar Test Suites', 'Dalisay Demo Place', 'Elm Sample Lofts',
    'Fernwood Demo Heights', 'Garnet Sample Plaza', 'Halcyon Demo Park', 'Ivory Sample Court', 'Juniper Demo Gardens'];
  const REQS = ['Near a school', 'High floor, city view', 'With balcony', 'Walking distance to office', 'Pet-friendly building',
    'With parking slot', 'Quiet unit, away from elevator', 'Gym and pool required', 'Close to MRT', 'Ready to move in'];
  const CLIENT_LINES = ['Hi, is the unit still available?', 'Can we view this weekend?', 'What is the association dues?',
    'Do you have anything with 2 bedrooms?', 'Is parking included in the price?', 'Thanks, I will check with my partner.',
    'Can you send more photos?', 'Is the lease negotiable for 2 years?'];
  const VA_LINES = ['Hello! Yes, it is still available. Would you like to schedule a viewing?', 'Sure, I can arrange Saturday at 10 AM.',
    'Association dues are included in the monthly rent.', 'I found three units that match your requirements. Sending them now.',
    'One parking slot is included.', 'Noted! Let me know if you have questions.', 'Here are more photos of the unit.'];
  const FEEDBACK = ['Client liked the view, comparing with one more unit.', 'Unit too small for the family.', 'Client wants to negotiate the price.', ''];

  // mulberry32: small seeded PRNG so the sample set is reproducible
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => { const x = new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };

  function generate(now, opts) {
    const LEADS = (opts && opts.leads) || 64;
    const r = rng(20261022);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const weighted = (w) => { let x = r() * w.reduce((s, e) => s + e[1], 0); for (const [v, n] of w) { x -= n; if (x < 0) return v; } return w[w.length - 1][0]; };
    const DAY = 864e5, t0 = now.getTime();
    const ago = (days, hours) => new Date(t0 - days * DAY - (hours || 0) * 36e5).toISOString();
    const fakePhone = () => '+63 900 555 ' + String(int(0, 9999)).padStart(4, '0');

    const listings = [];
    for (let i = 0; i < 42; i++) {
      const type = r() < 0.72 ? 'For Rent' : 'For Sale';
      const beds = weighted([['Studio', 3], ['1', 5], ['2', 5], ['3', 3], ['4+', 1]]);
      const bi = Math.max(0, LISTS.bedrooms.indexOf(beds));
      listings.push({
        id: 'L' + (2001 + i), code: 'L-D' + (2001 + i),
        building: pick(BUILDINGS), tower: 'Tower ' + pick(['A', 'B', 'C']), floor: int(3, 42),
        city: pick(LISTS.cities), type,
        price: type === 'For Rent' ? int(7, 90) * 5000 : int(60, 900) * 100000,
        bedrooms: beds, bathrooms: Math.max(1, bi), sizeSqm: [28, 42, 68, 110, 180][bi] + int(-6, 20),
        furnishing: pick(LISTS.furnishing), parking: r() < 0.6, petFriendly: r() < 0.4,
        availability: weighted([['Available', 70], ['Reserved', 15], ['Not Available', 15]]),
        contact: 'Owner ' + pick(LAST) + ' (demo)', contactPhone: fakePhone(),
        hue: int(0, 359), addedAt: ago(int(1, 200)),
      });
    }

    const leads = [];
    for (let i = 0; i < LEADS; i++) {
      const first = pick(FIRST), last = pick(LAST);
      const ai = weighted(AI_WEIGHTS);
      const inquiry = r() < 0.75 ? 'Rent' : 'Buy';
      const createdDays = ai === 'Property Matching' ? int(0, 30) : int(10, 160);
      const onRespond = ai !== 'Not on Respond.io' && r() < 0.97;
      const source = pick(LISTS.sources);
      const temp = ai === 'Failed' ? pick(['Lost', 'Dead']) : !onRespond || ai === 'Not on Respond.io' ? 'Not on Respond.io'
        : ai === 'Active' || ai === 'For Renewal' ? 'Active'
        : weighted([['Hot', createdDays < 7 ? 5 : 2], ['Warm', 4], ['Cold', createdDays > 20 ? 4 : 1]]);
      const chat = [];
      if (onRespond) {
        const n = int(2, 6); let h = int(1, 30) + (n * 3);
        const lastFrom = r() < 0.45 ? 'client' : 'va';
        for (let k = 0; k < n; k++) {
          const from = (n - 1 - k) % 2 === 0 ? lastFrom : (lastFrom === 'client' ? 'va' : 'client');
          chat.push({ from, text: from === 'client' ? pick(CLIENT_LINES) : pick(VA_LINES), at: ago(0, h) });
          h -= int(1, 3);
        }
      }
      const lead = {
        id: String(9001 + i), code: 'DEMO-' + (1001 + i),
        name: first + ' ' + last, phone: fakePhone(), email: (first + '.' + last).toLowerCase() + '@example.com',
        status: pick(STATUS_FOR_AI[ai]), ai, temp, inquiry,
        // no respond.io chat, but the Monday record (New Inquiry) still puts the lead in property sourcing
        ...(ai === 'Not on Respond.io' ? { workStage: 'Property Matching' } : {}),
        va: r() < 0.9 ? pick(LISTS.vas) : '', salesperson: pick(LISTS.brokers),
        source, origin: source === 'Respond IO' ? 'respond.io' : 'Monday',
        budget: r() < 0.08 ? 0 : inquiry === 'Rent' ? int(8, 120) * 5000 : int(8, 90) * 1e6,
        // pets: '' = the client never said (Monday column left empty)
        city: pick(LISTS.cities), bedrooms: pick(LISTS.bedrooms), occupants: pick(LISTS.occupants), pets: ((x) => (x < 0.3 ? 'With Pets' : x < 0.65 ? 'No Pets' : ''))(r()),
        requirements: [pick(REQS), r() < 0.5 ? pick(REQS) : ''].filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join('; '),
        nationality: pick(LISTS.nationalities),
        moveIn: inquiry === 'Rent' ? ymd(t0 + int(-10, 90) * DAY) : '',
        createdAt: ago(createdDays, int(0, 12)), updatedAt: ago(int(0, Math.min(createdDays, 6)), int(0, 20)),
        daysInStage: int(0, 25), onRespond, contactId: onRespond ? String(int(100000000, 999999999)) : '',
        chat, waiting: chat.length ? (chat[chat.length - 1].from === 'client' ? 'va' : 'client') : '',
        failReason: ai === 'Failed' ? pick(LISTS.failReasons) : '',
        leaseEnd: ai === 'For Renewal' ? ymd(t0 + int(-5, 30) * DAY) : ai === 'Active' ? ymd(t0 + int(31, 300) * DAY) : '',
        notes: r() < 0.7 ? [{ by: 'VA (demo)', text: 'Client prefers ' + pick(['morning', 'afternoon', 'weekend']) + ' viewings.', at: ago(int(1, 10)) }] : [],
      };
      leads.push(lead);
    }
    // unit specifics for the Property Requirements report, from their own seed so the leads above stay the same
    const r2 = rng(20261026), pick2 = (a) => a[Math.floor(r2() * a.length)];
    leads.forEach((l) => {
      const bi = Math.max(0, LISTS.bedrooms.indexOf(l.bedrooms));
      l.building = r2() < 0.35 ? pick2(BUILDINGS) : '';
      l.sqm = r2() < 0.7 ? String([30, 45, 70, 110, 160][bi] + Math.floor(r2() * 4) * 5) + '+' : '';
      l.bathrooms = r2() < 0.75 ? LISTS.bathrooms[Math.min(3, Math.max(0, bi - 1))] : '';
      l.parking = r2() < 0.8 ? pick2(LISTS.parking) : '';
      l.furnishing = l.inquiry === 'Rent' && r2() < 0.8 ? pick2(LISTS.furnishing) : '';
    });

    const calendar = [];
    const viewers = leads.filter((l) => ['Scheduling', 'LOI', 'Contract', 'Collection', 'Active', 'For Renewal', 'Failed'].includes(l.ai));
    viewers.forEach((l) => {
      const want = l.inquiry === 'Rent' ? 'For Rent' : 'For Sale';
      const pool = listings.filter((x) => x.type === want);
      const near = pool.filter((x) => x.city === l.city);
      const n = l.ai === 'Failed' ? int(0, 1) : int(1, 3);
      for (let k = 0; k < n; k++) {
        const listing = pick(near.length && r() < 0.7 ? near : pool);
        const offset = l.ai === 'Scheduling' ? int(-3, 21) : int(-45, -2);
        const status = offset >= 0 ? (r() < 0.5 ? 'Proposed' : 'Confirmed') : (r() < 0.85 ? 'Done' : 'Cancelled');
        calendar.push({
          id: 'V' + (calendar.length + 1), leadId: l.id, listingId: listing.id, date: ymd(t0 + offset * DAY),
          time: pad(int(9, 17)) + ':' + pick(['00', '30']), broker: l.salesperson, status,
          feedback: status === 'Done' ? pick(FEEDBACK) : '',
        });
      }
    });

    // module keys match MOD_LABEL in the original Index.html; Managers always get edit on everything
    const users = [{ email: 'manager@example.com', name: 'Demo Manager', role: 'Manager', vaLabel: '', phone: '', modules: {} }]
      .concat(LISTS.vas.map((v) => ({ email: v.toLowerCase() + '.va@example.com', name: v + ' (VA)', role: 'VA', vaLabel: v, phone: '',
        modules: { leads: 'edit', vaportal: 'edit', monitor: 'view', calendar: 'edit', renewals: 'view', services: 'view' } })))
      .concat(LISTS.brokers.map((b) => ({ email: b.split(' ')[0].toLowerCase() + '.broker@example.com', name: b, role: 'Broker', vaLabel: '', phone: fakePhone(),
        modules: { leads: 'view', calendar: 'edit' } })));

    const templates = [
      { id: 'T1', name: 'follow_up_24h', language: 'en', body: 'Hi {{1}}, just checking in on your property search. Are you still looking for a unit?' },
      { id: 'T2', name: 'viewing_reminder', language: 'en', body: 'Hi {{1}}, a reminder of your viewing at {{2}} on {{3}}. See you there!' },
      { id: 'T3', name: 'new_units_available', language: 'en', body: 'Hi {{1}}, we found new units that match your requirements. Would you like to see them?' },
    ];

    return { version: 1, generatedAt: now.toISOString(), leads, listings, calendar, users, templates };
  }

  return { LISTS, generate, ymd };
});
