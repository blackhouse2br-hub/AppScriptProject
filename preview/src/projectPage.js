'use strict';
// The public project page (Code.gs apiPPBuild): hero, facts, the project, units, gallery, amenities, video, map,
// downloads and the inquiry form, in that order. One builder for three uses:
//   'page'  - the hosted page (/p/<slug>) and the signed-in preview; its script is /project-page.js (CSP: no inline script)
//   'embed' - one self-contained HTML block to paste into WordPress, as the original produced (inline style + script)
// Everything from the record is escaped. The inquiry form posts to the configured form endpoint (the Apps Script public
// hook that files Website Inquiries); without one, the page says inquiries aren't open and shows no form.
const fs = require('fs');
const path = require('path');
const SH = require('../public/shared');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCRIPT = path.join(__dirname, '..', 'public', 'project-page.js');

/** CSP for the page: its own script only; the form endpoint (Apps Script) for the inquiry; YouTube and Maps embeds. */
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://script.google.com https://script.googleusercontent.com; "
  + "frame-src https://www.youtube-nocookie.com https://www.google.com; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

const CSS = `.bhp{--ink:#14161a;--mut:#5d6470;--acc:#b8893b;--bg:#fff;--soft:#f5f3ef;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.bhp *{box-sizing:border-box}.bhp img{max-width:100%;display:block}.bhp a{color:inherit}
.bhp .w{max-width:1100px;margin:0 auto;padding:0 20px}.bhp section{padding:44px 0}.bhp h2{font-size:26px;margin:0 0 16px}
.bhp .hero{min-height:440px;display:flex;align-items:flex-end;color:#fff;background:#222 center/cover no-repeat;position:relative}
.bhp .hero:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.65))}
.bhp .hero .w{position:relative;padding-bottom:40px}.bhp .hero h1{font-size:44px;line-height:1.1;margin:0 0 8px}.bhp .hero p{font-size:19px;margin:0 0 18px;max-width:640px}
.bhp .btn{display:inline-block;padding:12px 20px;border-radius:999px;background:var(--acc);color:#fff;text-decoration:none;font-weight:600;border:0;cursor:pointer;font-size:15px}
.bhp .btn.o{background:transparent;border:1px solid currentColor;color:inherit;margin-left:8px}.bhp .dl .btn.o{margin-left:0}
.bhp .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:22px 0}.bhp .facts div{background:var(--soft);border-radius:12px;padding:14px}
.bhp .facts b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.bhp .hl{columns:2;padding-left:18px}.bhp .units{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.bhp .unit{border:1px solid #e6e2da;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}.bhp .unit .b{padding:14px;flex:1;display:flex;flex-direction:column;gap:4px}
.bhp .unit .b .btn{margin-top:auto;align-self:flex-start}.bhp .gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.bhp .gal img{aspect-ratio:4/3;object-fit:cover;border-radius:10px;width:100%}.bhp .am{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}
.bhp .am li{background:var(--soft);border-radius:999px;padding:6px 12px}.bhp iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:12px}
.bhp .dl a{display:inline-block;margin:0 10px 10px 0}.bhp form{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px}
.bhp form .f{grid-column:1/-1}.bhp input,.bhp select,.bhp textarea{width:100%;padding:11px 12px;border:1px solid #d8d3ca;border-radius:10px;font:inherit}
.bhp .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.bhp .note{color:var(--mut);font-size:14px}.bhp .msg{grid-column:1/-1;font-weight:600}
.bhp .warn{background:#fff4d6;border:1px solid #e8c56b;padding:10px 14px;border-radius:10px;margin:12px 0}
@media(max-width:640px){.bhp .hero h1{font-size:32px}.bhp form{grid-template-columns:1fr}.bhp .hl{columns:1}.bhp .btn.o{margin:10px 0 0}}`;

/** Which files the page shows: the cover, up to 24 gallery images, unit images and brochures (only these are public). */
function pageMedia(p) {
  const shown = (p.media || []).filter((m) => m.use !== false);
  const images = shown.filter((m) => m.type === 'image'), byId = new Map(shown.map((m) => [m.id, m]));
  const cover = (p.cover && byId.get(p.cover)) || images.find((m) => m.kind === 'photo') || images[0];
  const gallery = images.filter((m) => m !== cover).slice(0, 24);
  const docs = shown.filter((m) => m.type === 'pdf' && m.kind === 'brochure');
  const units = (p.units || []).map((u) => (u.media && byId.get(u.media)) || null);
  const ids = new Set([cover, ...gallery, ...docs, ...units].filter(Boolean).map((m) => m.id));
  return { cover, gallery, docs, byId, ids };
}

/**
 * p: the project record; opts: { mediaUrl(id), hook, mode: 'page'|'embed', notice (shown on top, preview only), title }
 */
// preview: the signed-in preview shows the form as it will look, but not connected (a test can't file a real inquiry)
function renderProject(p, { mediaUrl, hook = '', mode = 'page', notice = '', preview = false }) {
  const { cover, gallery, docs, byId } = pageMedia(p);
  const facts = [['Status', p.status], ['Turnover', p.turnover], ['Price from', p.priceFrom], ['Location', p.location], ['Developer', p.developer]].filter(([, v]) => v);
  const vid = SH.youtubeId(p.video);
  const paras = String(p.description || '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const units = p.units || [];
  const hookOk = !!hook && SH.validHook(hook);
  const html = `<div class="bhp" data-project="${esc(p.name)}"${hookOk && !preview ? ` data-hook="${esc(hook)}"` : ''}>
${notice ? `<div class="w"><div class="warn">${esc(notice)}</div></div>` : ''}
<header class="hero"${cover ? ` style="background-image:url('${esc(mediaUrl(cover.id))}')"` : ''}><div class="w">
  <h1>${esc(p.name)}</h1>${p.tagline ? `<p>${esc(p.tagline)}</p>` : ''}
  <a class="btn" href="#bhp-inquire">Request pricing &amp; availability</a>${units.length ? '<a class="btn o" href="#bhp-units">View units</a>' : ''}</div></header>
${facts.length ? `<div class="w facts">${facts.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>` : ''}
${paras.length || (p.highlights || []).length ? `<section><div class="w"><h2>The project</h2>${paras.map((x) => `<p>${esc(x)}</p>`).join('')}
  ${(p.highlights || []).length ? `<ul class="hl">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}</div></section>` : ''}
${units.length ? `<section id="bhp-units"><div class="w"><h2>Units available</h2><div class="units">${units.map((u) => { const m = u.media && byId.get(u.media);
    return `<div class="unit">${m && m.use !== false ? `<img src="${esc(mediaUrl(m.id))}" alt="${esc(m.caption || u.type)}" loading="lazy">` : ''}<div class="b"><b>${esc(u.type || 'Unit')}</b>
      <span class="note">${esc([u.bedrooms && (/^\d+$/.test(u.bedrooms) ? u.bedrooms + ' BR' : u.bedrooms), u.sizeSqm && u.sizeSqm + ' sqm', u.availability].filter(Boolean).join(' · '))}</span>
      ${u.priceFrom ? `<span>From ${esc(u.priceFrom)}</span>` : ''}${u.notes ? `<span class="note">${esc(u.notes)}</span>` : ''}
      <a class="btn" href="#bhp-inquire" data-unit="${esc(u.type)}">Inquire about this unit</a></div></div>`; }).join('')}</div></div></section>` : ''}
${gallery.length ? `<section><div class="w"><h2>Gallery</h2><div class="gal">${gallery.map((m) => `<a href="${esc(mediaUrl(m.id))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(m.id))}" alt="${esc(m.caption || m.name)}" loading="lazy"></a>`).join('')}</div></div></section>` : ''}
${(p.amenities || []).length ? `<section><div class="w"><h2>Amenities</h2><ul class="am">${p.amenities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></section>` : ''}
${vid ? `<section><div class="w"><h2>Video</h2><iframe src="https://www.youtube-nocookie.com/embed/${esc(vid)}" title="${esc(p.name)} video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></section>` : ''}
${p.map ? `<section><div class="w"><h2>Location</h2><iframe src="https://www.google.com/maps?q=${encodeURIComponent(p.map)}&amp;output=embed" title="Map of ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"></iframe></div></section>` : ''}
${docs.length ? `<section><div class="w dl"><h2>Downloads</h2>${docs.map((d) => `<a class="btn o" href="${esc(mediaUrl(d.id))}" target="_blank" rel="noopener">${esc(d.caption || d.name)}</a>`).join('')}</div></section>` : ''}
<section id="bhp-inquire"><div class="w"><h2>Inquire about ${esc(p.name)}</h2>
${hookOk ? `<form novalidate>
  <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <label>Name*<input name="name" required maxlength="80" autocomplete="name"></label>
  <label>Email<input name="email" type="email" maxlength="120" autocomplete="email"></label>
  <label>Preferred contact<select name="method">${['WhatsApp', 'Viber', 'WeChat', 'KakaoTalk', 'Line', 'Facebook', 'Call PH'].map((m) => `<option>${m}</option>`).join('')}</select></label>
  <label>Phone<input name="phone" maxlength="40" autocomplete="tel"></label>
  <label class="f">Unit type<select name="unit"><option value="">Unit type (any)</option>${units.filter((u) => u.type).map((u) => `<option>${esc(u.type)}</option>`).join('')}</select></label>
  <label class="f">Message<textarea name="message" rows="4" maxlength="1000"></textarea></label>
  <p class="note f">Leave your email or phone number so we can reply.</p>
  <div class="f"><button class="btn" type="submit"${preview ? ' disabled' : ''}>Send inquiry</button></div><p class="msg" role="status" aria-live="polite">${preview ? 'Preview: this form isn\'t sent from here. It works on the published page.' : ''}</p>
</form>` : '<p class="note">Online inquiries for this project aren\'t open yet. Please contact Blackhouse directly.</p>'}
</div></section></div>`;
  if (mode === 'embed') return `<style>${CSS}</style>\n${html}\n<script>${fs.readFileSync(SCRIPT, 'utf8')}</script>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(p.name)}${p.developer ? ' · ' + esc(p.developer) : ''}</title>
<meta name="robots" content="${notice ? 'noindex, nofollow' : 'index, follow'}"><link rel="icon" href="data:,"><style>body{margin:0}${CSS}</style></head><body>${html}<script src="/project-page.js"></script></body></html>`;
}

module.exports = { renderProject, pageMedia, PAGE_CSP, esc };
