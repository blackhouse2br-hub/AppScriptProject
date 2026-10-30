'use strict';
// "Build from Google Drive": reads a project's own documents (Google Docs / Sheets / Slides text and PDFs) with Claude
// and returns the facts they state, as JSON. Nothing found is saved here: src/projects.js turns it into a proposal
// (empty fields only, shared.js driveProposal) that staff review before saving. Optional: needs ANTHROPIC_API_KEY.
const AnthropicSdk = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSdk.default || AnthropicSdk;

const MODEL = 'claude-opus-5-5';
const str = { type: 'string' };
// every key required, '' / [] when the documents don't say (structured outputs: additionalProperties false)
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['developer', 'tagline', 'description', 'status', 'turnover', 'priceFrom', 'location', 'map', 'highlights', 'amenities', 'units'],
  properties: {
    developer: str, tagline: str, description: str, status: str, turnover: str, priceFrom: str, location: str, map: str,
    highlights: { type: 'array', items: str }, amenities: { type: 'array', items: str },
    units: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'bedrooms', 'sizeSqm', 'priceFrom', 'notes'],
      properties: { type: str, bedrooms: str, sizeSqm: str, priceFrom: str, notes: str } } },
  },
};
const INSTRUCTIONS = `You fill in a real-estate developer project page from the project's own documents (brochures, price lists, fact sheets).
Use only facts the documents state. If a field isn't stated, return an empty string (or an empty list); never guess or use outside knowledge.
- tagline: one short line from the documents' own wording, or "".
- description: 2–4 plain paragraphs separated by blank lines, factual, no prices.
- status: as written (e.g. Pre-selling, RFO, Under construction).
- turnover: the turnover / completion date as written.
- priceFrom: the lowest starting price as written, with currency.
- location: city / district. map: an address or place name someone could search on a map.
- highlights: up to 8 short selling points. amenities: the listed amenities, one per item.
- units: one entry per unit type (e.g. Studio, 1BR), with bedrooms, size in sqm, starting price and short notes, as stated.`;

class AiError extends Error { constructor(message, status) { super(message); this.integration = 'ai'; this.httpStatus = status || 502; } }

/** cfg: { apiKey, baseURL } */
function createProjectAi(cfg) {
  // one retry only: each attempt re-sends (and bills) up to 18 MB of PDFs
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 1, timeout: 300e3 });
  /** project: { name, developer, location }; texts: [{ name, text }]; pdfs: [{ name, data (base64) }] → the found facts. */
  async function extract({ project, texts, pdfs }) {
    const content = [];
    pdfs.forEach((d) => content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data }, title: d.name }));
    texts.forEach((t) => content.push({ type: 'text', text: `<document name="${t.name.replace(/"/g, "'")}">\n${t.text}\n</document>` }));
    content.push({ type: 'text', text: `Project: ${project.name}${project.developer ? ' by ' + project.developer : ''}${project.location ? ', ' + project.location : ''}.\nFill in the page fields from the documents above.` });
    let res;
    try {
      res = await client.beta.messages.create({
        model: MODEL, max_tokens: 16000,
        // a declined request is re-run once on the fallback model (refusal fallback, opt-in)
        betas: ['server-side-fallback-2026-06-01'], fallbacks: [{ model: 'claude-opus-4-8' }],
        system: INSTRUCTIONS,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AiError('The AI service refused the server\'s ANTHROPIC_API_KEY. Check the key.');
      if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('The server\'s ANTHROPIC_API_KEY isn\'t allowed to use this model. Check the key\'s workspace in the Anthropic Console.');
      if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)) throw new AiError('The AI service is busy right now. Try again in a minute.', 429);
      if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(String(err.message))) throw new AiError('The Anthropic account has no credit left. Add credit in the Anthropic Console (Plans & Billing).');
      if (err instanceof Anthropic.BadRequestError) throw new AiError('The AI service could not read these documents (they may be too large, protected or damaged).');
      if (err instanceof Anthropic.APIConnectionError) throw new AiError('The AI service could not be reached. Try again in a minute.');
      if (err instanceof Anthropic.APIError) throw new AiError('The AI service returned an error (HTTP ' + err.status + ').');
      throw err;
    }
    if (res.stop_reason === 'refusal') throw new AiError('The AI service declined to read these documents.');
    if (res.stop_reason === 'max_tokens') throw new AiError('The documents produced too much text to read in one go. Try a folder with fewer documents.');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try { return JSON.parse(text); } catch (e) { throw new AiError('The AI service returned something that isn\'t valid project data.'); }
  }
  return { extract, model: MODEL };
}

module.exports = { createProjectAi, AiError, SCHEMA, MODEL };
