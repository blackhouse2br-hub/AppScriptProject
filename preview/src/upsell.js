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
const { Lead, LeadOverride, Project, UpsellCampaign, UpsellSend, UpsellOptOut, UpsellLegacy } = require('./models');
const { createMailer } = require('./mailer');

// the Apps Script's mailer branding (Code.gs CONFIG.LOGO_URL / SITE_URL): the company's public logo and site
const LOGO_URL = 'https://www.blackhouse.ph/wp-content/uploads/2026/07/Blackhouse-Logo-White-300x33.png', SITE_URL = 'https://www.blackhouse.ph';
const e = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * Code.gs apiBuildMailer: an email-safe HTML mailer (logo, the offer, a button, unsubscribe) and its subject. Merge
 * tags {{first_name}} / {{unsubscribe}} are turned into Brevo's or Mailchimp's on the page.
 */
function buildMailer(c, p, pageUrl) {
  const wrap = (title, inner, cta) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:#F6F4F0;font-family:Poppins,Helvetica,Arial,sans-serif;color:#16130E">
<div style="display:none;max-height:0;overflow:hidden">${e(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff">
<tr><td style="background:#0A0D12;padding:22px 28px"><a href="${e(SITE_URL)}" style="text-decoration:none;color:#ffffff"><img src="${e(LOGO_URL)}" alt="BLACKHOUSE" width="170" style="display:block;width:170px;height:auto;border:0;color:#ffffff;font-size:18px;letter-spacing:3px;text-decoration:none"></a></td></tr>
${inner}
${cta ? `<tr><td align="center" style="padding:8px 28px 34px"><a href="${e(cta.url)}" style="display:inline-block;background:#16130E;color:#ffffff;text-decoration:none;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:14px 28px;border-radius:2px">${e(cta.label)}</a></td></tr>` : ''}
<tr><td style="background:#0A0D12;color:rgba(246,244,240,.7);font-size:12px;line-height:1.6;padding:22px 28px">Blackhouse Realty · High-end real estate in Metro Manila<br><a href="${e(SITE_URL)}" style="color:#ffffff">blackhouse.ph</a> · Reply to this email to talk to an advisor.<br><br>
<span style="color:rgba(246,244,240,.5)">You are receiving this because you inquired with Blackhouse. <a href="{{unsubscribe}}" style="color:rgba(246,244,240,.7)">Unsubscribe</a></span></td></tr>
</table></td></tr></table></body></html>`;
  if (p) {
    const url = pageUrl || SITE_URL + '/projects/', units = (p.units || []).filter((u) => u && u.type).slice(0, 4);
    const facts = [['Developer', p.developer], ['Location', p.location], ['Turnover', p.turnover], ['Price from', p.priceFrom]].filter((f) => f[1]);
    const inner = `<tr><td style="padding:30px 28px 6px"><div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(22,19,14,.6)">${e([p.developer, p.status].filter(Boolean).join(' · ') || 'New project')}</div>
<h1 style="margin:8px 0 6px;font-size:30px;font-weight:500;letter-spacing:-.5px">${e(p.name)}</h1>${p.tagline ? `<p style="margin:0;font-size:15px;line-height:1.6;color:rgba(22,19,14,.75)">${e(p.tagline)}</p>` : ''}</td></tr>
${facts.length ? `<tr><td style="padding:16px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e2da;border-bottom:1px solid #e6e2da"><tr>${facts.map((f) => `<td style="padding:12px 6px;vertical-align:top"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(22,19,14,.55)">${e(f[0])}</div><div style="font-size:14px;margin-top:4px">${e(f[1])}</div></td>`).join('')}</tr></table></td></tr>` : ''}
${p.description ? `<tr><td style="padding:6px 28px 10px;font-size:14px;line-height:1.7;color:rgba(22,19,14,.78)">${e(String(p.description).split(/\n{2,}/)[0])}</td></tr>` : ''}
${units.length ? `<tr><td style="padding:10px 28px"><div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(22,19,14,.6);margin-bottom:10px">Units available</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${units.map((u, i) => (i % 2 === 0 ? '<tr>' : '') + `<td width="50%" style="padding:6px;vertical-align:top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e2da"><tr><td style="padding:12px"><div style="font-size:16px">${e(u.type)}</div><div style="font-size:12px;color:rgba(22,19,14,.6);margin-top:4px">${e([u.bedrooms && u.bedrooms + ' BR', u.sizeSqm && u.sizeSqm + ' sqm'].filter(Boolean).join(' · '))}</div>${u.priceFrom ? `<div style="font-size:13px;margin-top:6px">From ${e(u.priceFrom)}</div>` : ''}</td></tr></table></td>` + (i % 2 === 1 || i === units.length - 1 ? '</tr>' : '')).join('')}</table></td></tr>` : ''}`;
    return { subject: p.name + (p.developer ? ' by ' + p.developer : '') + ' — units now available', html: wrap(p.name, inner, { label: 'View units & floor plans', url }), url };
  }
  const t = SH.upsellTemplates().find((x) => x.k === c.template) || { label: 'Blackhouse' };
  const label = c.template === 'concierge' ? 'Blackhouse Concierge' : t.label;
  const body = String(c.text || '').replace(/\{building\}/g, 'your unit').replace(/\{firstName\}/g, '{{first_name}}').replace(/\{va\}/g, 'the Blackhouse team');
  const inner = `<tr><td style="padding:32px 28px 8px"><div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(22,19,14,.6)">Blackhouse services</div><h1 style="margin:8px 0 14px;font-size:28px;font-weight:500;letter-spacing:-.5px">${e(label)}</h1>
<div style="font-size:15px;line-height:1.7;color:rgba(22,19,14,.8)">${e(body).replace(/\n/g, '<br>')}</div></td></tr>`;
  return { subject: label + ' — Blackhouse', html: wrap(label, inner, { label: 'Reply to book', url: SITE_URL + '/services/' }), url: SITE_URL + '/services/' };
}
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
  const onlyTo = rc.onlyTo || [];   // RESPOND_SEND_ONLY_TO: a controlled test, only these respond.io contacts
  const view = need('upsell', 'view'), edit = need('upsell', 'edit');
  const official = /^https:\/\/api\.respond\.io\//.test(rc.apiUrl + '/');
  const mailer = config.storage && config.storage.smtp ? createMailer(config.storage.smtp) : null;
  // the workspace's respond.io channels for the picker (read only; cached 6 hours, as Code.gs respondChannels_)
  let chans = { at: 0, list: [] };
  async function channels() {
    if (!integ.respond) return [];
    if (Date.now() - chans.at < 6 * 3600e3) return chans.list;
    try { chans = { at: Date.now(), list: await integ.respond.channels() }; } catch (err) { if (!err.integration) throw err; return chans.list; }
    return chans.list;
  }

  /** Every client this member may see, as audience rows (Monday when connected, else MongoDB), with offers and opt-outs. */
  // excludeCampaign: "last offer" leaves out that campaign's own sends (they are tracked per client by its records,
  // so its recipients stay on its list with their status instead of dropping out after the send)
  async function clientRows(user, excludeCampaign) {
    let source, leads, tenants = new Set(), tenantsNote = '';
    const leaseEnd = {};
    if (integ.monday) {
      const all = await integ.monday.loadAll(false);
      if (all.errors.leads) { const e = new Error('The Monday leads board could not be read: ' + all.errors.leads); e.integration = 'monday'; throw e; }
      leads = scopeExternal(user, { leads: all.leads, viewings: all.viewings, listings: [] }).leads; source = 'monday';
      // tenants: a closed or contracted (not failed) deal on the Calendar board, as the Renewals screen reads leases
      (all.deals || []).forEach((d) => { if (d.leadId && !SH.dealFailed(d) && (d.contract || /^closed$/i.test(String(d.status || '').trim()) || d.exp)) tenants.add(d.leadId); });
      // and a client whose own status or group is "Closed" (Code.gs isDeal_ reads the lead's status and group; the portal
      // reads Monday's status as two fields, Next Action and Client Status, so both are checked), unless failed
      leads.forEach((l) => { if (![l.nextAction, l.clientStatus].some((s) => /^(failed|lost|disqualif)/i.test(String(s || '').trim())) && [l.nextAction, l.clientStatus, l.group].some((s) => /^closed$/i.test(String(s || '').trim()))) tenants.add(String(l.id)); });
      if (all.errors.viewings || !all.calendarOk) tenantsNote = `The Monday Calendar board ${all.errors.viewings ? 'could not be read' : 'is not set up'}, so tenants are only the clients marked Closed on the leads board.`;
      // the lease end (Index.html upRows r[9], CSV tenant_lease_end): the latest Contract Expiration Date of a live deal
      (all.deals || []).forEach((d) => { if (d.leadId && d.exp && !SH.dealFailed(d) && (!leaseEnd[d.leadId] || d.exp > leaseEnd[d.leadId])) leaseEnd[d.leadId] = d.exp; });
      // Client Status only, as the Apps Script (r[4]); the board's other status field doesn't count
      leads = leads.map((l) => ({ ...l, clientStatus: l.clientStatus || '' }));
    } else {
      source = 'mongo';
      const ovs = new Set((await LeadOverride.find({ source: 'mongo', failed: { $ne: null } }, { leadId: 1 }).lean()).map((o) => o.leadId));
      leads = (await Lead.find(await leadScope(user)).limit(20000).lean()).map((l) => ({ ...l, id: String(l._id), clientStatus: ovs.has(String(l._id)) ? 'Failed' : l.status }));
      leads.forEach((l) => { if (l.leaseEnd || /closed/i.test(l.clientStatus)) tenants.add(l.id); });
    }
    const ids = leads.map((l) => String(l.id));
    // last offer: messages and tags (the Apps Script counted both), plus the Apps Script's own history once imported
    const [sent, outs, legacy] = await Promise.all([
      UpsellSend.aggregate([{ $match: { source, leadId: { $in: ids }, action: { $in: ['message', 'tag'] }, status: 'sent', ...(excludeCampaign ? { campaignId: { $ne: excludeCampaign } } : {}) } }, { $group: { _id: '$leadId', at: { $max: '$updatedAt' } } }]),
      UpsellOptOut.find({ source, leadId: { $in: ids } }, { leadId: 1 }).lean(),
      // (the Upselling history only, as the Apps Script's up_ log; renewal messages don't count here)
      source === 'monday' ? UpsellLegacy.aggregate([{ $match: { source, leadId: { $in: ids }, action: { $in: ['message', 'tag'] } } }, { $group: { _id: '$leadId', at: { $max: '$at' } } }]) : [],
    ]);
    const last = new Map(sent.map((x) => [x._id, +x.at])), opted = new Set(outs.map((o) => o.leadId));
    legacy.forEach((x) => { if (+x.at > (last.get(x._id) || 0)) last.set(x._id, +x.at); });
    const cidOf = (l) => String(l.contactId || '').replace(/\D/g, '');
    // an opt-out covers every lead with the same respond.io contact (a returning client can have two leads), also a
    // lead this member can't see
    const optedCids = await optedContacts(source);
    return { source, tenantsNote, rows: leads.map((l) => ({ id: String(l.id), source, name: l.name || '', email: l.email || '', phone: l.phone || '', status: l.clientStatus || l.status || '',
      type: l.inquiry === 'Buy' ? 'Buy' : l.inquiry === 'Rent' ? 'Rent' : '', city: l.city || '', building: l.building || '', va: l.va || '',
      contactId: cidOf(l), onRespond: !!cidOf(l), tenant: tenants.has(String(l.id)), leaseEnd: leaseEnd[String(l.id)] || l.leaseEnd || '', lastOffer: last.get(String(l.id)) || 0,
      optedSelf: opted.has(String(l.id)), optedOut: opted.has(String(l.id)) || (!!cidOf(l) && optedCids.has(cidOf(l))) })) };
  }
  /** The respond.io contacts of every opted-out lead of this source (all leads, not one member's). */
  async function optedContacts(source) {
    const ids = (await UpsellOptOut.find({ source }, { leadId: 1 }).lean()).map((o) => o.leadId);
    if (!ids.length) return new Set();
    const want = new Set(ids), cid = (l) => String(l.contactId || '').replace(/\D/g, '');
    const all = source === 'monday' ? (integ.monday ? (await integ.monday.loadAll(false)).leads || [] : [])
      : await Lead.find({ _id: { $in: ids.filter((x) => /^[a-f0-9]{24}$/.test(x)) } }, { contactId: 1 }).lean();
    return new Set(all.filter((l) => want.has(String(l.id || l._id))).map(cid).filter(Boolean));
  }
  /**
   * The campaign's audience now, and the exact next batches: send (new clients), tag, retry (failed only). Each batch
   * has a fingerprint over its client IDs, the message, image and tag: a confirmation must carry the one reviewed.
   * One respond.io contact is never in a batch twice, nor sent to again when another of its leads already got it.
   */
  async function audienceOf(user, c) {
    const { source, rows, tenantsNote } = await clientRows(user, c._id);
    const list = SH.upsellAudience(rows, c.audience, Date.now());
    const recs = await UpsellSend.find({ campaignId: c._id, source }).lean();
    const batch = (action, retry) => {
      const mine = new Map(recs.filter((r) => r.action === action).map((r) => [r.leadId, r]));
      const done = new Set(recs.filter((r) => r.action === action && r.contactId && r.status !== 'failed').map((r) => r.contactId));
      const seen = new Set(), out = [];
      for (const x of list) {
        if (!x.onRespond || x.optedOut || done.has(x.contactId) || seen.has(x.contactId)) continue;
        if (onlyTo.length && !onlyTo.includes(x.contactId)) continue;   // a controlled test: no record for anyone else
        const r = mine.get(x.id);
        if (retry ? !(r && r.status === 'failed') : !!r) continue;
        seen.add(x.contactId); out.push(x);
        if (out.length >= (action === 'tag' ? UP.tagBatchMax : UP.batchMax)) break;
      }
      // the fingerprint covers the recipients, the message, image, tag and channel the operator reviewed
      const hash = crypto.createHash('sha256').update(JSON.stringify([source, action, !!retry, out.map((x) => x.id), c.text, c.image ? c.image.id : '', c.tag, c.channelId || ''])).digest('hex').slice(0, 32);
      return { list: out, hash };
    };
    return { source, rows, list, recs, tenantsNote, batches: { message: batch('message', false), tag: batch('tag', false), retry: batch('message', true), retryTag: batch('tag', true) } };
  }
  const recipientOut = (x) => ({ id: x.id, name: x.name, status: x.status, type: x.type, city: x.city, email: x.email, phone: x.phone, onRespond: x.onRespond, tenant: x.tenant, leaseEnd: x.leaseEnd || '', lastOffer: x.lastOffer || null });
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
    res.json({ templates: SH.upsellTemplates(), projects, respond: !!rc.token, sends: !!sender, testOnly: onlyTo.length, channels: await channels(), mailer: { testEmail: !!mailer },
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
    if (c.sendingUntil && c.sendingUntil > new Date()) return res.status(409).json({ error: 'A batch of this offer is being sent. Wait for it to finish.' });
    // once sent, what recipients got stays the same for the rest of the offer: make a new offer to change it
    const sentMsg = await UpsellSend.exists({ campaignId: c._id, action: 'message' }), sentTag = await UpsellSend.exists({ campaignId: c._id, action: 'tag' });
    if (sentMsg && ((set.text !== undefined && set.text !== c.text) || (set.channelId !== undefined && String(set.channelId || '') !== String(c.channelId || '')))) return res.status(409).json({ error: 'This offer has already been sent: its text and channel can\'t change. Make a new offer.' });
    if (sentTag && set.tag !== undefined && set.tag !== c.tag) return res.status(409).json({ error: 'This offer has already tagged clients: its tag can\'t change. Make a new offer.' });
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

  // ----- the offer's image (JPEG / PNG up to 5 MB; kept in the portal's database) -----
  const rawBody = express.raw({ type: () => true, limit: UP.imageMax + 1024 });
  const readFile = (req, res, next) => rawBody(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Images can be 5 MB at most.' : 'The file could not be read.' }) : next()));
  r.post('/upsell/campaigns/:id/image', edit, readFile, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    if (await UpsellSend.exists({ campaignId: c._id, action: 'message' })) return res.status(409).json({ error: 'This offer has already been sent; its image can\'t change. Make a new offer.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), chk = media.checkFile(buf);
    if (chk.error) return bad(res, chk.error);
    // WhatsApp image messages take JPEG and PNG only, so WebP / GIF would fail at send time
    if (!/^image\/(jpeg|png)$/.test(chk.type)) return bad(res, 'Only JPEG or PNG images (WhatsApp accepts no other image type).');
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
    if (await UpsellSend.exists({ campaignId: c._id, action: 'message' }) || (c.sendingUntil && c.sendingUntil > new Date())) return res.status(409).json({ error: 'This offer has already been sent; its image is kept.' });
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
      // the Client Status chips, with "(blank)" for clients who have none (Index.html upRows)
      const statuses = [...new Set(a.rows.map((x) => x.status || UP.blank))].sort();
      const bOut = (k) => ({ hash: a.batches[k].hash, ids: a.batches[k].list.map((x) => x.id), names: a.batches[k].list.map((x) => x.name) });
      res.json({ source: a.source, total: a.rows.length, tenantsNote: a.tenantsNote || '', optedOut: a.rows.filter((x) => x.optedOut).length, statuses,
        batches: { message: bOut('message'), tag: bOut('tag'), retry: bOut('retry'), retryTag: bOut('retryTag') }, testOnly: onlyTo.length,
        opted: a.rows.filter((x) => x.optedOut).slice(0, 500).map((x) => ({ id: x.id, name: x.name, self: x.optedSelf })),
        counts: { audience: a.list.length, respond: a.list.filter((x) => x.onRespond).length, email: a.list.filter((x) => x.email).length, phone: a.list.filter((x) => x.phone).length },
        recipients: a.list.slice(0, 2000).map((x) => ({ ...recipientOut(x), message: (done.get('message:' + x.id) || {}).status || '', tag: (done.get('tag:' + x.id) || {}).status || '' })) });
    } catch (err) { failed(res, err); }
  });
  r.get('/upsell/campaigns/:id/preview', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    // always a real client of the audience: never a stand-in name
    if (!req.query.lead) return res.status(400).json({ error: 'Pick a client to preview the message for.' });
    let lead;
    try { const a = await audienceOf(req.user, c); lead = a.list.find((x) => x.id === String(req.query.lead)); } catch (err) { return failed(res, err); }
    if (!lead) return res.status(409).json({ error: 'The audience changed. Press Refresh and review again.' });
    res.json({ text: SH.upsellText(c.text, lead, req.user.name), to: lead.name, image: c.image ? `/api/upsell/campaigns/${c.id}/image` : '' });
  });
  r.get('/upsell/campaigns/:id/csv', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    try {
      const a = await audienceOf(req.user, c), q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&") + '"';   // no spreadsheet formulas
      // the Apps Script's columns (Index.html upCsv), so existing email-tool imports keep working
      const lines = [['email', 'first_name', 'full_name', 'phone', 'city', 'status', 'rent_or_sale', 'tenant_lease_end'].join(',')]
        .concat(a.list.filter((x) => x.email).map((x) => [x.email, x.name.split(/\s+/)[0], x.name, x.phone, x.city, x.status, x.type === 'Buy' ? 'Sale' : x.type === 'Rent' ? 'Rent' : '', x.leaseEnd || ''].map(q).join(',')));
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

  // "Mark audience opted out…" (Index.html upOpt): every client in the offer's audience now, after the operator confirms
  // the number they were shown (if the audience changed since, nothing is changed)
  r.post('/upsell/campaigns/:id/optout-all', edit, async (req, res) => {
    const b = req.body || {};
    if (b.confirm !== true || !Number.isInteger(b.count) || b.count < 1) return bad(res, 'Confirm how many clients to opt out.');
    const c = await campaignFor(req, res); if (!c) return;
    let a; try { a = await audienceOf(req.user, c); } catch (err) { return failed(res, err); }
    if (a.list.length !== b.count) return res.status(409).json({ stale: true, error: `The audience is now ${a.list.length} clients, not ${b.count}. Nothing was changed: refresh and confirm again.` });
    const ids = a.list.map((x) => x.id);
    for (let i = 0; i < ids.length; i += 500) {
      await UpsellOptOut.bulkWrite(ids.slice(i, i + 500).map((leadId) => ({ updateOne: { filter: { source: a.source, leadId }, update: { $setOnInsert: { source: a.source, leadId, by: by(req) } }, upsert: true } })));
    }
    res.json({ ok: true, count: ids.length });
  });

  // ----- email mailer (Code.gs apiBuildMailer / apiMailerTest): an email-safe HTML version of the offer -----
  r.get('/upsell/campaigns/:id/mailer', view, async (req, res) => {
    const c = await campaignFor(req, res); if (!c) return;
    const p = c.template === 'project' && SH.isId24(c.projectId) ? await Project.findById(c.projectId).lean() : null;
    res.json({ ...buildMailer(c, p, p && p.published ? `${config.web.apiOrigin}/p/${p.slug}` : (p && p.pageUrl) || ''), testEmail: !!mailer });
  });
  r.post('/upsell/mailer-test', edit, async (req, res) => {
    const b = req.body || {};
    if (typeof b.subject !== 'string' || typeof b.html !== 'string' || b.html.length > 200000 || b.subject.length > 200) return bad(res, 'Invalid request.');
    if (!mailer) return res.status(409).json({ error: 'Email is not set up on this server (SMTP_HOST, SMTP_FROM…). Download the HTML instead.' });
    if (!SH.EMAIL_RE.test(String(req.user.email || ''))) return bad(res, 'Your account has no email address to send the test to.');
    // to the member's own address only, as the Apps Script did
    try { await mailer.send({ to: req.user.email, subject: '[TEST] ' + b.subject, text: 'Test of the mailer HTML (attached; open it in a browser).', attachment: { name: 'mailer.html', type: 'text/html', data: Buffer.from(b.html.replace(/\{\{first_name\}\}/g, 'there').replace(/\{\{unsubscribe\}\}/g, '#')) } }); }
    catch (err) { if (!err.integration) throw err; return res.status(502).json({ error: err.message }); }
    res.json({ ok: true, to: req.user.email });
  });

  // ----- sending (messages or tags), confirmed by the operator; results per client -----
  r.post('/upsell/campaigns/:id/send', edit, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).some((k) => !['confirm', 'hash', 'action', 'retry'].includes(k)) || b.confirm !== true || typeof b.hash !== 'string' || !['message', 'tag'].includes(b.action) || (b.retry !== undefined && typeof b.retry !== 'boolean')) {
      return bad(res, 'Review the recipients and confirm the send.');
    }
    if (!rc.token) return res.status(409).json({ error: 'respond.io is not connected (RESPOND_TOKEN).', sendsOff: true });
    if (!sender) return res.status(409).json({ error: 'Sending is switched off on this server (RESPOND_SENDS). Nothing was sent.', sendsOff: true });
    if (onlyTo.length && req.user.role !== 'Manager') return res.status(403).json({ error: 'This server is in a controlled test (RESPOND_SEND_ONLY_TO): only a Manager can send.' });
    const c = await campaignFor(req, res); if (!c) return;
    if (b.action === 'message' && !c.text.trim()) return bad(res, 'Write the message first.');
    if (b.action === 'tag' && !c.tag) return bad(res, 'Set a respond.io tag first.');
    if (b.action === 'message' && c.image && official && !/^https:\/\//.test(config.web.apiOrigin)) return res.status(409).json({ error: 'respond.io can only fetch the image from the portal\'s public https address (PUBLIC_API_URL). Remove the image or send from the hosted portal.' });
    // one batch at a time per campaign; the lock is ours only while it carries our token (expires after 10 minutes)
    const lockToken = crypto.randomBytes(12).toString('hex');
    const lock = await UpsellCampaign.findOneAndUpdate({ _id: c._id, $or: [{ sendingUntil: null }, { sendingUntil: { $lt: new Date() } }] }, { $set: { sendingUntil: new Date(Date.now() + 10 * 60e3), sendLock: lockToken } });
    if (!lock) return res.status(409).json({ error: 'A batch for this offer is already being sent. Wait for it to finish.' });
    const results = []; let stopped = '', retryAfter = 0;
    try {
      // the batch is worked out again now; it must be exactly the one the operator reviewed
      let a; try { a = await audienceOf(req.user, c); } catch (err) { return failed(res, err); }
      const bt = a.batches[b.retry ? (b.action === 'tag' ? 'retryTag' : 'retry') : b.action];
      if (bt.hash !== b.hash) return res.status(409).json({ stale: true, error: 'The recipients or the message changed since you reviewed them (for example, someone else sent part of this offer). Nothing was sent: review the list again and confirm.' });
      const targets = bt.list;
      // opt-outs checked again right before sending, by client and by respond.io contact
      const outIds = new Set((await UpsellOptOut.find({ source: a.source, leadId: { $in: targets.map((x) => x.id) } }, { leadId: 1 }).lean()).map((o) => o.leadId));
      const outCids = await optedContacts(a.source);
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
            // the image step is saved at once: a retry after a crash never sends the image twice
            if (c.image && !steps.image) { await sender.image(x.contactId, imageUrl(c), c.channelId); steps.image = true; await UpsellSend.updateOne({ _id: rec._id }, { $set: { 'steps.image': true } }); await sleep(400); }
            await sender.text(x.contactId, SH.upsellText(c.text, x, req.user.name), c.channelId); steps.text = true;
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
        await sleep(b.action === 'tag' ? UP.tagGapMs : UP.gapMs);
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
  // respond.io fetches each recipient's image from a few shared addresses: per image (a batch is at most 40 sends) and per address
  const { createLimiter, limitRoute, byIp } = require('./rateLimit');
  r.use('/upsell-media', limitRoute([{ take: createLimiter({ max: 600, windowMs: 10 * 60e3 }), key: (req) => 'tok:' + String(req.path).slice(1, 33) },
    { take: createLimiter({ max: 3000, windowMs: 10 * 60e3 }), key: byIp }]));
  r.get('/upsell-media/:token', async (req, res) => {
    const t = String(req.params.token);
    const c = /^[A-Za-z0-9_-]{32}$/.test(t) ? await UpsellCampaign.findOne({ 'image.token': t }, { image: 1 }).lean() : null;
    if (!c || !(await media.send(res, c.image.id, { cache: 'public, max-age=86400' }))) res.status(404).type('text/plain').send('Not found');
  });
  return r;
}

module.exports = { upsellRoutes, upsellPublicRoutes };
