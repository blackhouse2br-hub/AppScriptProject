'use strict';
// Service Requests (Code.gs apiServiceScan): reads a client's replies to a services offer and, for each offered
// service, says whether they're interested, with a short summary and the details a supplier needs. The result is a
// proposal staff see on the board; it never contacts anyone. Optional: needs ANTHROPIC_API_KEY.
const AnthropicSdk = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSdk.default || AnthropicSdk;
const SH = require('../public/shared');
const { AiError } = require('./projectAi');

const MODEL = 'claude-haiku-5-5';   // a short classification (the Apps Script used its small model, claude-haiku-4-5)
const str = { type: 'string' };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['services'],
  properties: { services: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['service', 'interest', 'summary', 'details'],
    properties: {
      service: { type: 'string', enum: SH.SERVICES.keys }, interest: { type: 'string', enum: SH.SERVICES.interests }, summary: str,
      details: { type: 'object', additionalProperties: false, required: SH.SERVICES.detailKeys, properties: Object.fromEntries(SH.SERVICES.detailKeys.map((k) => [k, str])) },
    } } } },
};
// the Apps Script's instructions, as written there (the client's identity must never reach a supplier)
const system = (offered) => 'A Philippine property brokerage offered add-on services (' + offered.join(', ') + ') to a client. Read the chat and, for each offered service, decide the client\'s interest '
  + '("interested", "asking", "not interested" or "no reply"), with a summary of at most 20 words and the details (date, area, from, to, unit, items, issue, budget, notes). '
  + 'NEVER include the client\'s name, phone number, email, unit number or any personal identifier in summary or details — these go to an outside supplier. Leave unknown fields empty.';

/** cfg: { apiKey, baseURL } */
function createServiceAi(cfg) {
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 2, timeout: 60e3 });
  /** offered: service keys; convo: "CLIENT: …\nBLACKHOUSE: …" → { svc: { interest, summary, details } } for offered services only. */
  async function classify({ offered, convo }) {
    let res;
    try {
      // Haiku 5.5 thinks by default and thinking counts toward max_tokens: a short classification needs little of it
      // (effort low), with room left for the JSON. No temperature: Haiku 5.5 rejects non-default sampling values.
      res = await client.messages.create({
        model: MODEL, max_tokens: 4000, system: system(offered),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: convo }],
      });
    } catch (err) {
      // fatal: the same answer for every chat (key, model access, credit), so a scan stops at the first one
      const fatal = (m) => Object.assign(new AiError(m), { fatal: true });
      if (err instanceof Anthropic.AuthenticationError) throw fatal('The AI service refused the server\'s ANTHROPIC_API_KEY. Check the key.');
      if (err instanceof Anthropic.PermissionDeniedError) throw fatal('The server\'s ANTHROPIC_API_KEY isn\'t allowed to use this model. Check the key\'s workspace in the Anthropic Console.');
      if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)) throw new AiError('The AI service is busy right now. Try again in a minute.', 429);
      if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(String(err.message))) throw fatal('The Anthropic account has no credit left. Add credit in the Anthropic Console (Plans & Billing).');
      if (err instanceof Anthropic.APIConnectionError) throw fatal('The AI service could not be reached. Try again in a minute.');
      if (err instanceof Anthropic.APIError) throw new AiError('The AI service returned an error (HTTP ' + err.status + ').');
      throw err;
    }
    if (res.stop_reason === 'refusal') throw new AiError('The AI service declined to read this chat.');
    if (res.stop_reason === 'max_tokens') throw new AiError('The AI answer was cut off. Try again; if it keeps happening the chat is too long to read in one go.');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let o; try { o = JSON.parse(text); } catch (e) { throw new AiError('The AI service returned something that isn\'t valid.'); }
    const out = {};
    (o.services || []).forEach((x) => {
      if (!offered.includes(x.service) || !SH.SERVICES.interests.includes(x.interest)) return;
      // a second guard on what reaches a supplier: no numbers, emails or links, whatever the model wrote
      out[x.service] = { interest: x.interest, summary: SH.stripContacts(x.summary).slice(0, 200),
        details: Object.fromEntries(SH.SERVICES.detailKeys.map((k) => [k, SH.stripContacts((x.details || {})[k]).slice(0, 200)])) };
    });
    return out;
  }
  return { classify, model: MODEL };
}

module.exports = { createServiceAi, MODEL, SCHEMA };
