'use strict';
// AI Status, Temperature, reply state and Days in Stage for leads read from Monday.com, ported from Code.gs
// (aiStatus_/aiStatusOne_, computePipeline_, stageSegments_, leadStart_, temperature_, apiGetReplyStates).
// All functions are pure and take `now`, so the rules can be tested exactly.
//
// Not available outside Apps Script, and therefore NOT used here:
//  - portal viewings/LOIs kept in Script Properties (vw_, hv_ human checks, lc_ LOI confidence)
//  - the AI chat-timeline file in Google Drive (AI stage guesses and AI-dated milestones)
// In their place, the Monday "AI STATUS" column (which the live portal writes back) is used as the stage
// when no Calendar proof exists. See SOURCE-COVERAGE.md.

const AI_STAGES = ['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection', 'Active', 'For Renewal', 'Failed', 'Not on Respond.io'];
const TRACKED = ['Property Matching', 'Scheduling', 'LOI', 'Contract', 'Collection'];
const DAY = 864e5;
const normT = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const titleCase = (x) => String(x || '').toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const num = (t) => { const m = String(t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
const ymd = (s) => (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
const msOf = (d) => (d ? new Date(d + 'T12:00:00').getTime() : 0);
const fmtD = (d) => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
const peso = (n) => '₱' + Math.round(n).toLocaleString('en-PH');

/** Months in a lease term like "1 year", "6 months" (default 12). */
function leaseMonths(t) { const s = String(t || '').toLowerCase(), n = num(s); if (!n) return 12; return /month|mo\b|mos\b/.test(s) ? n : n * 12; }

/** Stage from one status text (Code.gs aiStatusOne_ without portal viewings). */
function aiStatusOne(l, statusText, now) {
  const st = normT(statusText), grp = normT(l.group), has = (re) => re.test(st);
  const isLease = !/buy|sale|purchase/.test(normT(l.inquiry));
  if (has(/fail|lost|dead|cancel|not interested|closed lost|unqualified|disqualif|junk/)) return { stage: 'Failed', sub: titleCase(statusText) };
  const closed = has(/^closed$|closed won|\bwon\b|^active$|active tenant|active lease|moved in|occupied|turned over|turnover/) || (/^closed$/.test(grp) && !has(/fail|lost/));
  if (closed || has(/renew/)) {
    if (has(/renew/)) return { stage: 'For Renewal', sub: '' };
    if (isLease) {
      const mi = Date.parse(l.moveIn || '');
      if (!isNaN(mi)) {
        const end = new Date(mi); end.setMonth(end.getMonth() + leaseMonths(l.leaseTerm));
        const days = Math.round((end - now) / DAY);
        if (days <= 61 && days >= -30) return { stage: 'For Renewal', sub: days >= 0 ? 'Lease ends in ' + days + ' days' : 'Lease ended ' + (-days) + ' days ago' };
      }
    }
    if (closed) return { stage: 'Active', sub: '' };
  }
  if (has(/collect|payment|billing|for payment/)) return { stage: 'Collection', sub: '' };
  if (has(/contract|lease signing|for signing|deed/)) return { stage: 'Contract', sub: '' };
  if (has(/\bloi\b|letter of intent|negotiat|offer/)) return { stage: 'LOI', sub: has(/negotiat/) ? 'Negotiating' : has(/approval|sent/) ? titleCase(statusText) : '' };
  if (has(/schedul|viewing/)) return { stage: 'Scheduling', sub: has(/set|confirm/) ? 'Schedule Set' : '' };
  return { stage: 'Property Matching', sub: has(/sourc/) ? 'Sourcing for Unit' : st && !has(/^new (lead|inquiry)$/) ? titleCase(statusText) : '' };
}
/** Next Action first; when that only says Property Matching, the board's Status column may move it further (Code.gs aiStatus_). */
function aiStatus(l, now) {
  const a = aiStatusOne(l, l.nextAction, now);
  if (a.stage !== 'Property Matching' || !l.boardStatus) return a;
  const b = aiStatusOne(l, l.boardStatus, now);
  return AI_STAGES.indexOf(b.stage) > AI_STAGES.indexOf(a.stage) && b.stage !== 'Failed' ? b : a;
}

/** When the client first enquired: earlier of Monday creation time and Date of Inquiry. */
function leadStart(l) {
  const c = Date.parse(l.createdAt || '') || 0;
  const m = String(l.inquiryDate || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  const q = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9).getTime() : 0;
  return q && (!c || q < c) ? q : c;
}

/** Days per stage from dated milestones (Code.gs stageSegments_ without the AI timeline / portal viewings). */
function segments(l, lm, now) {
  lm = lm || {};
  const min = (...a) => { const v = a.filter(Boolean); return v.length ? Math.min(...v) : 0; };
  const start = leadStart(l) || now;
  const D = {
    m: start,
    s: lm.booked || 0,
    l: min(msOf(lm.dc), msOf(lm.ds)),
    c: min(msOf(lm.cd), !lm.cd && (lm.cfiles || 0) && (msOf(lm.ds) || msOf(lm.dc)) ? Math.max(msOf(lm.ds) || 0, msOf(lm.dc) || 0) + DAY : 0),
    cs: (lm.sfiles || 0) ? (msOf(lm.cd) || now) : 0,
    co: (lm.sfiles || 0) ? (msOf(lm.cd) || now) : 0,
    p: lm.paid > 0 ? (msOf(lm.cd) || now) : 0,
    f: msOf(ymd(l.failedDate)),
  };
  const end = D.f || D.p || now;
  const seq = [['Property Matching', D.m], ['Scheduling', D.s], ['LOI', D.l], ['Contract', D.c], ['Collection', D.co]].filter((x) => x[1] && x[1] <= end);
  seq.sort((a, b) => a[1] - b[1]);
  const segs = []; let lastIdx = -1;
  seq.forEach((x) => { const i = TRACKED.indexOf(x[0]); if (i > lastIdx || x[0] === 'Property Matching') { segs.push({ s: x[0], from: x[1] }); lastIdx = Math.max(lastIdx, i); } });
  if (!segs.length || segs[0].s !== 'Property Matching') segs.unshift({ s: 'Property Matching', from: Math.min(start, segs.length ? segs[0].from : start) });
  const out = [];
  segs.forEach((g, i) => {
    const to = i + 1 < segs.length ? segs[i + 1].from : end;
    const lim = g.s === 'LOI' ? 5 : g.s === 'Contract' && !(D.cs && D.cs <= to) ? 5 : 0;   // LOI / unsigned contract: 5 days, then back to matching
    if (lim && to - g.from > lim * DAY) { out.push({ s: g.s, from: g.from, to: g.from + lim * DAY }); out.push({ s: 'Property Matching', from: g.from + lim * DAY, to, back: g.s }); }
    else out.push({ s: g.s, from: g.from, to });
  });
  const days = {};
  out.forEach((g) => { days[g.s] = (days[g.s] || 0) + Math.max(0, g.to - g.from) / DAY; });
  Object.keys(days).forEach((k) => { days[k] = Math.round(days[k] * 10) / 10; });
  const last = out[out.length - 1] || { s: 'Property Matching' };
  return { days, cur: D.p ? 'Active' : D.f ? 'Failed' : last.s, back: last.back || '' };
}

/** Who owes the next message, from respond.io messages (Code.gs apiGetReplyStates). msgs: shaped messages, any order. */
function replyState(msgs, now) {
  const list = (msgs || []).filter(Boolean).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0) || (Number(b.id) || 0) - (Number(a.id) || 0));   // newest first
  if (!list.length) return null;
  const HUMAN = { user: 1, echo: 1, api: 1 };   // respond.io user, phone app, portal; AI agent / workflow / broadcast are not replies
  const lastHuman = list.findIndex((m) => m.from !== 'client' && HUMAN[m.src]);
  const newer = lastHuman === -1 ? list : list.slice(0, lastHuman);
  const clientMsgs = newer.filter((m) => m.from === 'client');
  const newest = list[0];
  let st;
  if (!clientMsgs.length) st = { waiting: 'client', since: newest.ts || 0, by: newest.who };
  else {
    const first = clientMsgs[clientMsgs.length - 1];
    st = { waiting: 'va', since: first.ts || 0, approx: !first.ts || (lastHuman === -1 && list.length >= 15), by: newest.who, botReplied: newest.from !== 'client' };
  }
  st.lastText = (newest.url ? '[' + (newest.fileType || 'file') + ']' : newest.text || '').replace(/\s+/g, ' ').slice(0, 90);
  const lastIn = list.find((m) => m.from === 'client');
  const idxIn = lastIn ? list.indexOf(lastIn) : list.length;
  st.lastInAt = lastIn && lastIn.ts ? lastIn.ts : 0;
  st.lastAt = newest.ts || 0;
  st.outAfterIn = list.slice(0, idxIn).filter((m) => m.from !== 'client').length;
  st.in48 = list.filter((m) => m.from === 'client' && m.ts && now - m.ts < 48 * 3600e3).length;
  st.inCount = list.filter((m) => m.from === 'client').length;
  st.total = list.length;
  return st;
}

/** Temperature (Code.gs temperature_; the no-chat fallback uses lead start only, since portal activity isn't available). rsErr: why the last chat check failed. */
function temperature(stage, r, l, now, rsErr) {
  if (stage === 'Active' || stage === 'For Renewal') return { temp: 'Active', tempWhy: 'Closed client' };
  if (stage === 'Not on Respond.io') return { temp: 'Not on Respond.io', tempWhy: 'No respond.io chat linked' };
  if (stage === 'Failed') return { temp: 'Dead', tempWhy: 'Lead marked as failed' };
  // chat not read: no guessed temperature (the original guessed from the lead's age; that looked like a real status)
  if (!r) {
    return String(l.contactId || '').replace(/\D/g, '')
      ? { temp: 'Unchecked', tempWhy: rsErr ? 'respond.io check failed: ' + rsErr + ' It is tried again automatically.' : 'respond.io chat not checked yet. Open the Chat tab to check it.' }
      : { temp: 'Not on Respond.io', tempWhy: 'No respond.io chat linked' };
  }
  const lastIn = r.lastInAt || 0;
  const ago = lastIn ? (now - lastIn) / DAY : (now - (r.lastAt || now)) / DAY;
  if (r.waiting === 'va') {
    if (r.in48 >= 2 || ago < 1) return { temp: 'Hot', tempWhy: 'Client is messaging — ' + (r.in48 || 1) + ' message' + ((r.in48 || 1) === 1 ? '' : 's') + ' in 48h' };
    if (ago >= 7) return { temp: 'Dead', tempWhy: 'Client\'s last message was ' + Math.floor(ago) + 'd ago and was never answered' };
    if (ago >= 3) return { temp: 'Lost', tempWhy: 'Client messaged ' + Math.floor(ago) + 'd ago — still waiting for our reply' };
    return { temp: 'Warm', tempWhy: 'Client messaged ' + Math.floor(ago) + 'd ago — waiting for our reply' };
  }
  if (!lastIn && !r.inCount) {
    if (ago >= 7) return { temp: 'Dead', tempWhy: 'Never replied · 7+ days' };
    if (ago >= 3) return { temp: 'Lost', tempWhy: 'Never replied · 3+ days' };
    return { temp: 'Cold', tempWhy: 'Has not replied yet' };
  }
  if (ago >= 7) return { temp: 'Dead', tempWhy: 'No reply for ' + Math.floor(ago) + ' days' };
  if (ago >= 3) return { temp: 'Lost', tempWhy: 'No reply for ' + Math.floor(ago) + ' days' };
  if (r.outAfterIn >= 2 && ago >= 1) return { temp: 'Cold', tempWhy: r.outAfterIn + ' of our messages unanswered' };
  const ratio = r.total ? r.inCount / r.total : 0;
  if (r.in48 >= 3 || (ago < 0.5 && ratio >= 0.4)) return { temp: 'Hot', tempWhy: 'Replying quickly — ' + r.in48 + ' messages in 48h' };
  return { temp: 'Warm', tempWhy: 'Replies sometimes · last reply ' + (ago < 1 ? Math.max(1, Math.round(ago * 24)) + 'h' : Math.floor(ago) + 'd') + ' ago' };
}

/**
 * Full status for one Monday lead.
 * lm: Calendar LOI/contract evidence for the lead ({ ds, dc, cd, files, cfiles, sfiles, paid, booked }); rs: reply state or null.
 * Returns { ai, aiSub, aiSource: 'proof'|'monday'|'rules', workStage, temp, tempWhy, waiting, daysInStage, stageDays, ... }.
 * workStage: the stage from the same evidence, ignoring whether a respond.io chat is linked (ai says 'Not on Respond.io' then).
 */
function computeLead(l, lm, rs, now, rsErr) {
  const cid = String(l.contactId || '').replace(/\D/g, '');
  const rules = aiStatus(l, now);
  const ai = cid ? rules : { stage: 'Not on Respond.io', sub: 'No respond.io chat linked' };
  // Calendar Contract Date can also come from the Direct Clients "Contract Date" column
  const cdLead = ymd(l.contractDate);
  if (cdLead && !(lm && lm.cd)) lm = Object.assign({ files: 0, cfiles: 0, sfiles: 0 }, lm || {}, { cd: cdLead });
  const paid = lm ? lm.paid || 0 : 0;
  const cs = String(l.clientStatus || '').trim(), label = String(l.aiStatusLabel || '').trim();
  const reopened = /^(active|qualified|late move-in|closed)$/i.test(cs);
  const failedHand = /^(failed|disqualified|called - failed|unresponsive)$/i.test(cs) || (!reopened && /^failed$/i.test(label));
  /** Stage from the evidence, in order; `a` is the rules stage and `linked` whether the Monday AI STATUS may be used. */
  function pick(a, linked) {
    // 1) proof: failed by hand · signed contract / Total Paid / Contract Date / LOI on the Calendar board
    let hard = null;
    if (failedHand) hard = { stage: 'Failed', sub: String(l.failReason || (/^failed$/i.test(label) && !/fail|disqualif|unresponsive/i.test(cs) ? 'Set to Failed on Monday' : cs) || '').slice(0, 80) };
    else if (a.stage === 'Failed' || a.stage === 'For Renewal') hard = a;
    else if (lm && lm.sfiles) hard = paid > 0 ? { stage: 'Active', sub: 'Collected ' + peso(paid) } : { stage: 'Collection', sub: 'Signed contract on file — Total Paid empty on the Calendar' };
    else if (paid > 0) hard = { stage: 'Active', sub: 'Collected ' + peso(paid) };
    else if (lm && lm.cd) hard = now - msOf(lm.cd) > 5 * DAY ? { stage: 'Property Matching', sub: 'Contract ' + fmtD(lm.cd) + ' not signed after 5 days — back to matching' } : { stage: 'Contract', sub: 'Contract date ' + fmtD(lm.cd) };
    else if (lm && (lm.ds || lm.dc || lm.files || lm.cfiles)) {
      const d0 = lm.ds || lm.dc || '';
      hard = lm.cfiles ? { stage: 'Contract', sub: 'Contract file on the Calendar — LOI signed by the owner' }
        : d0 && now - msOf(d0) > 5 * DAY ? { stage: 'Property Matching', sub: 'LOI ' + fmtD(d0) + ' not signed by the owner after 5 days — back to matching' }
        : { stage: 'LOI', sub: d0 ? 'LOI ' + fmtD(d0) + ' · waiting for the owner to sign' : 'LOI on file' };
    }
    if (hard) return { out: hard, source: 'proof' };
    if (linked && AI_STAGES.includes(label) && label !== 'Not on Respond.io') {
      // 2) no proof: the AI STATUS the live portal last wrote to Monday (it includes the AI chat reading and human checks)
      const detail = String(l.aiStatusText || ''), i = detail.indexOf(' — ');
      return { out: { stage: label, sub: i > 0 && detail.slice(0, i) === label ? detail.slice(i + 3) : 'From Monday AI STATUS (set by the live portal)' }, source: 'monday' };
    }
    return { out: a, source: 'rules' };   // 3) rules on the Next Action / Status text
  }
  const { out, source } = pick(ai, !!cid);
  // the same evidence without the respond.io link check: a lead with no Respond ID can still be in property sourcing
  const work = cid ? out : pick(rules, true).out;
  const seg = segments(l, lm, now);
  const t = temperature(out.stage, rs, l, now, rs ? '' : rsErr);
  return {
    ai: out.stage, aiSub: out.sub || '', aiSource: source, workStage: work.stage,
    temp: t.temp, tempWhy: t.tempWhy,
    waiting: rs ? rs.waiting : '', since: rs ? rs.since : 0, lastText: rs ? rs.lastText : '', replyChecked: !!rs, replyError: !rs && cid ? rsErr || '' : '',
    onRespond: !!cid && (rs ? rs.total > 0 : true),
    daysInStage: seg.days[out.stage] != null ? Math.round(seg.days[out.stage]) : TRACKED.includes(out.stage) ? 0 : null,
    stageDays: seg.days,
  };
}

module.exports = { aiStatus, aiStatusOne, leadStart, segments, replyState, temperature, computeLead, leaseMonths, AI_STAGES, TRACKED };
