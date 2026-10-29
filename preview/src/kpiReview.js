'use strict';
// KPI Review (MongoDB mode, signed in): each VA's VA Management KPIs for a reporting month, with separate coaching and
// feedback from the two reviewers (Toby, Jonjo), the employee's own "We discussed this review", and manual monthly
// snapshots. The KPIs are the VA Management ones (shared.js vaWorkload / vaPerformance), read from the same data.
//
// Who may do what (decided here on every request; nothing the page sends about names or roles is trusted):
//   reviewer  = an active Team & Access member whose email is KPI_REVIEWER_TOBY_EMAIL / _JONJO_EMAIL (and, on a Google
//               server, whose Google account is linked). ONLY the two reviewers can open KPI Review: they see every VA,
//               both columns and the snapshots; each writes only their own column.
//   everyone else, Managers included (and never the shared Blackhouse account): no KPI Review data at all.
//   VA        = may acknowledge "We discussed this review" for their own months, signed in as themselves. They see only
//               which months have a review waiting for that, never the coaching, feedback, KPIs or reviewer records.
// Employees are Team & Access members with the VA role; their stable ID is their member ID. A VA label on the board
// with no member is shown with its KPIs, but feedback, acknowledgment and snapshot entries need the member record.
const SH = require('../public/shared');
const { User, Lead, Viewing, LeadOverride, KpiFeedback, KpiAck, KpiSnapshot } = require('./models');
const { sha256 } = require('./auth');

const ID_RE = /^[a-f0-9]{24}$/i, LABEL_KEY_RE = /^va-([A-Za-z0-9_-]{1,160})$/;
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const labelKey = (label) => 'va-' + Buffer.from(label, 'utf8').toString('base64url');
const sameId = (a, b) => !!a && !!b && String(a) === String(b);
const who = (u) => ({ userId: u._id, name: u.name, email: u.email });

/**
 * On a Google server: true when this session was started by the Google account now linked to the member. A session
 * from before an email change or a re-link (another person's sign-in on the same record) doesn't count.
 */
async function googleBound(user, session) {
  const u = await User.findById(user._id).select('+googleSub').lean();
  return !!(u && u.googleSub && session && session.subHash && session.subHash === sha256(u.googleSub)) && u;
}

/** The reviewer slot ({ key, label }) this signed-in member holds, or null. Exported for tests. */
async function reviewerSlot(user, reviewers, { google, session }) {
  if (!user || !user.active) return null;
  const email = String(user.email || '').toLowerCase();
  if (SH.KPI_REVIEW.neverReviewers.includes(email)) return null;   // the shared Blackhouse account, whatever the settings say
  const slot = reviewers.find((r) => r.email && r.email === email);
  if (!slot) return null;
  // on a Google server the email must be proven by the linked Google account, in this very session: a member whose
  // email was just changed to a reviewer's address (the link is then removed), or a session kept from before the
  // reviewer's own Google account was linked to the record, is not a reviewer
  if (google) {
    const u = await googleBound(user, session);
    if (!u || String(u.email).toLowerCase() !== slot.email) return null;
  }
  return slot;
}

function kpiReviewRoutes(r, config, integ) {
  const google = config.auth.provider === 'google', reviewers = config.kpiReview.reviewers;

  /** Live KPI inputs: Monday.com (read-only, server memory) when connected, otherwise the MongoDB records. */
  async function kpiData() {
    if (integ.monday) {
      const all = await integ.monday.loadAll(false);
      if (all.errors.leads) { const e = new Error('The Monday leads board could not be read: ' + all.errors.leads); e.integration = 'monday'; throw e; }
      const leads = integ.enrich(all, all.leads, await integ.mondayOverrides());
      const deals = all.calendarOk && !all.errors.viewings ? all.deals || [] : null;
      return { source: 'monday', leads, viewings: all.viewings, deals, readAt: all.fetchedAt ? new Date(all.fetchedAt) : new Date() };
    }
    const ovs = new Map((await LeadOverride.find({ source: 'mongo', failed: { $ne: null } }).limit(20000).lean()).map((o) => [o.leadId, o]));
    const leads = (await Lead.find({}, { va: 1, ai: 1, temp: 1, waiting: 1, onRespond: 1, createdAt: 1 }).limit(20000).lean())
      .map((l) => SH.applyOverride({ id: String(l._id), va: l.va, ai: l.ai, temp: l.temp, waiting: l.waiting, onRespond: l.onRespond, createdAt: l.createdAt ? l.createdAt.toISOString() : '' }, ovs.get(String(l._id))));
    const viewings = (await Viewing.find({}, { leadId: 1, status: 1 }).limit(20000).lean()).map((v) => ({ leadId: String(v.leadId), status: v.status }));
    return { source: 'mongo', leads, viewings, deals: null, readAt: new Date() };
  }
  // one label per VA (case and spacing variants of a board label are the same VA, as everywhere else)
  const labelsIn = (data) => SH.vaLabels(data.leads.map((l) => l.va));

  /** Every VA: Team & Access members with the VA role, then board VA labels that no member has yet. */
  async function employees(data) {
    const users = await User.find({ role: 'VA' }).sort({ name: 1 }).lean();
    const count = {}; users.forEach((u) => { const k = SH.vaKey(u.vaLabel); if (k) count[k] = (count[k] || 0) + 1; });
    const linked = users.map((u) => ({ key: String(u._id), employeeId: String(u._id), name: u.name, vaLabel: u.vaLabel || '', linked: true, active: u.active !== false, sharedLabel: (count[SH.vaKey(u.vaLabel)] || 0) > 1 }));
    const unlinked = (data ? labelsIn(data) : []).filter((l) => !count[SH.vaKey(l)])
      .map((l) => ({ key: labelKey(l), employeeId: null, name: l, vaLabel: l, linked: false, active: true, sharedLabel: false }));
    return linked.concat(unlinked).sort((a, b) => a.name.localeCompare(b.name));
  }

  // every KPI Review data route: the two reviewers only (no Manager / admin exception)
  const DENIED = 'KPI Review is private to Toby\'s and Jonjo\'s own signed-in accounts.';
  const viewer = async (req, res, next) => {
    const slot = await reviewerSlot(req.user, reviewers, { google, session: req.sessionDoc });
    if (!slot) return res.status(403).json({ error: DENIED });
    req.kr = { slot };
    next();
  };
  const period = (req, res) => {
    if (!SH.validPeriod(req.params.period)) { bad(res, `Pick a reporting month (this month or up to ${SH.KPI_REVIEW.monthsBack} months back).`); return null; }
    return req.params.period;
  };
  /** The employee a :key names: { employeeId|null, name, vaLabel, linked }. */
  async function employeeFor(req, res, data) {
    const key = String(req.params.key || ''), m = LABEL_KEY_RE.exec(key);
    let emp = null;
    if (ID_RE.test(key)) {
      const u = await User.findOne({ _id: key, role: 'VA' }).lean();
      if (u) emp = { employeeId: String(u._id), name: u.name, vaLabel: u.vaLabel || '', linked: true };
    } else if (m) {
      const label = Buffer.from(m[1], 'base64url').toString('utf8');
      const members = await User.find({ role: 'VA' }, { vaLabel: 1 }).lean();
      if (data && labelsIn(data).includes(label) && !members.some((u) => SH.sameVa(u.vaLabel, label))) emp = { employeeId: null, name: label, vaLabel: label, linked: false };
    }
    if (!emp) res.status(404).json({ error: 'Employee not found.' });
    return emp;
  }
  const kpisFor = (data, va, p) => SH.kpiReviewValues({ leads: data.leads, viewings: data.viewings, deals: data.deals, va, period: p, today: SH.manilaDay() });
  const reviewOut = (f) => f && ({ reviewerKey: f.reviewerKey, coaching: f.coaching, feedback: f.feedback, version: f.version,
    author: { name: f.author.name, userId: String(f.author.userId) }, createdAt: f.createdAt, updatedAt: f.updatedAt,
    discussedAt: f.discussedAt || null, discussedBy: f.discussedBy ? { name: f.discussedBy.name } : null, discussedVersion: f.discussedVersion || 0 });
  // for the reviewers: who acknowledged, from which account, and which versions of the text it covered
  const ackOut = (a) => a && { at: a.createdAt, by: { name: a.by.name, userId: String(a.by.userId), email: a.by.email }, googleLinkedAt: a.googleLinkedAt || null, reviewVersions: a.reviewVersions || {} };

  // what this member may open; anyone who isn't a reviewer learns nothing about KPI Review beyond "no"
  r.get('/kpi-review/me', async (req, res) => {
    const slot = await reviewerSlot(req.user, reviewers, { google, session: req.sessionDoc }), canAck = req.user.role === 'VA';
    // a reviewer's own email, but this session wasn't started by their (now linked) Google account: e.g. a session from
    // before this feature. Tell them to sign in again (this says nothing to anyone else).
    const email = String(req.user.email || '').toLowerCase();
    const signInAgain = !slot && google && reviewers.some((r) => r.email && r.email === email) && !SH.KPI_REVIEW.neverReviewers.includes(email);
    if (!slot) return res.json({ canView: false, canAck, ...(canAck ? { timezone: SH.KPI_REVIEW.timezone } : {}), ...(signInAgain ? { signInAgain: true } : {}) });
    res.json({ canView: true, canAck, reviewer: { key: slot.key, label: slot.label },
      reviewers: reviewers.map((x) => ({ key: x.key, label: x.label, configured: !!x.email })),
      timezone: SH.KPI_REVIEW.timezone, currentPeriod: SH.manilaMonth(), monthsBack: SH.KPI_REVIEW.monthsBack });
  });

  r.get('/kpi-review/employees', viewer, async (req, res) => {
    let data = null, labelsError = '';
    try { data = await kpiData(); } catch (err) { if (!err.integration) throw err; labelsError = err.message; }
    res.json({ employees: await employees(data), labelsError, source: data ? data.source : '' });
  });

  r.get('/kpi-review/review/:key/:period', viewer, async (req, res) => {
    const p = period(req, res); if (!p) return;
    let data = null, kpiError = '';
    try { data = await kpiData(); } catch (err) { if (!err.integration) throw err; kpiError = err.message; }
    const emp = await employeeFor(req, res, data); if (!emp) return;
    const [fb, ack, snap] = emp.linked ? await Promise.all([KpiFeedback.find({ employeeId: emp.employeeId, period: p }).lean(), KpiAck.findOne({ employeeId: emp.employeeId, period: p }).lean(),
      KpiSnapshot.findOne({ period: p, scope: SH.KPI_REVIEW.scope }, { createdAt: 1, 'createdBy.name': 1 }).lean()]) : [[], null, await KpiSnapshot.findOne({ period: p, scope: SH.KPI_REVIEW.scope }, { createdAt: 1, 'createdBy.name': 1 }).lean()];
    const reviews = Object.fromEntries(reviewers.map((x) => [x.key, reviewOut(fb.find((f) => f.reviewerKey === x.key)) || null]));
    const self = emp.linked && sameId(emp.employeeId, req.user._id), slot = req.kr.slot;
    res.json({
      period: p, employee: { key: req.params.key, employeeId: emp.employeeId, name: emp.name, vaLabel: emp.vaLabel, linked: emp.linked },
      kpis: data ? kpisFor(data, emp.vaLabel, p) : null, kpiError, source: data ? data.source : '', dataReadAt: data ? data.readAt : null, hasDeals: !!(data && data.deals),
      reviews, ack: ackOut(ack), snapshot: snap ? { createdAt: snap.createdAt, by: snap.createdBy && snap.createdBy.name } : null,
      can: { write: emp.linked && !self, slot: slot.key, snapshot: true },
    });
  });

  /** The linked employee a reviewer is writing about (never themselves). */
  async function reviewTarget(req, res) {
    const p = period(req, res); if (!p) return null;
    if (!ID_RE.test(req.params.key)) { res.status(409).json({ error: 'This VA label has no Team & Access member yet. Ask a Manager to add them (role VA, this VA label), then write the review.' }); return null; }
    const emp = await employeeFor(req, res, null); if (!emp) return null;
    if (sameId(emp.employeeId, req.user._id)) { res.status(403).json({ error: 'You can\'t review yourself.' }); return null; }
    return { emp, p };
  }

  // a reviewer's own column only: the slot comes from the session, never from the request
  r.put('/kpi-review/review/:key/:period/feedback', viewer, async (req, res) => {
    const t = await reviewTarget(req, res); if (!t) return;
    const { value, errors } = SH.validateKpiFeedback(req.body);
    if (errors.length) return bad(res, errors[0]);
    const key = { employeeId: t.emp.employeeId, period: t.p, reviewerKey: req.kr.slot.key };
    const conflict = async () => res.status(409).json({ conflict: true, review: reviewOut(await KpiFeedback.findOne(key).lean()),
      error: 'Your review for this month was changed in another tab or device since you opened it. Your text was not saved: copy it, reload, and save again.' });
    await KpiFeedback.init();   // the unique index must exist first, so two first saves can't both insert
    let doc;
    if (value.version === 0) {
      try { doc = await KpiFeedback.create({ ...key, coaching: value.coaching, feedback: value.feedback, author: who(req.user), createdBy: who(req.user) }); } catch (err) { if (err.code !== 11000) throw err; return conflict(); }
    } else {
      doc = await KpiFeedback.findOneAndUpdate({ ...key, version: value.version }, { $set: { coaching: value.coaching, feedback: value.feedback, author: who(req.user) }, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true });
      if (!doc) return conflict();
    }
    res.json({ review: reviewOut(doc.toObject()) });
  });

  // "Reviewer recorded discussion": the reviewer's own record. It is never shown as the employee's verification.
  r.post('/kpi-review/review/:key/:period/discussed', viewer, async (req, res) => {
    const t = await reviewTarget(req, res); if (!t) return;
    if (req.body && Object.keys(req.body).length) return bad(res, 'Invalid request.');
    const key = { employeeId: t.emp.employeeId, period: t.p, reviewerKey: req.kr.slot.key };
    // recorded against the text as it is now (its version): a later edit shows as "changed after the discussion record"
    const cur = await KpiFeedback.findOne(key).lean();
    if (!cur) return res.status(409).json({ error: 'Save your coaching or feedback first.' });
    const doc = await KpiFeedback.findOneAndUpdate({ ...key, discussedAt: null, version: cur.version },
      { $set: { discussedAt: new Date(), discussedBy: { userId: req.user._id, name: req.user.name }, discussedVersion: cur.version } }, { returnDocument: 'after' })
      || await KpiFeedback.findOne(key);
    res.json({ review: reviewOut(doc.toObject()) });
  });

  // ----- the employee's own acknowledgment, signed in as themselves (a reviewer or Manager can't make it for them) -----
  // These two routes never return coaching, feedback, KPI values or the reviewers' discussion records: only which
  // months have a review to acknowledge, and the employee's own acknowledgment.
  const ONLY_EMPLOYEE = 'Only the employee being reviewed can acknowledge the discussion, signed in with their own account.';
  r.get('/kpi-review/my-acknowledgments', async (req, res) => {
    if (req.user.role !== 'VA') return res.status(403).json({ error: ONLY_EMPLOYEE });
    const [months, acks] = await Promise.all([KpiFeedback.distinct('period', { employeeId: req.user._id }), KpiAck.find({ employeeId: req.user._id }).lean()]);
    res.json({ months: months.sort().reverse().map((p) => { const a = acks.find((x) => x.period === p); return { period: p, acknowledged: !!a, at: a ? a.createdAt : null }; }) });
  });
  r.post('/kpi-review/my-acknowledgments/:period', async (req, res) => {
    const p = period(req, res); if (!p) return;
    const b = req.body;
    if (req.user.role !== 'VA') return res.status(403).json({ error: ONLY_EMPLOYEE });
    if (!b || Object.keys(b).length !== 1 || b.confirm !== true) return bad(res, 'Tick "We discussed this review" to confirm.');
    // on a Google server: made in a session of the Google account linked to this member (not one kept from before)
    const linked = google ? await googleBound(req.user, req.sessionDoc) : null;
    if (google && !linked) return res.status(403).json({ error: 'Sign out and sign in again with your Google account, then acknowledge.' });
    const fb = await KpiFeedback.find({ employeeId: req.user._id, period: p }, { reviewerKey: 1, version: 1 }).lean();
    if (!fb.length) return res.status(409).json({ error: 'There is no coaching or feedback for this month yet.' });
    await KpiAck.init();
    const mine = (a) => ({ period: p, acknowledged: true, at: a.createdAt });
    try {
      const a = await KpiAck.create({ employeeId: req.user._id, period: p, by: who(req.user), googleLinkedAt: linked ? linked.googleLinkedAt || null : null,
        reviewVersions: Object.fromEntries(fb.map((f) => [f.reviewerKey, f.version])) });
      res.status(201).json({ acknowledgment: mine(a) });
    } catch (err) {
      if (err.code !== 11000) throw err;
      res.status(409).json({ error: 'You already acknowledged this month\'s review.', acknowledgment: mine(await KpiAck.findOne({ employeeId: req.user._id, period: p }).lean()) });
    }
  });

  // ----- monthly snapshots (reviewers only): created by hand, one per month and scope, read-only afterwards -----
  const snapOut = (s) => ({ id: String(s._id), period: s.period, scope: s.scope, timezone: s.timezone, source: s.source, dataReadAt: s.dataReadAt, createdAt: s.createdAt,
    createdBy: { name: s.createdBy.name, as: s.createdBy.as }, employees: s.employees });
  r.get('/kpi-review/snapshots', viewer, async (req, res) => {
    const list = await KpiSnapshot.find({ scope: SH.KPI_REVIEW.scope }, { period: 1, createdAt: 1, 'createdBy.name': 1 }).sort({ period: -1 }).limit(240).lean();
    res.json({ snapshots: list.map((s) => ({ period: s.period, createdAt: s.createdAt, by: s.createdBy && s.createdBy.name })) });
  });
  r.get('/kpi-review/snapshots/:period', viewer, async (req, res) => {
    const p = period(req, res); if (!p) return;
    const s = await KpiSnapshot.findOne({ period: p, scope: SH.KPI_REVIEW.scope }).lean();
    if (!s) return res.status(404).json({ error: 'No snapshot for this month.' });
    res.json({ snapshot: snapOut(s) });
  });
  r.post('/kpi-review/snapshots', viewer, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || !SH.validPeriod(b.period)) return bad(res, 'Pick the reporting month to capture.');
    const p = b.period, scope = SH.KPI_REVIEW.scope;
    const exists = () => KpiSnapshot.findOne({ period: p, scope }, { createdAt: 1, 'createdBy.name': 1 }).lean();
    const dup = (s) => res.status(409).json({ error: `A snapshot for ${p} already exists${s ? ` (created by ${s.createdBy.name} on ${new Date(s.createdAt).toISOString()})` : ''}. Snapshots are never replaced.`, exists: true });
    const before = await exists(); if (before) return dup(before);
    let data;
    try { data = await kpiData(); } catch (err) { if (!err.integration) throw err; return res.status(502).json({ error: err.message + ' No snapshot was created.' }); }
    const emps = await employees(data), ids = emps.filter((e) => e.linked).map((e) => e.employeeId);
    const [fb, acks] = await Promise.all([KpiFeedback.find({ period: p, employeeId: { $in: ids } }).lean(), KpiAck.find({ period: p, employeeId: { $in: ids } }).lean()]);
    const label = Object.fromEntries(reviewers.map((x) => [x.key, x.label]));
    const employeesOut = emps.map((e) => {
      const ack = e.linked ? acks.find((a) => sameId(a.employeeId, e.employeeId)) : null;
      return { employeeId: e.employeeId, name: e.name, vaLabel: e.vaLabel, kpis: kpisFor(data, e.vaLabel, p),
        reviews: fb.filter((f) => sameId(f.employeeId, e.employeeId)).map((f) => ({ reviewerKey: f.reviewerKey, reviewerLabel: label[f.reviewerKey] || f.reviewerKey,
          reviewer: { userId: f.author.userId, name: f.author.name, email: f.author.email }, coaching: f.coaching, feedback: f.feedback, updatedAt: f.updatedAt, version: f.version, discussedAt: f.discussedAt || null, discussedVersion: f.discussedVersion || 0 })),
        ack: !e.linked ? { status: 'not_available', by: null, at: null } : ack ? { status: 'acknowledged', by: { userId: ack.by.userId, name: ack.by.name, email: ack.by.email }, at: ack.createdAt } : { status: 'not_acknowledged', by: null, at: null } };
    });
    await KpiSnapshot.init();   // the unique index stops two snapshots for one month, even from requests at the same moment
    try {
      const s = await KpiSnapshot.create({ period: p, scope, timezone: SH.KPI_REVIEW.timezone, source: data.source, dataReadAt: data.readAt,
        createdBy: { ...who(req.user), as: 'reviewer:' + req.kr.slot.key }, employees: employeesOut });
      res.status(201).json({ snapshot: snapOut(s.toObject()) });
    } catch (err) { if (err.code !== 11000) throw err; return dup(await exists()); }
  });
}

module.exports = { kpiReviewRoutes, reviewerSlot, labelKey };
