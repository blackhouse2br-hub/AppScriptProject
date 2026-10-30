'use strict';
// LOI e-signature (Code.gs apiSendLoi / loiSignPage_ / apiSubmitLoiSignature / apiSendLoiOwner / loiOwnerSigned_):
// the client, then the owner, signs the LOI on a public page reached by a link. Stricter than the Apps Script:
//   - a link is 32 random bytes; only its sha256 is stored; it expires (LOI_SIGN_TTL_DAYS) and works once; sending a
//     new link for the same signer revokes the old one; failed attempts and requests are limited
//   - the page has no cookies, a strict CSP, and a per-page key (HMAC of the link) the signature must come back with
//   - the signature is a checked PNG (size, dimensions, chunks); it is embedded in the .docx with the Apps Script's
//     stamp line; a PDF is made by the configured converter; signed copies go to Google Drive (LOI folder) and to
//     the unit's deal files (client / owner LOI slots)
//   - delivery: a link to copy (always), respond.io to the client (only with RESPOND_SENDS=on), or email (SMTP_*)
// Nothing works unless LOI_SIGNING=on. Monday is never written.
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const SH = require('../public/shared');
const { Loi, LoiSignLink } = require('./models');
const { need } = require('./access');
const docx = require('./docx');
const { createConverter } = require('./pdfConvert');
const { createLimiter } = require('./rateLimit');
const { createMailer } = require('./mailer');
const { createRespondSender } = require('./integrations/respondio');
const { redact } = require('./config');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const toBuf = (b) => (!b ? null : Buffer.isBuffer(b) ? b : Buffer.from(b.buffer));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const manila = (d) => new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; frame-src 'self'";
const SIG_MAX = 300 * 1024;

/** A signature PNG from the page, checked chunk by chunk: → Buffer, or throws a user message. */
function checkSignaturePng(dataUrl) {
  // any parsing error (a short chunk, a bad header) is the same plain message for the public page
  try { return parsePng(dataUrl); } catch (e) { throw new Error('The signature could not be read. Draw it again.'); }
}
function parsePng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[1].length > SIG_MAX * 1.4) throw new Error('The signature could not be read. Draw it again.');
  const b = Buffer.from(m[1], 'base64');
  if (b.length < 60 || b.length > SIG_MAX || !b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('The signature could not be read. Draw it again.');
  let p = 8, w = 0, h = 0, idat = [], end = false;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p), type = b.subarray(p + 4, p + 8).toString('latin1');
    if (p + 12 + len > b.length) throw new Error('The signature could not be read. Draw it again.');
    const data = b.subarray(p + 8, p + 8 + len);
    if ((zlib.crc32(b.subarray(p + 4, p + 8 + len)) >>> 0) !== b.readUInt32BE(p + 8 + len)) throw new Error('The signature could not be read. Draw it again.');
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { end = true; break; }
    else if (!/^(PLTE|tRNS|pHYs|sRGB|gAMA|iCCP|cHRM|bKGD)$/.test(type)) throw new Error('The signature could not be read. Draw it again.');
    p += 12 + len;
  }
  if (!end || !w || !h || w > 1600 || h > 600 || !idat.length) throw new Error('The signature could not be read. Draw it again.');
  // must decompress, and within a bound (no compression bomb)
  try { zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (w * 4 + 1) * h + 1024 }); } catch (e) { throw new Error('The signature could not be read. Draw it again.'); }
  return { png: b, width: w, height: h };
}

function loiSignRoutes(r, config, integ, deals, leadFor, loiOut) {
  const st = config.storage || {}, rc = config.integrations.respond;
  const writer = deals && deals.writer, converter = createConverter(st, writer), mailer = st.smtp ? createMailer(st.smtp) : null;
  const sender = rc.token && rc.sends ? createRespondSender(rc) : null;
  // LOI_SIGN_SECRET (config.storage.signSecret) keeps signing pages valid across restarts; unset: a new key each start
  const secret = st.signSecret || crypto.randomBytes(32).toString('hex');
  const nonceFor = (tokenHash) => crypto.createHmac('sha256', secret).update('loi-sign:' + tokenHash).digest('base64url');
  const base = () => config.web.apiOrigin;

  function setup() {
    const needs = [];
    if (!st.signing) needs.push('LOI_SIGNING=on (signing links are switched off)');
    const drive = !!(writer && writer.ready('loi')), pdfOk = !!(converter && converter.ready());
    if (!drive) needs.push(...(writer ? writer.needs('loi') : []).map((n) => n + ' (signed copies are kept in Google Drive)'));
    if (!pdfOk) needs.push(st.pdf === 'drive' ? 'Google Drive storage (LOI_PDF_CONVERTER=drive converts through it)' : 'LOI_PDF_CONVERTER=drive or gotenberg (no PDF is made: signers read the document text on the page)');
    if (!/^https:\/\//.test(base())) needs.push('PUBLIC_API_URL on https (signing links point to it)');
    return { enabled: !!st.signing, ready: !!st.signing && drive,
      drive, pdf: pdfOk ? converter.kind : 'none', ttlDays: st.signTtlDays,
      channels: { link: true, respond: !!sender, email: !!mailer }, needs };
  }
  const loiFor = async (req, res, lead) => {
    const x = SH.isId24(req.params.loiId) ? await Loi.findOne({ _id: req.params.loiId, source: req.params.source, leadId: lead.id }) : null;
    if (!x) res.status(404).json({ error: 'LOI not found.' });
    return x;
  };
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const unitOf = (x) => x.unitName || (x.fields && (x.fields.TO_2 || x.fields.PROPERTY)) || 'the unit';
  // the Apps Script's messages (Code.gs apiSendLoi / apiSendLoiOwner), with the link
  const defaultText = (x, role, link) => (role === 'client'
    ? `Hi ${firstName(x.fields.CLIENT)}! Here is your Letter of Intent for ${unitOf(x)}. Please review it and sign it online here:\n${link}\n\nMessage us if anything needs to change. — Blackhouse`
    : `Hi ${firstName(x.fields.TO_1)}! Good news — our client has signed a Letter of Intent for ${unitOf(x)}. Please review and sign it here:\n\n${link}\n\n— Blackhouse`);

  // ----- create a signing link and deliver it (the member reviews the text first) -----
  r.post('/loi/:source/:id/:loiId/send', need('leads', 'edit'), async (req, res) => {
    const b = req.body || {}, role = b.role === 'owner' ? 'owner' : b.role === 'client' ? 'client' : '';
    if (!role) return bad(res, 'Choose who signs: the client or the owner.');
    const channel = ['link', 'respond', 'email'].includes(b.channel) ? b.channel : '';
    if (!channel) return bad(res, 'Choose how to send it.');
    if (b.confirm !== true) return bad(res, 'Confirm first.');
    if (writer) await writer.ensure();
    const s = setup();
    if (!s.enabled) return res.status(409).json({ error: 'E-signature is switched off on this server (LOI_SIGNING).', setup: true, needs: s.needs });
    if (!s.drive) return res.status(409).json({ error: 'Signed copies can\'t be kept yet: Google Drive storage is not set up.', setup: true, needs: s.needs });
    const lead = await leadFor(req, res); if (!lead) return;
    const x = await loiFor(req, res, lead); if (!x) return;
    if (role === 'client' && x.signed && x.signed.client) return res.status(409).json({ error: 'The client has already signed this LOI.' });
    if (role === 'owner' && !(x.signed && x.signed.client)) return res.status(409).json({ error: 'The client signs first; then send it to the owner.' });
    if (role === 'owner' && x.signed && x.signed.owner) return res.status(409).json({ error: 'The owner has already signed this LOI.' });
    if (x.missing && x.missing.length && b.allowMissing !== true) return res.status(409).json({ error: `This LOI still has empty fields (${x.missing.join(', ')}). Make a complete one first, or confirm sending it as it is.`, missing: x.missing });
    if (channel === 'respond' && role === 'owner') return bad(res, 'Owners are sent the link by email or by copying it (the portal doesn\'t message owners on respond.io).');
    if (channel === 'respond' && !sender) return res.status(409).json({ error: 'Sending through respond.io is switched off on this server (RESPOND_SENDS). Copy the link instead.' });
    if (channel === 'respond' && !lead.contactId) return bad(res, 'This client has no respond.io contact. Copy the link or email it.');
    if (channel === 'respond' && sender.onlyTo.length && req.user.role !== 'Manager') return res.status(403).json({ error: 'This server is in a controlled test (RESPOND_SEND_ONLY_TO): only a Manager can send on respond.io. Copy the link instead.' });
    if (channel === 'respond' && !sender.allowed(lead.contactId)) return res.status(409).json({ error: 'This server only sends to the test contacts in RESPOND_SEND_ONLY_TO. Copy the link instead.' });
    if (channel === 'email' && !mailer) return res.status(409).json({ error: 'Email is not set up on this server (SMTP_HOST, SMTP_FROM…). Copy the link instead.' });
    const to = channel === 'email' ? String(b.to || (role === 'client' ? lead.email : '')).trim().toLowerCase() : '';
    if (channel === 'email' && !SH.EMAIL_RE.test(to)) return bad(res, 'Enter the email address to send it to.');
    // the PDF this signer reads: the document as it is now (client-signed for the owner)
    const source = toBuf(role === 'owner' ? x.signedData : x.data);
    if (converter && converter.ready()) {
      try { x.pdf = await converter.convert(source, `LOI ${unitOf(x)}`); } catch (err) { if (!err.integration) throw err; return res.status(502).json({ error: err.message + ' The link was not sent.' }); }
    } else x.pdf = null;
    // a new link replaces any earlier one for this signer
    await LoiSignLink.updateMany({ loiId: x._id, role, usedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const token = crypto.randomBytes(32).toString('base64url'), link = `${base()}/sign/${token}`;
    // the reviewed text with {link} where the link goes (or the Apps Script's own text)
    const text = typeof b.text === 'string' && b.text.trim() ? b.text.trim().slice(0, 2000).split('{link}').join(link) : defaultText(x, role, link);
    if (!text.includes(link)) return bad(res, 'Keep the signing link in the message (it is added for you: {link}).');
    await LoiSignLink.create({ tokenHash: sha(token), loiId: x._id, role, signerName: String((role === 'client' ? x.fields.CLIENT : x.fields.TO_1) || '').slice(0, 120), expiresAt: new Date(Date.now() + st.signTtlDays * 864e5),
      delivery: { channel, to: channel === 'email' ? to : channel === 'respond' ? 'respond.io contact ' + lead.contactId : '', status: channel === 'link' ? 'copied' : 'sending' }, createdBy: req.user.name });
    x.status = role === 'client' ? 'sent' : 'ownerSent';
    const w = await Loi.updateOne({ _id: x._id, [`signed.${role}`]: null }, { $set: { status: x.status, pdf: x.pdf || null } });
    if (!w.modifiedCount) { await LoiSignLink.updateOne({ tokenHash: sha(token) }, { $set: { revokedAt: new Date() } }); return res.status(409).json({ error: role === 'client' ? 'The client has just signed this LOI (with the earlier link). Nothing was sent.' : 'The owner has just signed this LOI. Nothing was sent.' }); }
    let delivered = channel === 'link';
    try {
      if (channel === 'respond') { await sender.text(lead.contactId, text); delivered = true; }
      if (channel === 'email') {
        await mailer.send({ to, subject: role === 'client' ? `Letter of Intent — ${unitOf(x)}` : `Letter of Intent for signature — ${unitOf(x)}`, text,
          attachment: x.pdf ? { name: 'Letter of Intent.pdf', type: 'application/pdf', data: x.pdf } : null });
        delivered = true;
      }
    } catch (err) {
      await LoiSignLink.updateOne({ tokenHash: sha(token) }, { $set: { 'delivery.status': err.unknown ? 'unknown' : 'failed' } });
      return res.status(502).json({ error: err.message + ' You can still copy the link and send it yourself.', link, text });
    }
    await LoiSignLink.updateOne({ tokenHash: sha(token) }, { $set: { 'delivery.status': delivered ? (channel === 'link' ? 'copied' : 'sent') : 'failed' } });
    // the link is shown once, to the sender (only its hash is kept)
    res.status(201).json({ link, text, expiresAt: new Date(Date.now() + st.signTtlDays * 864e5), loi: loiOut(x.toObject()) });
  });
  // links of an LOI: who, how, when, used / expired / revoked (never the link itself)
  r.get('/loi/:source/:id/:loiId/links', need('leads', 'view'), async (req, res) => {
    const lead = await leadFor(req, res); if (!lead) return;
    const x = await loiFor(req, res, lead); if (!x) return;
    const now = Date.now();
    res.json({ links: (await LoiSignLink.find({ loiId: x._id }).sort({ createdAt: -1 }).limit(20).lean()).map((l) => ({ role: l.role, channel: l.delivery.channel, to: l.delivery.to, delivery: l.delivery.status, at: l.createdAt, by: l.createdBy,
      state: l.usedAt ? 'signed' : l.revokedAt ? 'replaced' : +l.expiresAt < now ? 'expired' : 'open', expiresAt: l.expiresAt })) });
  });

  // ----- the public signing page -----
  // per address (generous: an office or a mobile network shares one) and per link (tight: one link is one signer)
  const postLimit = createLimiter({ max: 60, windowMs: 10 * 60e3 }), getLimit = createLimiter({ max: 300, windowMs: 10 * 60e3 });
  const postTok = createLimiter({ max: 12, windowMs: 10 * 60e3 }), getTok = createLimiter({ max: 60, windowMs: 10 * 60e3 });
  const allowed = (lim, tok, req) => !lim('ip:' + req.ip) && !tok('t:' + String(req.params.token || '').slice(0, 43));
  async function linkFor(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return { error: 'This signing link is not valid.' };
    const l = await LoiSignLink.findOne({ tokenHash: sha(token) }).lean();
    if (!l) return { error: 'This signing link is not valid.' };
    if (l.usedAt) return { error: 'This LOI has already been signed with this link. Thank you!', done: true };
    if (l.revokedAt) return { error: 'This link was replaced by a newer one. Use the latest link you received.' };
    if (+l.expiresAt < Date.now()) return { error: 'This signing link has expired. Ask Blackhouse for a new one.' };
    if (l.failedAttempts >= 10) return { error: 'This link was locked after too many failed attempts. Ask Blackhouse for a new one.' };
    if (l.claimUntil && +l.claimUntil > Date.now()) return { error: 'This LOI is being signed right now. Wait a minute and reload this page.', busy: true };
    const x = await Loi.findById(l.loiId).lean();
    if (!x) return { error: 'This signing link is not valid.' };
    // this signer has already signed this LOI (whatever happened to the link): never a second signature
    if (x.signed && x.signed[l.role]) return { error: 'This LOI has already been signed. Thank you!', done: true };
    return { l, x };
  }
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f6f7f9;color:#1b1f24}main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:8px 0 4px}.doc{background:#fff;border:1px solid #d8dde3;border-radius:8px;padding:18px;white-space:pre-wrap;max-height:55vh;overflow:auto;font-size:14px}
.box{background:#fff;border:1px solid #d8dde3;border-radius:8px;padding:16px;margin-top:16px}label{display:block;margin:10px 0 4px;font-weight:600}input[type=text]{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1px solid #b8c0c8;border-radius:6px}
canvas{width:100%;max-width:600px;aspect-ratio:600/180;border:1px dashed #8a949e;border-radius:6px;background:#fff;touch-action:none;display:block}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
button{font:inherit;padding:10px 16px;border-radius:6px;border:1px solid #b8c0c8;background:#fff;cursor:pointer}button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff}.err{color:#b42318;margin-top:8px}.muted{color:#5b6570;font-size:14px}a{color:#1f6feb}</style>
</head><body><main>${body}</main></body></html>`;
  function publicRoutes() {
    const pr = express.Router();
    const headers = (res) => res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': PAGE_CSP, 'X-Frame-Options': 'SAMEORIGIN' });
    pr.get('/sign.js', (req, res) => { headers(res); res.type('text/javascript').sendFile(path.join(__dirname, '..', 'public', 'sign.js')); });
    pr.get('/sign/:token', async (req, res) => {
      headers(res);
      if (!allowed(getLimit, getTok, req)) return res.set('Retry-After', '600').status(429).type('text/html').send(page('Too many requests', '<h1>Too many requests</h1><p>Try again in a few minutes.</p>'));
      const t = await linkFor(req.params.token);
      if (t.error) return res.status(t.done || t.busy ? 200 : 404).type('text/html').send(page('Letter of Intent', `<h1>Letter of Intent</h1><p>${esc(t.error)}</p>`));
      const { l, x } = t, text = docx.docText(toBuf(l.role === 'owner' ? x.signedData : x.data)).join('\n').replace(/\n{3,}/g, '\n\n');
      res.type('text/html').send(page('Sign the Letter of Intent', `<h1>Letter of Intent</h1><p class="muted">For ${esc(unitOf(x))} · ${l.role === 'owner' ? 'signature of the owner' : 'signature of the client'} · this link works once, until ${esc(manila(l.expiresAt))} (Manila time)</p>
${x.pdf ? `<p><a href="/sign/${esc(req.params.token)}/pdf" target="_blank" rel="noopener">Open the PDF</a></p>` : ''}<div class="doc" tabindex="0" aria-label="The Letter of Intent">${esc(text)}</div>
<form class="box" id="signForm" data-nonce="${esc(nonceFor(l.tokenHash))}" data-token="${esc(req.params.token)}"><label for="nm">Full name</label><input type="text" id="nm" maxlength="120" autocomplete="name" value="${esc(l.signerName)}" required>
<label for="pad">Signature <span class="muted">(draw with your finger or mouse)</span></label><canvas id="pad" width="600" height="180" aria-label="Signature pad"></canvas>
<div class="row"><button type="button" id="clr">Clear</button></div>
<label style="font-weight:400"><input type="checkbox" id="agree"> I have read the Letter of Intent and agree to sign it electronically.</label>
<div class="row"><button type="submit" class="primary" id="go">Sign &amp; send back</button></div><div class="err" id="err" role="alert"></div></form><script src="/sign.js"></script>`));
    });
    pr.get('/sign/:token/pdf', async (req, res) => {
      headers(res);
      if (!allowed(getLimit, getTok, req)) return res.set('Retry-After', '600').status(429).type('text/plain').send('Too many requests');
      const t = await linkFor(req.params.token);
      if (t.error || !t.x.pdf) return res.status(404).type('text/plain').send('Not found');
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Letter of Intent.pdf"', 'X-Content-Type-Options': 'nosniff' }).send(toBuf(t.x.pdf));
    });
    pr.post('/sign/:token', express.json({ limit: '500kb' }), async (req, res) => {
      headers(res);
      if (!allowed(postLimit, postTok, req)) return res.set('Retry-After', '600').status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Invalid request.' });
      const t = await linkFor(req.params.token);
      if (t.error) return res.status(t.done || t.busy ? 409 : 404).json({ error: t.error });
      const { l } = t, b = req.body || {};
      const fail = async (msg) => { await LoiSignLink.updateOne({ _id: l._id }, { $inc: { failedAttempts: 1 } }); return bad(res, msg); };
      // the per-page key: the request must come from the page this link opened
      const want = Buffer.from(nonceFor(l.tokenHash)), got = Buffer.from(String(b.nonce || ''));
      // (not counted as a failed attempt: an old open page after a server restart is not an attack)
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return bad(res, 'This page is out of date. Reload it and sign again.');
      const name = String(b.name || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 120) return fail('Enter your full name.');
      if (b.agree !== true) return fail('Tick the box to agree to sign electronically.');
      let sig; try { sig = checkSignaturePng(b.signature); } catch (e) { return fail(e.message); }
      // the link works once: claimed atomically for a few minutes (two submits at once → one wins). It counts as used only
      // once the signature is saved; if the server stops halfway, the claim runs out and the signer can try again.
      const now = new Date();
      const claimed = await LoiSignLink.findOneAndUpdate({ _id: l._id, usedAt: null, revokedAt: null, expiresAt: { $gt: now }, $or: [{ claimUntil: null }, { claimUntil: { $lt: now } }] },
        { $set: { claimUntil: new Date(+now + 5 * 60e3) } });
      if (!claimed) return res.status(409).json({ error: 'This link was already used, has expired, or is being signed right now.' });
      const state = { saved: false };
      try {
        res.json(await completeSigning(l, name, sig, req, state));
      } catch (err) {
        // only when nothing was signed does the link work again
        if (!state.saved) await LoiSignLink.updateOne({ _id: l._id }, { $unset: { claimUntil: 1 } });
        console.error('[loi signing] ' + redact(String(err && err.message)));
        if (state.saved) return res.json({ ok: true, message: 'Thank you — your signature was received. Blackhouse will be in touch.' });
        if (err.alreadySigned) return res.status(409).json({ error: 'This LOI has already been signed. Thank you!' });
        if (!err.integration) throw err;
        // a plain message for the public page (details such as the service account stay in the server log)
        res.status(502).json({ error: 'Your signature could not be saved just now. Please try again in a few minutes.' });
      }
    });
    return pr;
  }

  /**
   * Signs the document and records the signature on the LOI first (the signed .docx is kept in the database, where staff
   * download it). Only then are the copies saved to Google Drive and the deal files (storeSigned), as separate steps a
   * failure can't undo: the signature is never lost, and never asked for twice.
   */
  async function completeSigning(l, name, sig, req, state = {}) {
    const x = await Loi.findById(l.loiId);
    const at = new Date(), when = manila(at);
    const stamp = l.role === 'owner' ? `Owner signed electronically: ${name} on ${when} (Manila time) via the Blackhouse signing link.`
      : `Signed electronically by ${name} on ${when} (Manila time) via the Blackhouse signing link.`;
    const signedDocx = docx.addSignature(toBuf(l.role === 'owner' ? x.signedData : x.data), { png: sig.png, role: l.role, stamp, width: sig.width, height: sig.height });
    const rec = { name, at, ipHash: sha(String(req.ip || '')).slice(0, 16), uaHash: sha(String(req.headers['user-agent'] || '')).slice(0, 16), sourceSha: sha(toBuf(l.role === 'owner' ? x.signedData : x.data)),
      docx: null, pdf: null, pdfData: null, ...(l.role === 'client' ? { signedDocx } : {}),
      // the copies still to make: Drive (and the PDF), then the unit's deal files
      store: { status: 'pending', error: '', tries: 0, at: null, lockUntil: null }, deal: { status: x.unitKey ? 'pending' : 'none', error: '' } };
    // only this signer's part is written, and only if nobody signed for this role meanwhile (one signature, ever); the other
    // signer's saved copies are left as they are
    const w = await Loi.updateOne({ _id: x._id, [`signed.${l.role}`]: null },
      { $set: { [`signed.${l.role}`]: rec, signedData: signedDocx, status: l.role === 'owner' ? 'signed' : 'clientSigned', pdf: null } });
    if (!w.modifiedCount) throw Object.assign(new Error('This LOI was already signed for this role.'), { integration: 'loi', alreadySigned: true });
    state.saved = true;   // from here the signature counts, whatever follows
    await LoiSignLink.updateOne({ _id: l._id }, { $set: { usedAt: at }, $unset: { claimUntil: 1 } });
    try { await storeSigned(x._id, l.role); } catch (err) { console.error('[loi signing] storing the signed copy: ' + redact(String(err && err.message))); }
    return { ok: true, message: 'Thank you — your signature was received. Blackhouse will be in touch.' };
  }

  /**
   * Saves a signature's copies, each step once: the PDF (kept in the database too), the .docx and the PDF in the LOI
   * folder (uploaded with a tag, so a retry finds a file that was uploaded before a failure instead of uploading it again),
   * then the unit's deal files. One run at a time per signature (a 3-minute lease); every outcome is recorded on the LOI
   * for staff, with a retry. → the step results; throws only on a database error.
   */
  async function storeSigned(loiId, role) {
    const p = `signed.${role}`, now = new Date();
    const x = await Loi.findOneAndUpdate({ _id: loiId, [p]: { $ne: null }, [`${p}.store.status`]: { $in: ['pending', 'failed', 'saved'] },
      $or: [{ [`${p}.store.lockUntil`]: null }, { [`${p}.store.lockUntil`]: { $lt: now } }] },
    { $set: { [`${p}.store.lockUntil`]: new Date(+now + 3 * 60e3) }, $inc: { [`${p}.store.tries`]: 1 } }, { returnDocument: 'after' });
    if (!x) return { busy: true };
    const s = x.signed[role], set = (o) => Loi.updateOne({ _id: loiId }, { $set: Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}.${k}`, v])) });
    const done = async (store, deal) => { await Loi.updateOne({ _id: loiId }, { $set: { [`${p}.store`]: { ...s.store, ...store, lockUntil: null, at: new Date() }, ...(deal ? { [`${p}.deal`]: deal } : {}) } }); return { store, deal }; };
    const signedDocx = toBuf(s.signedDocx || (role === 'owner' || !(x.signed && x.signed.owner) ? x.signedData : null));
    if (!signedDocx) return done({ status: 'failed', error: 'The signed document is missing.' });
    const label = role === 'owner' ? 'SIGNED by client & owner' : 'SIGNED by client';
    const baseName = `LOI – ${x.fields.CLIENT || 'client'} – ${unitOf(x)} – ${label}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 160);
    const tag = (kind) => `loi-${x._id}-${role}-${kind}`;
    let docxF = s.docx, pdfF = s.pdf, pdf = s.pdfData ? toBuf(s.pdfData) : null;
    try {
      await writer.ensure();
      if (!writer.ready('loi')) throw Object.assign(new Error('Google Drive storage is not connected (' + (writer.needs('loi').join(' ') || 'not set up') + ').'), { integration: 'drive' });
      const drive = writer.client(), folder = writer.folder('loi');
      // the PDF (for staff and the deal files), made once
      if (!pdf && converter && converter.ready()) { pdf = await converter.convert(signedDocx, baseName, tag('tmp')); await set({ pdfData: pdf }); }
      const put = async (buf, kind, mimeType) => {
        const found = await drive.findFile(tag(kind));
        const f = found || await drive.upload(buf, { name: `${baseName}.${kind}`, mimeType, parent: folder, tag: tag(kind) });
        return { fileId: f.id, url: f.webViewLink || '' };
      };
      if (!docxF) { docxF = await put(signedDocx, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); await set({ docx: docxF }); }
      if (pdf && !pdfF) { pdfF = await put(pdf, 'pdf', 'application/pdf'); await set({ pdf: pdfF }); }
    } catch (err) {
      if (!err.integration) throw err;
      return done({ status: 'failed', error: String(err.message).slice(0, 300) });
    }
    // the unit's deal files (client / owner LOI slot), as the Apps Script set loi.clientSigned / ownerSigned
    let deal = s.deal || { status: 'none', error: '' };
    if (x.unitKey && deal.status !== 'linked') {
      if (!deals || !deals.ready()) deal = { status: 'failed', error: 'The deal files storage is not set up, so the signed copy isn\'t in the unit\'s files yet.' };
      else {
        const f = pdfF || docxF;
        try {
          const lk = await deals.recordSigned({ source: x.source, leadId: x.leadId, unitKey: x.unitKey, unitName: x.unitName, slot: role === 'owner' ? 'ownerLoi' : 'clientLoi',
            file: { storage: 'drive', fileId: f.fileId, url: f.url, name: baseName + (pdfF ? '.pdf' : '.docx'), type: pdfF ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              size: (pdf || signedDocx).length, at: s.at, by: 'E-signed by ' + s.name } });
          deal = lk.conflict ? { status: 'failed', error: `The unit's "${SH.DEAL_SLOTS[role === 'owner' ? 'ownerLoi' : 'clientLoi']}" slot already holds a file someone uploaded. Remove it there if the signed copy should replace it, then try saving again.` }
            : { status: 'linked', error: '' };
        } catch (err) { deal = { status: 'failed', error: 'The signed copy couldn\'t be added to the unit\'s deal files: ' + String(err.message).slice(0, 200) }; }
      }
    }
    return done({ status: 'saved', error: '' }, deal);
  }

  // staff: save a signature's copies again after a failure (never a new signature, never a second copy in Drive)
  r.post('/loi/:source/:id/:loiId/store', need('leads', 'edit'), async (req, res) => {
    const role = (req.body || {}).role === 'owner' ? 'owner' : (req.body || {}).role === 'client' ? 'client' : '';
    if (!role) return bad(res, 'Choose whose signed copy to save.');
    const lead = await leadFor(req, res); if (!lead) return;
    const x = await loiFor(req, res, lead); if (!x) return;
    if (!(x.signed && x.signed[role])) return res.status(409).json({ error: 'That signature doesn\'t exist.' });
    const out = await storeSigned(x._id, role);
    if (out.busy) return res.status(409).json({ error: 'The signed copy is being saved right now. Wait a minute and refresh.' });
    res.json({ ...out, loi: loiOut((await Loi.findById(x._id).lean())) });
  });
  return { setup, publicRoutes };
}

module.exports = { loiSignRoutes, checkSignaturePng };
