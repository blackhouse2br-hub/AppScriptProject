'use strict';
// respond.io client (API v2). The reader below makes only GET requests to an allowlist of paths: a contact by ID and
// that contact's message history. Sending exists only in createRespondSender (Upselling, off unless RESPOND_SENDS=on);
// contact creation and webhooks don't exist here.
const { IntegrationError, tracked } = require('./status');

// a contact, its message history, and the workspace's channel list (Upselling's channel picker, Code.gs respondChannels_)
const SAFE_PATH = /^(\/contact\/id:\d{1,20}(\/message\/list\?limit=\d{1,3}(&cursorId=\d{1,30})?)?|\/space\/channel)$/;
const MAX_PAGES = 3, PAGE = 100;

/** Same shaping as Code.gs shapeMessage_: text, attachments, email, quick replies, WhatsApp templates. */
function shapeMessage(it) {
  if (!it || !it.message) return null;
  const msg = it.message;
  const stamps = (it.status || []).map((x) => Number(x.timestamp)).filter((n) => n > 0);
  ['timestamp', 'createdAt', 'created_at', 'sentAt'].forEach((k) => {
    const v = it[k] != null ? it[k] : msg[k];
    const n = typeof v === 'number' ? v : Date.parse(v);
    if (n > 0) stamps.push(n);
  });
  const ts = stamps.length ? Math.min(...stamps.map((n) => (n < 1e12 ? n * 1000 : n))) : 0;
  let text = '', url = '', fileType = '';
  if (msg.type === 'text') text = msg.text || '';
  else if (msg.type === 'attachment' && msg.attachment) { url = msg.attachment.url || ''; fileType = msg.attachment.type || 'file'; text = '[' + fileType + ']'; }
  else if (msg.type === 'email') text = (msg.subject ? msg.subject + '\n' : '') + (msg.text || '');
  else if (msg.type === 'quick_reply') text = msg.text || msg.title || '';
  else if (msg.type === 'whatsapp_template') {
    const comps = (msg.template && msg.template.components) || [];
    const parts = ['header', 'body', 'footer'].map((t) => comps.filter((c) => String(c.type).toLowerCase() === t && c.text).map((c) => c.text).join('\n')).filter(Boolean);
    text = parts.join('\n\n') || '[WhatsApp template' + (msg.template && msg.template.name ? ': ' + msg.template.name : '') + ']';
  } else text = msg.text || '[' + (msg.type || 'message') + ']';
  const src = it.sender && it.sender.source;
  const who = it.traffic === 'incoming' ? 'Client' : src === 'ai_agent' ? 'AI agent' : src === 'workflow' ? 'Workflow' : src === 'broadcast' ? 'Broadcast' : src === 'api' ? 'Portal' : 'Agent';
  return { id: String(it.messageId || ''), from: it.traffic === 'incoming' ? 'client' : 'va', src: it.traffic === 'incoming' ? 'client' : (src || 'user'), who, text: String(text).slice(0, 4000),
    url: /^https:\/\//.test(url) ? url : '', fileType, ts, at: ts ? new Date(ts).toISOString() : '', failed: (it.status || []).some((x) => x.value === 'failed') };
}

// ---------- Upselling sends (src/upsell.js): the only respond.io writes, off unless RESPOND_SENDS=on ----------
// Exactly two POST paths, for one contact at a time: a message (text or image attachment) and a tag. The contact ID
// always comes from a lead the server has checked, never from the request. Same request shapes as the Apps Script
// (Code.gs apiUpsellSend / apiUpsellTag).
const SEND_PATH = /^\/contact\/id:\d{1,20}\/(message|tag)$/;
// unknown: respond.io may have delivered it (timeout, network error, server error) — never retried automatically
class SendError extends Error {
  constructor(message, { stop = false, retryAfter = 0, code = 0, unknown = false } = {}) { super(message); this.stop = stop; this.retryAfter = retryAfter; this.code = code; this.unknown = unknown; }
}
function createRespondSender(cfg) {
  async function post(path, body) {
    if (!SEND_PATH.test(path)) throw new SendError('Blocked: this respond.io request is not an allowed send.', { stop: true });
    let res;
    try {
      res = await fetch(cfg.apiUrl + path, { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch (e) { throw new SendError('Could not reach respond.io (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + '). It may or may not have been sent: check the chat.', { stop: true, unknown: true }); }
    if (res.ok) return true;
    let raw = '';
    try { const b = await res.json(); raw = String((b && (b.message || b.error)) || ''); } catch (e) { /* no body */ }
    raw = raw.replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 160);
    // as Code.gs sendError_, plus: a rejected token or rate limit stops the whole batch
    if (res.status === 401 || res.status === 403) throw new SendError(`respond.io rejected RESPOND_TOKEN for sending (HTTP ${res.status}). The token needs permission to send messages and tag contacts.`, { stop: true, code: res.status });
    if (res.status === 429) throw new SendError('respond.io is rate-limiting requests. Wait a moment and try again.', { stop: true, retryAfter: Number(res.headers.get('retry-after')) || 60, code: 429 });
    if (/24|window|session|template|re-?engage/i.test(raw)) throw new SendError('Can\'t send: the client hasn\'t messaged in the last 24 hours, so WhatsApp only allows an approved template. Tag them and send a template broadcast from respond.io.', { code: res.status });
    if (res.status === 404) throw new SendError('respond.io has no contact with this client\'s Respond ID.', { code: 404 });
    if (res.status >= 500) throw new SendError(`respond.io had a server error (HTTP ${res.status}). It may or may not have been sent: check the chat.`, { stop: true, unknown: true, code: res.status });
    throw new SendError(`respond.io couldn't send it (HTTP ${res.status}${raw ? ': ' + raw : ''}).`, { code: res.status });
  }
  const id = (cid) => String(cid).replace(/\D/g, '');
  // channelId (digits) picks the respond.io channel, as the Apps Script's picker did; empty = respond.io's choice ("Auto")
  const ch = (channelId) => (/^\d{1,20}$/.test(String(channelId || '')) ? { channelId: Number(channelId) } : {});
  return {
    text: (cid, text, channelId) => post(`/contact/id:${id(cid)}/message`, { ...ch(channelId), message: { type: 'text', text } }),
    image: (cid, url, channelId) => post(`/contact/id:${id(cid)}/message`, { ...ch(channelId), message: { type: 'attachment', attachment: { type: 'image', url } } }),
    tag: (cid, tag) => post(`/contact/id:${id(cid)}/tag`, [tag]),
  };
}

function createRespond(cfg, status) {
  async function get(path) {
    if (!SAFE_PATH.test(path)) throw new IntegrationError('respond', 'Blocked: this respond.io request is not on the read-only allowlist.', { status: 500 });
    let res;
    try {
      res = await fetch(cfg.apiUrl + path, { method: 'GET', headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    } catch (e) { throw new IntegrationError('respond', 'Could not reach respond.io (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ').'); }
    if (res.status === 401 || res.status === 403) throw new IntegrationError('respond', `respond.io rejected RESPOND_TOKEN (HTTP ${res.status}).`);
    if (res.status === 404) throw new IntegrationError('respond', 'respond.io has no contact with this lead\'s Respond ID.', { status: 404, countsAsFailure: false });
    if (res.status === 429) throw new IntegrationError('respond', 'respond.io is rate-limiting requests. Try again in a minute.');
    if (res.status !== 200) throw new IntegrationError('respond', `respond.io returned HTTP ${res.status}.`);
    try { return await res.json(); } catch (e) { throw new IntegrationError('respond', 'respond.io returned an unreadable response.'); }
  }

  async function contact(id) {
    const b = await get('/contact/id:' + id);
    const a = b.assignee || {};
    return { id: String(b.id || id), name: [b.firstName, b.lastName].filter(Boolean).join(' '), phone: b.phone || '', email: b.email || '',
      language: b.language || '', lifecycle: b.lifecycle || '', assignee: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email || '' };
  }
  async function messages(id) {
    const out = [];
    let cursor = null, more = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await get(`/contact/id:${id}/message/list?limit=${PAGE}` + (cursor ? '&cursorId=' + cursor : ''));
      (body.items || []).forEach((it) => { const m = shapeMessage(it); if (m) out.push(m); });
      const next = ((body.pagination && body.pagination.next) || '').match(/cursorId=(\d+)/);
      if (!next || next[1] === cursor || !(body.items || []).length) { cursor = null; break; }
      cursor = next[1];
      if (page === MAX_PAGES - 1) more = true;
    }
    return { messages: out.sort((a, b) => String(a.at).localeCompare(String(b.at))), more };
  }

  /** Contact + recent history for one contact ID. */
  async function chat(id) {
    return tracked(status, async () => {
      const [c, m] = await Promise.all([contact(id), messages(id)]);
      return { contact: c, ...m, openUrl: cfg.spaceId ? `https://app.respond.io/space/${cfg.spaceId}/inbox/${id}` : '' };
    });
  }

  // ---- reply-state checks (Code.gs apiGetReplyStates): last 15 messages per contact, cached by how active the chat is ----
  const rsCache = new Map();   // contactId → { until, st | null }
  const ttlFor = (st, now) => {
    if (!st) return 10 * 60e3;
    const idleH = (now - (st.lastAt || 0)) / 3600e3;
    return st.waiting === 'va' && idleH < 24 ? 10 * 60e3 : idleH < 24 ? 15 * 60e3 : idleH < 72 ? 30 * 60e3 : 2 * 3600e3;
  };
  /**
   * Cached state only (no network): { st } when known, { st: null, error } after a failed check (until its retry time),
   * null when never checked or due again.
   */
  const cachedState = (cid) => { const h = rsCache.get(cid); return h && h.until > Date.now() ? h : null; };
  // a failed check is remembered so each lead settles on "check failed" instead of being retried every round:
  // 2, 4, 8, 16, then every 30 minutes; the next successful read replaces it
  // a rate limit passes in a minute; a rejected token won't fix itself, so the page waits much longer before asking again
  const ERR_BACKOFF = [2, 4, 8, 16, 30].map((m) => m * 60e3), RATE_LIMIT_WAIT = 60e3, REJECTED_WAIT = 30 * 60e3;
  /**
   * Checks up to `max` contacts that aren't cached yet, `concurrency` at a time. Like the original, a call answers
   * in bounded time and reports how many are still pending, so the page can ask again for the rest.
   * retryAfterMs > 0 means respond.io asked us to slow down (or rejected the token): ask again only after that.
   */
  async function replyStates(cids, { max = 60, concurrency = 5, compute } = {}) {
    const todo = [...new Set(cids)].filter((c) => !cachedState(c));
    const batch = todo.slice(0, max), errors = {};
    let i = 0, stop = '', read = 0;
    async function worker() {
      while (!stop && i < batch.length) {
        const cid = batch[i++];
        try {
          const body = await get(`/contact/id:${cid}/message/list?limit=15`);
          const msgs = (body.items || []).map(shapeMessage).filter(Boolean);
          const now = Date.now(), st = msgs.length ? compute(msgs, now) : null;
          rsCache.set(cid, { until: now + ttlFor(st, now), st }); read++;
        } catch (err) {
          if (err.httpStatus === 404) { rsCache.set(cid, { until: Date.now() + 10 * 60e3, st: null, missing: true }); read++; continue; }
          errors[cid] = err.message;
          if (/rejected|rate-limiting/.test(err.message)) { stop = err.message; continue; }   // not this contact's fault: stop this round, don't mark it
          const prev = rsCache.get(cid), n = prev && prev.error ? (prev.attempts || 1) + 1 : 1;
          rsCache.set(cid, { until: Date.now() + ERR_BACKOFF[Math.min(n, ERR_BACKOFF.length) - 1], st: null, error: err.message, attempts: n });
        }
      }
    }
    await tracked(status, async () => {
      await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
      const errs = Object.values(errors);
      if (errs.length && errs.length === batch.length) throw new IntegrationError('respond', errs[0]);
    }).catch((err) => { if (!(err instanceof IntegrationError)) throw err; errors._ = err.message; });
    // checked = contacts actually read this round (not the ones skipped after a stop), so the page can tell when it's stuck
    return { checked: read, pending: todo.filter((c) => !cachedState(c)).length,
      errors, retryAfterMs: !stop ? 0 : /rejected/.test(stop) ? REJECTED_WAIT : RATE_LIMIT_WAIT };
  }

  /** Stores the reply state worked out from a chat someone opened, so that lead shows it (no extra request). */
  const remember = (cid, st) => { const now = Date.now(); rsCache.set(cid, { until: now + ttlFor(st, now), st }); };

  /** One page of a contact's latest messages (Code.gs apiServiceScan reads limit=50), oldest first. */
  const recent = (cid, limit = 50) => tracked(status, async () => {
    const body = await get(`/contact/id:${String(cid).replace(/\D/g, '')}/message/list?limit=${Math.min(100, Math.max(1, limit | 0))}`);
    return (body.items || []).map(shapeMessage).filter(Boolean).sort((a, b) => a.ts - b.ts);
  });
  /** The workspace's channels (Code.gs respondChannels_): [{ id, name, source }]. */
  const channels = () => tracked(status, async () => {
    const body = await get('/space/channel'), list = body.items || body.data || body;
    return (Array.isArray(list) ? list : []).map((x) => { const raw = String(x.source || x.type || x.channelType || '') + ' ' + String(x.name || '');
      return { id: String(x.id || x.channelId || ''), name: String(x.name || ''), kind: /viber/i.test(raw) ? 'viber' : /whatsapp/i.test(raw) ? 'whatsapp' : /mail/i.test(raw) ? 'email' : String(x.source || x.type || '').toLowerCase() }; })
      .filter((c) => /^\d{1,20}$/.test(c.id));
  });

  return { chat, replyStates, cachedState, remember, recent, channels };
}

module.exports = { createRespond, createRespondSender, SendError, shapeMessage, SAFE_PATH, SEND_PATH };
