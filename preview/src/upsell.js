'use strict';
// Upselling (Code.gs apiGetUpsellAudience / apiUpsellTag / apiUpsellImage / apiUpsellSend / apiUpsellOptOut): offers
// to clients from the Direct Clients board, sent 1:1 through respond.io or tagged for a respond.io broadcast.
//
// It can send real messages, so every send is operator-controlled:
//   - drafts, audiences and previews never send anything; sending needs RESPOND_SENDS=on, edit access to Upselling
//     and an explicit confirmation carrying the fingerprint of the exact recipients and message the operator reviewed
//     (if anything changed since, nothing is sent and the page asks to review again);
//   - recipients are always worked out here from the leads this member may see; the page can't name contacts;
//   - one record per client and campaign is written before each send (unique index: no client gets it twice), then
//     marked sent / failed; a record left "sending" (server stopped mid-send) is never retried automatically;
//   - batches of at most 40, 700 ms apart, one batch at a time per campaign; a rejected token or rate limit stops it.
const crypto = require('crypto');
const express = require('express');
const SH = require('../public/shared');
const { Lead, LeadOverride, Project, UpsellCampaign, UpsellSend, UpsellOptOut } = require('./models');
const { need, leadScope, scopeExternal } = require('./access');
const media = require('./projectMedia');
const { createRespondSender, SendError } = require('./integrations/respondio');

const UP = SH.UPSELL;
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const by = (req) => ({ name: req.user.name, userId: req.user._id });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function upsellRoutes(r, config, integ) {
  const rc = config.integrations.respond;
  const sender = rc.token && rc.sends ? createRespondSender(rc) : null;
  const view = need('upsell', 'view'), edit = need('upsell', 'edit');
  const official = /^https:\/\/api\.respond\.io\//.test(rc.apiUrl + '/');

  /** Every client this member may see, as audience rows (Monday when connected, else MongoDB), with offers and opt-outs. */
  // excludeCampaign: "last offer" leaves out that campaign's own sends (they are tracked per client by its records,
  // so its recipients stay on its list with their status instead of dropping out after the send)
  async function clientRows(user, excludeCampaign) {
    let source, leads, tenants = new Set();
    if (integ.monday) {
      const all = await integ.monday.loadAll(false);
      if (all.errors.leads) { const e = new Error('The Monday leads board could not be read: ' + all.errors.leads); e.integration = 'monday'; throw e; }
      leads = scopeExternal(user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads; source = 'monday';
      // tenants: a closed or contracted (not failed) deal on the Calendar board, as the Renewals screen reads leases
      (all.deals || []).forEach((d) => { if (d.leadId && !SH.dealFailed(d) && (d.contract || /^closed$/i.test(String(d.status || '').trim()) || d.exp)) tenants.add(d.leadId); });
    } else {
      source = 'mongo';
      const ovs = new Set((await LeadOverride.find({ source: 'mongo', failed: { $ne: null } }, { leadId: 1 }).lean()).map((o) => o.leadId));
      leads = (await Lead.find(await leadScope(user)).limit(20000).lean()).map((l) => ({ ...l, id: String(l._id), clientStatus: ovs.has(String(l._id)) ? 'Failed' : l.status }));
      leads.forEach((l) => { if (l.leaseEnd || /closed/i.test(l.clientStatus)) tenants.add(l.id); });
    }
    const ids = leads.map((l) => String(l.id));
    const [sent, outs] = await Promise.all([
      UpsellSend.aggregate([{ $match: { source, leadId: { $in: ids }, action: 'message', status: 'sent', ...(excludeCampaign ? { campaignId: { $ne: excludeCampaign } } : {}) } }, { $group: { _id: '$leadId', at: { $max: '$updatedAt' } } }]),
      UpsellOptOut.find({ source, leadId: { $in: ids } }, { leadId: 1 }).lean(),
    ]);
    const last = new Map(sent.map((x) => [x._id, +x.at])), opted = new Set(outs.map((o) => o.leadId));
    const cidOf = (l) => String(l.contactId || '').replace(/\D/g, '');
    // an opt-out covers every lead with the same respond.io contact (a returning client can have two leads)
    const optedCids = new Set(leads.filter((l) => opted.has(String(l.id))).map(cidOf).filter(Boolean));
    return { source, rows: leads.map((l) => ({ id: String(l.id), source, name: l.name || '', email: l.email || '', phone: l.phone || '', status: l.clientStatus || l.status || '',
      type: l.inquiry === 'Buy' ? 'Buy' : l.inquiry === 'Rent' ? 'Rent' : '', city: l.city || '', building: l.building || '', va: l.va || '',
      contactId: cidOf(l), onRespond: !!cidOf(l), tenant: tenants.has(String(l.id)), lastOffer: last.get(String(l.id)) || 0,
      optedSelf: opted.has(String(l.id)), optedOut: opted.has(String(l.id)) || (!!cidOf(l) && optedCids.has(cidOf(l))) })) };
  }
  /**
   * The campaign's audience now, and the exact next batches: send (new clients), tag, retry (failed only). Each batch
   * has a fingerprint over its client IDs, the message, image and tag: a confirmation must carry the one reviewed.
   * One respond.io contact is never in a batch twice, nor sent to again when another of its leads already got it.
   */
  async function audienceOf(user, c) {
    const { source, rows } = await clientRows(user, c._id);
    const list = SH.upsellAudience(rows, c.audience, Date.now());
    const recs = await UpsellSend.find({ campaignId: c._id, source }).lean();
    const batch = (action, retry) => {
      const mine = new Map(recs.filter((r) => r.action === action).map((r) => [r.leadId, r]));
      const done = new Set(recs.filter((r) => r.action === action && r.contactId && r.status !== 'failed').map((r) => r.contactId));
      const seen = new Set(), out = [];
      for (const x of list) {
        if (!x.onRespond || x.optedOut || done.has(x.contactId) || seen.has(x.contactId)) continue;
        const r = mine.get(x.id);
        if (retry ? !(r && r.status === 'failed') : !!r) continue;
        seen.add(x.contactId); out.push(x);
        if (out.length >= UP.batchMax) break;
      }
      const hash = crypto.createHash('sha256').update(JSON.stringify([source, action, !!retry, out.map((x) => x.id), c.text, c.image ? c.image.id : '', c.tag])).digest('hex').slice(0, 32);
      return { list: out, hash };
    };
    return { source, rows, list, recs, batches: { message: batch('message', false), tag: batch('tag', false), retry: batch('message', true) } };
  }
  const recipientOut = (x) => ({ id: x.id, name: x.name, status: x.status, type: x.type, city: x.city, email: x.email, phone: x.phone, onRespond: x.onRespond, tenant: x.tenant, lastOffer: x.lastOffer || null });
  const failed = (res, err) => { if (!err.integration) throw err; res.status(err.httpStatus || 502).json({ error: err.message }); };
  async function campaignFor(req, res) {
    const c = SH.isId24(req.params.id) ? await UpsellCampaign.findById(req.params.id) : null;
    if (!c) res.status(404).json({ error: 'Offer not found.' });
    return c;
  }
  const imageUrl = (c) => (c.image ? `${config.web.apiOrigin}/upsell-media/${c.image.token}` : '');

  r.get('/upsell/meta', view, async (req, res) => {
    // without Project Pages access, only published projects (their pages are public anyway)
    const projects = (await Project.find(SH.access(req.user, 'pages') !== 'none' ? {} : { published: true }, { name: 1, developer: 1, published: 1 }).sort({ developer: 1, name: 1 }).limit(500).lean())
      .map((p) => ({ id: String(p._id), name: p.name, developer: p.developer, published: p.published }));
    res.json({ templates: SH.upsellTemplates(), projects, respond: !!rc.token, sends: !!sender,
      sendsNote: !rc.token ? 'respond.io is not connected (RESPOND_TOKEN).' : !rc.sends ? 'Sending is switched off on this server (RESPOND_SENDS is not "on"). Drafts, audiences, previews and the CSV work; nothing can be sent or tagged.' : '' });
  });
  r.get('/upsell/campaigns', view, async (req, res) => {
    const list = await UpsellCampaign.find({}, { text: 0 }).sort({ updatedAt: -1 }).limit(200).lean();
    const counts = await UpsellSend.aggregate([{ $group: { _id: { c: '$campaignId', s: '$status', a: '$action' }, n: { $sum: 1 } } }]);
    res.json({ campaigns: list.map((c) => ({ id: String(c._id), name: c.name, template: c.template, updatedAt: c.updatedAt, by: c.updatedBy && c.updatedBy.name,
      counts: counts.filter((x) => String(x._id.c) === String(c._id)).reduce((o, x) => { o[x._id.a + ':' + x._id.s] = x.n; return o; }, {}) })) });
  });
  r.post('/upsell/campaigns', edit, async (req, res) => {
    const b = req.body || {};
    if (Object.keys(b).some((k) => !['name', 'template'].includes(k))) return bad(res, 'Invalid request.');
    const { value, errors } = SH.validateCampaign({ name: b.name, template: b.template || 'concierge', version: 1 });
    if (errors.length) return bad(res, errors[0]);
    const t = SH.upsellTemplates().find((x) => x.k === value.template);
    const c = await UpsellCampaign.create({ name: value.name, template: value.template, text: t ? t.text : '', tag: SH.upsellTag(`upsell-${value.template}-${SH.manilaMonth()}`), createdBy: by(req), updatedBy: by(req) });
    res.status(201).json({ campaign: c });
  });
  r.get('/upsell/campaigns/:id', view, async (req, res) => { const c = await campaignFor(req, res); if (c) res.json({ campaign: c, imageUrl: c.image ? `/api/upsell/campaigns/${c.id}/image` : '' }); });
  r.put('/upsell/campaigns/:id', edit, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    const projectIds = (await Project.find({}, { _id: 1 }).lean()).map((p) => String(p._id));
    const { value, errors } = SH.validateCampaign(req.body, { projectIds });
    if (errors.length) return bad(res, errors[0]);
    const { version, ...set } = value;
    const done = await UpsellCampaign.findOneAndUpdate({ _id: c._id, version }, { $set: { ...set, updatedBy: by(req) }, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true });
    if (!done) return res.status(409).json({ conflict: true, error: 'This offer was changed in another tab or by someone else. Reload it, then make your changes again.' });
    res.json({ campaign: done });
  });
  r.delete('/upsell/campaigns/:id', edit, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    if (await UpsellSend.exists({ campaignId: c._id })) return res.status(409).json({ error: 'This offer has already been sent or tagged, so it is kept as a record.' });
    await UpsellCampaign.deleteOne({ _id: c._id }); if (c.image) await media.remove(c.image.id);
    res.json({ ok: true });
  });
  // a developer project's message (Code.gs apiBuildMailer text): name, developer, location, tagline, units, turnover, page link
  r.get('/upsell/project-text/:pid', view, async (req, res) => {
    const p = SH.isId24(req.params.pid) ? await Project.findById(req.params.pid).lean() : null;
    if (!p || (!p.published && SH.access(req.user, 'pages') === 'none')) return res.status(404).json({ error: 'Project not found.' });
    const link = p.published ? `${config.web.apiOrigin}/p/${p.slug}` : (p.pageUrl || '');
    const units = (p.units || []).slice(0, 4).map((u) => '• ' + [u.type, u.sizeSqm && u.sizeSqm + ' sqm', u.priceFrom && 'from ' + u.priceFrom].filter(Boolean).join(' · ')).join('\n');
    const text = [`Hi {firstName}! {va} from Blackhouse here.`, `${p.name}${p.developer ? ' by ' + p.developer : ''}${p.location ? ' in ' + p.location : ''}${p.tagline ? ' — ' + p.tagline : ''}.`,
      units, p.turnover ? 'Turnover: ' + p.turnover : '', link ? 'Units & floor plans: ' + link : '', 'Reply here if you\'d like the price list or a viewing.'].filter(Boolean).join('\n\n');
    res.json({ text: text.slice(0, UP.textMax), published: !!p.published });
  });

  // ----- the offer's image (JPEG / PNG / WebP / GIF up to 5 MB; kept in the portal's database) -----
  const rawBody = express.raw({ type: () => true, limit: UP.imageMax + 1024 });
  const readFile = (req, res, next) => rawBody(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Images can be 5 MB at most.' : 'The file could not be read.' }) : next()));
  r.post('/upsell/campaigns/:id/image', edit, readFile, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    if (await UpsellSend.exists({ campaignId: c._id, action: 'message' })) return res.status(409).json({ error: 'This offer has already been sent; its image can\'t change. Make a new offer.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), chk = media.checkFile(buf);
    if (chk.error) return bad(res, chk.error);
    if (!/^image\//.test(chk.type)) return bad(res, 'Only JPEG, PNG, WebP or GIF images.');
    if (buf.length > UP.imageMax) return bad(res, 'Images can be 5 MB at most.');
    let name = ''; try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { /* default */ }
    const id = await media.save(buf, { name: name || 'offer.png', type: chk.type, projectId: 'upsell:' + c.id, by: req.user.name });
    const old = c.image;
    const done = await UpsellCampaign.findByIdAndUpdate(c._id, { $set: { image: { id: String(id), token: crypto.randomBytes(24).toString('base64url'), name: media.cleanName(name || 'offer.png'), size: buf.length }, updatedBy: by(req) }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (old) await media.remove(old.id);
    res.status(201).json({ campaign: done });
  });
  r.delete('/upsell/campaigns/:id/image', edit, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    if (await UpsellSend.exists({ campaignId: c._id, action: 'message' })) return res.status(409).json({ error: 'This offer has already been sent; its image is kept.' });
    if (c.image) await media.remove(c.image.id);
    res.json({ campaign: await UpsellCampaign.findByIdAndUpdate(c._id, { $set: { image: null }, $inc: { version: 1 } }, { returnDocument: 'after' }) });
  });
  r.get('/upsell/campaigns/:id/image', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    if (!c.image || !(await media.send(res, c.image.id))) res.status(404).json({ error: 'No image.' });
  });

  // ----- audience, preview, CSV (read only; nothing is sent) -----
  r.get('/upsell/campaigns/:id/audience', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    try {
      const a = await audienceOf(req.user, c);
      const done = new Map(a.recs.map((s) => [s.action + ':' + s.leadId, s]));
      const statuses = [...new Set(a.rows.map((x) => x.status).filter(Boolean))].sort();
      const bOut = (k) => ({ hash: a.batches[k].hash, ids: a.batches[k].list.map((x) => x.id), names: a.batches[k].list.map((x) => x.name) });
      res.json({ source: a.source, total: a.rows.length, optedOut: a.rows.filter((x) => x.optedOut).length, statuses,
        batches: { message: bOut('message'), tag: bOut('tag'), retry: bOut('retry') },
        opted: a.rows.filter((x) => x.optedOut).slice(0, 500).map((x) => ({ id: x.id, name: x.name, self: x.optedSelf })),
        counts: { audience: a.list.length, respond: a.list.filter((x) => x.onRespond).length, email: a.list.filter((x) => x.email).length, phone: a.list.filter((x) => x.phone).length },
        recipients: a.list.slice(0, 2000).map((x) => ({ ...recipientOut(x), message: (done.get('message:' + x.id) || {}).status || '', tag: (done.get('tag:' + x.id) || {}).status || '' })) });
    } catch (err) { failed(res, err); }
  });
  r.get('/upsell/campaigns/:id/preview', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    let lead = { name: 'Maria Santos', building: '' };
    if (req.query.lead) { try { const a = await audienceOf(req.user, c); lead = a.list.find((x) => x.id === String(req.query.lead)) || lead; } catch (err) { return failed(res, err); } }
    res.json({ text: SH.upsellText(c.text, lead, req.user.name), to: lead.name, image: c.image ? `/api/upsell/campaigns/${c.id}/image` : '' });
  });
  r.get('/upsell/campaigns/:id/csv', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    try {
      const a = await audienceOf(req.user, c), q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&") + '"';   // no spreadsheet formulas
      const lines = [['email', 'first_name', 'full_name', 'phone', 'city', 'status', 'rent_or_sale', 'tenant'].join(',')]
        .concat(a.list.filter((x) => x.email).map((x) => [x.email, x.name.split(/\s+/)[0], x.name, x.phone, x.city, x.status, x.type, x.tenant ? 'yes' : ''].map(q).join(',')));
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="blackhouse-upsell-${c.id}.csv"` }).send(lines.join('\r\n'));
    } catch (err) { failed(res, err); }
  });
  // opt-outs: only for clients this member can see (checked here)
  r.post('/upsell/optout', edit, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).some((k) => !['ids', 'on'].includes(k)) || !Array.isArray(b.ids) || !b.ids.length || b.ids.length > 500 || typeof b.on !== 'boolean' || b.ids.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(x))) return bad(res, 'Invalid request.');
    try {
      const { source, rows } = await clientRows(req.user), mine = new Set(rows.map((x) => x.id)), ids = b.ids.filter((x) => mine.has(x));
      if (ids.length !== b.ids.length) return res.status(404).json({ error: 'Some of those clients aren\'t in your list.' });
      if (b.on) await UpsellOptOut.bulkWrite(ids.map((leadId) => ({ updateOne: { filter: { source, leadId }, update: { $setOnInsert: { source, leadId, by: by(req) } }, upsert: true } })));
      else await UpsellOptOut.deleteMany({ source, leadId: { $in: ids } });
      res.json({ ok: true, count: ids.length });
    } catch (err) { failed(res, err); }
  });

  // ----- sending (messages or tags), confirmed by the operator; results per client -----
  r.post('/upsell/campaigns/:id/send', edit, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).some((k) => !['confirm', 'hash', 'action', 'retry'].includes(k)) || b.confirm !== true || typeof b.hash !== 'string' || !['message', 'tag'].includes(b.action) || (b.retry !== undefined && typeof b.retry !== 'boolean')) {
      return bad(res, 'Review the recipients and confirm the send.');
    }
    if (!rc.token) return res.status(409).json({ error: 'respond.io is not connected (RESPOND_TOKEN).', sendsOff: true });
    if (!sender) return res.status(409).json({ error: 'Sending is switched off on this server (RESPOND_SENDS). Nothing was sent.', sendsOff: true });
    const c = await campaignFor(req, res); if (!c) return;
    if (b.action === 'message' && !c.text.trim()) return bad(res, 'Write the message first.');
    if (b.action === 'tag' && !c.tag) return bad(res, 'Set a respond.io tag first.');
    if (b.action === 'message' && c.image && official && !/^https:\/\//.test(config.web.apiOrigin)) return res.status(409).json({ error: 'respond.io can only fetch the image from the portal\'s public https address (PUBLIC_API_URL). Remove the image or send from the hosted portal.' });
    if (b.retry && b.action !== 'message') return bad(res, 'Only messages can be retried.');
    // one batch at a time per campaign; the lock is ours only while it carries our token (expires after 10 minutes)
    const lockToken = crypto.randomBytes(12).toString('hex');
    const lock = await UpsellCampaign.findOneAndUpdate({ _id: c._id, $or: [{ sendingUntil: null }, { sendingUntil: { $lt: new Date() } }] }, { $set: { sendingUntil: new Date(Date.now() + 10 * 60e3), sendLock: lockToken } });
    if (!lock) return res.status(409).json({ error: 'A batch for this offer is already being sent. Wait for it to finish.' });
    const results = []; let stopped = '', retryAfter = 0;
    try {
      // the batch is worked out again now; it must be exactly the one the operator reviewed
      let a; try { a = await audienceOf(req.user, c); } catch (err) { return failed(res, err); }
      const bt = a.batches[b.retry ? 'retry' : b.action];
      if (bt.hash !== b.hash) return res.status(409).json({ stale: true, error: 'The recipients or the message changed since you reviewed them (for example, someone else sent part of this offer). Nothing was sent: review the list again and confirm.' });
      const targets = bt.list;
      // opt-outs checked again right before sending, by client and by respond.io contact
      const outIds = new Set((await UpsellOptOut.find({ source: a.source, leadId: { $in: a.rows.map((x) => x.id) } }, { leadId: 1 }).lean()).map((o) => o.leadId));
      const outCids = new Set(a.rows.filter((x) => outIds.has(x.id) && x.contactId).map((x) => x.contactId));
      for (const x of targets) {
        if (outIds.has(x.id) || outCids.has(x.contactId)) { results.push({ id: x.id, name: x.name, status: 'skipped', error: 'opted out' }); continue; }
        // the record first: if it can't be written (or another send got there first, for this client or contact), nothing is sent
        const key = { campaignId: c._id, source: a.source, leadId: x.id, action: b.action };
        let rec;
        try {
          rec = b.retry ? await UpsellSend.findOneAndUpdate({ ...key, status: 'failed' }, { $set: { status: 'sending', error: '', by: by(req) }, $inc: { attempts: 1 } }, { returnDocument: 'after' })
            : await UpsellSend.create({ ...key, contactId: x.contactId, status: 'sending', by: by(req) });
        } catch (err) { if (err.code !== 11000) throw err; rec = null; }
        if (!rec) { results.push({ id: x.id, name: x.name, status: 'skipped', error: 'already handled' }); continue; }
        const steps = { ...(rec.steps || {}) };
        try {
          if (b.action === 'tag') await sender.tag(x.contactId, c.tag);
          else {
            if (c.image && !steps.image) { await sender.image(x.contactId, imageUrl(c)); steps.image = true; await sleep(400); }
            await sender.text(x.contactId, SH.upsellText(c.text, x, req.user.name)); steps.text = true;
          }
          await UpsellSend.updateOne({ _id: rec._id }, { $set: { status: 'sent', steps, error: '' } });
          results.push({ id: x.id, name: x.name, status: 'sent' });
        } catch (err) {
          if (!(err instanceof SendError)) throw err;   // anything else: the record stays "sending" (outcome unknown), never retried by itself
          // a timeout, network error or server error may have been delivered: "unknown" (stays 'sending'), for a person
          // to check in respond.io; never retried in bulk. A clear refusal is 'failed' and can be retried.
          await UpsellSend.updateOne({ _id: rec._id }, { $set: { status: err.unknown ? 'sending' : 'failed', steps, error: String(err.message).slice(0, 300) } });
          results.push({ id: x.id, name: x.name, status: err.unknown ? 'unknown' : 'failed', error: err.message });
          if (err.stop) { stopped = err.message; retryAfter = err.retryAfter || 0; break; }
        }
        await sleep(UP.gapMs);
      }
    } finally { await UpsellCampaign.updateOne({ _id: c._id, sendLock: lockToken }, { $set: { sendingUntil: null, sendLock: '' } }); }
    if (retryAfter) res.set('Retry-After', String(retryAfter));
    res.json({ results, stopped });
  });
  // an "unknown" send (the server couldn't tell whether respond.io delivered it), settled by a person who checked the chat
  r.post('/upsell/campaigns/:id/resolve', edit, async (req, res) => {
    const b = req.body;
    const action = b && b.action === undefined ? 'message' : b && b.action;
    if (!b || Object.keys(b).some((k) => !['leadId', 'outcome', 'action'].includes(k)) || typeof b.leadId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(b.leadId) || !['sent', 'failed'].includes(b.outcome) || !['message', 'tag'].includes(action)) return bad(res, 'Invalid request.');
    const c = await campaignFor(req, res); if (!c) return;
    try { if (!(await clientRows(req.user)).rows.some((x) => x.id === b.leadId)) return res.status(404).json({ error: 'Client not found.' }); } catch (err) { return failed(res, err); }
    const done = await UpsellSend.findOneAndUpdate({ campaignId: c._id, leadId: b.leadId, action, status: 'sending' },
      { $set: { status: b.outcome, error: b.outcome === 'sent' ? '' : 'Checked: not delivered.', by: by(req) } }, { returnDocument: 'after' });
    if (!done) return res.status(409).json({ error: 'That send isn\'t waiting for a check.' });
    res.json({ ok: true });
  });
  r.get('/upsell/campaigns/:id/results', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    const recs = await UpsellSend.find({ campaignId: c._id }).sort({ updatedAt: -1 }).limit(5000).lean();
    let names = new Map();
    try { names = new Map((await clientRows(req.user)).rows.map((x) => [x.id, x.name])); } catch (e) { /* names only */ }
    // results only for clients this member can see
    res.json({ results: recs.filter((s) => names.has(s.leadId)).map((s) => ({ id: s.leadId, name: names.get(s.leadId), action: s.action, status: s.status, error: s.error, attempts: s.attempts, at: s.updatedAt, by: s.by && s.by.name, steps: s.steps })) });
  });
}

/** The offer image's public link for respond.io (an unguessable token; only images attached to an offer). */
function upsellPublicRoutes() {
  const r = express.Router();
  r.get('/upsell-media/:token', async (req, res) => {
    const t = String(req.params.token);
    const c = /^[A-Za-z0-9_-]{32}$/.test(t) ? await UpsellCampaign.findOne({ 'image.token': t }, { image: 1 }).lean() : null;
    if (!c || !(await media.send(res, c.image.id, { cache: 'public, max-age=86400' }))) res.status(404).type('text/plain').send('Not found');
  });
  return r;
}

module.exports = { upsellRoutes, upsellPublicRoutes };
