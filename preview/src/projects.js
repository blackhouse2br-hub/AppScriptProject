'use strict';
// Project Pages (Code.gs apiPP*): developer projects with units and media, a preview, the HTML block for WordPress and
// an optional hosted page (/p/<slug>, once published). Records live in MongoDB (Project) and files in GridFS
// (projectMedia.js), so nothing needs Google Drive. Drive is optional and read-only (drive.js): "Add from Drive" and
// "Build from Google Drive" (with projectAi.js to read the documents; it only proposes values for empty fields).
// Access: module "pages" (Team & Access): view to read, edit for every change. Nothing here writes to Monday.com: the
// page's inquiry form posts to the configured form endpoint, the Apps Script public hook that files Website Inquiries.
const crypto = require('crypto');
const express = require('express');
const SH = require('../public/shared');
const { Project, ProjectSetting } = require('./models');
const { need } = require('./access');
const media = require('./projectMedia');
const { createDrive } = require('./drive');
const { createProjectAi } = require('./projectAi');
const { renderProject, pageMedia, PAGE_CSP } = require('./projectPage');

const PP = SH.PROJECT;
const bad = (res, msg) => res.status(400).json({ error: msg, errors: [msg] });
const by = (req) => ({ name: req.user.name, userId: req.user._id });
const IMPORTABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const GDOCS = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.presentation': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv' };
const BROCHURE = /brochure|price|pricelist|fact ?sheet|primer|presentation|deck|e-?brochure/i;
/** The original's caption for a new file: "Floor plan — <name>" for plans, else the name without extension, _ and -. */
const captionFor = (name, type) => { const n = String(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim(); return type === 'image' && /floor|plan|layout/i.test(name) ? 'Floor plan — ' + n : n; };
const slugBase = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'project';
async function newSlug(name) {
  const base = slugBase(name);
  for (let i = 0; i < 6; i++) { const s = i ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base; if (!(await Project.exists({ slug: s }))) return s; }
  throw new Error('Could not pick a page address.');
}
const summary = (p) => ({ id: String(p._id), slug: p.slug, name: p.name, developer: p.developer, location: p.location, status: p.status, units: (p.units || []).length,
  images: (p.media || []).filter((m) => m.type === 'image').length, files: (p.media || []).length, published: !!p.published, updatedAt: p.updatedAt });
/** Per-member limit for the Drive / AI actions (they read external services and can cost money). */
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => { const now = Date.now(), h = (hits.get(key) || []).filter((t) => t > now - windowMs); if (h.length >= max) return false; h.push(now); hits.set(key, h); return true; };
}

function projectRoutes(r, config) {
  const pc = config.projects || { drive: null, ai: null };
  const drive = pc.drive ? createDrive(pc.drive) : null, ai = pc.ai ? createProjectAi(pc.ai) : null;
  const driveLimit = limiter(30, 10 * 60e3), buildLimit = limiter(6, 10 * 60e3);
  const view = need('pages', 'view'), edit = need('pages', 'edit');
  const hookOf = async () => ((await ProjectSetting.findOne({ key: 'inquiryHook' }).lean()) || {}).value || '';

  async function projectFor(req, res) {
    const p = SH.isId24(req.params.id) ? await Project.findById(req.params.id) : null;
    if (!p) res.status(404).json({ error: 'Project not found.' });
    return p;
  }
  const failed = (res, err) => { if (!err.integration) throw err; res.status(err.httpStatus || 502).json({ error: err.message, integration: err.integration }); };
  const needDrive = (res) => { if (drive) return true; res.status(409).json({ error: 'Google Drive isn\'t connected on this server (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON). Upload the files instead.', driveOff: true }); return false; };

  r.get('/projects', view, async (req, res) => {
    const list = await Project.find({}, { name: 1, slug: 1, developer: 1, location: 1, status: 1, units: 1, 'media.type': 1, published: 1, updatedAt: 1 }).sort({ developer: 1, name: 1 }).limit(2000).lean();
    res.json({ projects: list.map(summary), drive: drive ? { email: drive.email } : null, ai: !!ai, inquiryHook: await hookOf(), publicBase: config.web.apiOrigin, limits: media.LIMITS });
  });
  // "+ Add developer project": name and developer are required, as in the original
  r.post('/projects', edit, async (req, res) => {
    const b = req.body || {}, keys = ['name', 'developer', 'location', 'status', 'turnover', 'priceFrom', 'driveLink'];
    if (Object.keys(b).some((k) => !keys.includes(k))) return bad(res, 'Invalid request.');
    const { value, errors } = SH.validateProject({ ...b, version: 1 });
    if (errors.length) return bad(res, errors[0]);
    if (!value.name || !value.developer) return bad(res, 'Project name and developer are required.');
    delete value.version;
    const p = await Project.create({ ...value, slug: await newSlug(value.name), createdBy: by(req), updatedBy: by(req) });
    res.status(201).json({ project: p });
  });
  r.get('/projects/:id', view, async (req, res) => { const p = await projectFor(req, res); if (p) res.json({ project: p }); });

  // Save: the editable fields as a whole, guarded by the version (another tab or person saving first → 409). Media
  // entries are updated one by one (caption / kind / use), so files uploaded meanwhile are never dropped.
  r.put('/projects/:id', edit, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    const mediaIds = p.media.map((m) => m.id), imageIds = p.media.filter((m) => m.type === 'image').map((m) => m.id);
    const { value, errors } = SH.validateProject(req.body, { mediaIds, imageIds });
    if (errors.length) return bad(res, errors[0]);
    const { version, media: patches, ...fields } = value;
    const set = { ...fields, updatedBy: by(req) }, arrayFilters = [];
    (patches || []).forEach((m, i) => {
      const keys = ['caption', 'kind', 'use'].filter((k) => m[k] !== undefined);
      if (!keys.length) return;
      keys.forEach((k) => { set[`media.$[m${i}].${k}`] = m[k]; });
      arrayFilters.push({ [`m${i}.id`]: m.id });
    });
    const done = await Project.findOneAndUpdate({ _id: p._id, version }, { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after', runValidators: true, ...(arrayFilters.length ? { arrayFilters } : {}) });
    if (!done) return res.status(409).json({ conflict: true, project: await Project.findById(p._id), error: 'This project was saved by someone else (or in another tab) since you opened it. Your changes were not saved: reload, then make them again.' });
    res.json({ project: done });
  });
  r.delete('/projects/:id', edit, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    await Project.deleteOne({ _id: p._id });
    for (const m of p.media) await media.remove(m.id);
    res.json({ ok: true });
  });
  r.put('/projects/:id/publish', edit, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || typeof b.published !== 'boolean') return bad(res, 'Invalid request.');
    const p = await Project.findByIdAndUpdate(SH.isId24(req.params.id) ? req.params.id : null, { $set: { published: b.published, ...(b.published ? { publishedAt: new Date() } : {}), updatedBy: by(req) } }, { returnDocument: 'after' });
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project: p });
  });

  // ----- media: direct uploads (one file per request; the page sends the file as is, its name in X-File-Name) -----
  /** Adds a checked file to the project, unless it already has PP.mediaMax files (checked in the same update). */
  async function addMedia(p, buf, { name, from = 'upload', driveId = '', who }) {
    const chk = media.checkFile(buf); if (chk.error) return { error: chk.error };
    const type = chk.type === 'application/pdf' ? 'pdf' : 'image';
    const id = await media.save(buf, { name, type: chk.type, projectId: p._id, by: who.name });
    const item = { id: String(id), name: media.cleanName(name), type, kind: SH.mediaKind(name, type), caption: captionFor(media.cleanName(name), type), use: true, from, driveId, size: buf.length, by: who.name };
    // the version moves on, so a save made from the page before this change can't point at stale files
    const ok = await Project.findOneAndUpdate({ _id: p._id, [`media.${PP.mediaMax - 1}`]: { $exists: false } }, { $push: { media: item }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!ok) { await media.remove(id); return { error: `A project can hold ${PP.mediaMax} files at most. Remove some first.` }; }
    return { item, project: ok };
  }
  const rawBody = express.raw({ type: () => true, limit: media.MAX_UPLOAD });
  const readFile = (req, res, next) => rawBody(req, res, (err) => (err ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'That file is too large (PDFs: 25 MB at most, images: 10 MB).' : 'The file could not be read.' }) : next()));
  r.post('/projects/:id/media', edit, readFile, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    let name = ''; try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { /* below */ }
    const out = await addMedia(p, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { name: name || 'file', who: by(req) });
    if (out.error) return bad(res, out.error);
    res.status(201).json({ media: out.item, project: out.project });
  });
  r.delete('/projects/:id/media/:fid', edit, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    const fid = req.params.fid;
    if (!p.media.some((m) => m.id === fid)) return res.status(404).json({ error: 'File not found.' });
    const done = await Project.findByIdAndUpdate(p._id, { $pull: { media: { id: fid } }, $set: { 'units.$[u].media': '', ...(p.cover === fid ? { cover: '' } : {}) }, $inc: { version: 1 } },
      { returnDocument: 'after', arrayFilters: [{ 'u.media': fid }] });
    await media.remove(fid);
    res.json({ project: done });
  });
  r.get('/projects/:id/media/:fid', view, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    if (!p.media.some((m) => m.id === req.params.fid) || !(await media.send(res, req.params.fid))) res.status(404).json({ error: 'File not found.' });
  });

  // ----- preview (signed in), the HTML block for WordPress, and the inquiry form endpoint -----
  r.get('/projects/:id/preview', view, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    const hook = await hookOf();
    const notice = `Preview of ${p.name}${p.published ? '' : ' (not published)'}.${hook ? '' : ' The inquiry form is off until a form endpoint is set in Project Pages.'}`;
    res.set({ 'Content-Security-Policy': PAGE_CSP, 'Content-Type': 'text/html; charset=utf-8' });
    res.send(renderProject(p.toObject(), { mediaUrl: (id) => `/api/projects/${p.id}/media/${id}`, hook, notice, preview: true }));
  });
  r.get('/projects/:id/embed', view, async (req, res) => {
    const p = await projectFor(req, res); if (!p) return;
    const hook = await hookOf(), base = `${config.web.apiOrigin}/p/${p.slug}`;
    const warnings = [!p.published && 'This project isn\'t published, so its photos and brochures won\'t load on another site until you publish it.', !hook && 'No form endpoint is set, so the page has no inquiry form.'].filter(Boolean);
    res.json({ html: renderProject(p.toObject(), { mediaUrl: (id) => `${base}/media/${id}`, hook, mode: 'embed' }), link: base, warnings });
  });
  r.get('/project-settings', view, async (req, res) => res.json({ inquiryHook: await hookOf() }));
  r.put('/project-settings', edit, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || typeof b.inquiryHook !== 'string' || !SH.validHook(b.inquiryHook.trim())) return bad(res, 'The form endpoint must be the /exec link of the Apps Script public deployment (https://script.google.com/macros/s/…/exec), or empty.');
    await ProjectSetting.findOneAndUpdate({ key: 'inquiryHook' }, { $set: { value: b.inquiryHook.trim(), by: by(req) } }, { upsert: true });
    res.json({ inquiryHook: b.inquiryHook.trim() });
  });

  // ----- Google Drive (optional, read-only) -----
  /** The files behind a Drive link (a folder: its files, 2 levels deep; a file: itself). */
  async function driveFiles(link, limit) {
    const ref = SH.parseDriveLink(link);
    if (!ref) { const e = new Error('That doesn\'t look like a Google Drive link.'); e.integration = 'drive'; e.httpStatus = 400; throw e; }
    const f = await drive.info(ref.id, ref.resourceKey);
    return f.mimeType === drive.FOLDER ? drive.walk(f.id, { resourceKey: ref.resourceKey, limit }) : [f];
  }
  const fileOut = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size) || 0, importable: IMPORTABLE.includes(f.mimeType) && f.capabilities?.canDownload !== false });
  const limited = (res, ok) => { if (ok) return false; res.status(429).json({ error: 'Too many Drive requests. Wait a few minutes and try again.' }); return true; };

  // "Add from Drive", step 1: what's in the link
  r.post('/projects/drive/files', edit, async (req, res) => {
    if (!needDrive(res) || limited(res, driveLimit(String(req.user._id)))) return;
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || typeof b.link !== 'string') return bad(res, 'Paste a Google Drive folder or file link.');
    try { res.json({ files: (await driveFiles(b.link, 120)).map(fileOut) }); } catch (err) { failed(res, err); }
  });
  /** Copies Drive files into the project's storage (images and PDFs; checked like uploads). → { added, skipped } */
  async function importFiles(p, files, who, already) {
    const added = [], skipped = [];
    for (const f of files) {
      if (already.has(f.id)) { skipped.push({ name: f.name, why: 'already added' }); continue; }
      if (!IMPORTABLE.includes(f.mimeType)) { skipped.push({ name: f.name, why: 'not an image or PDF' }); continue; }
      const max = f.mimeType === 'application/pdf' ? media.LIMITS.pdf : media.LIMITS.image;
      if (Number(f.size) > max) { skipped.push({ name: f.name, why: 'too large' }); continue; }
      let buf;
      try { buf = await drive.download(f.id, max); } catch (err) {
        if (!err.integration) throw err;
        if (err.httpStatus === 413) { skipped.push({ name: f.name, why: 'too large' }); continue; }
        if ([403, 404].includes(err.httpStatus)) { skipped.push({ name: f.name, why: 'can\'t be read (check it\'s shared with the portal)' }); continue; }
        skipped.push({ name: f.name, why: err.message }); break;   // credentials, quota or Drive down: stop, keeping what was added
      }
      const out = await addMedia(p, buf, { name: f.name, from: 'drive', driveId: f.id, who });
      if (out.error) { skipped.push({ name: f.name, why: out.error }); if (/at most/.test(out.error)) break; continue; }
      added.push(out.item); already.add(f.id); f._buf = buf;
    }
    return { added, skipped };
  }
  // "Add from Drive", step 2: the chosen files (each one is looked up again; only files shared with the portal)
  r.post('/projects/:id/drive/import', edit, async (req, res) => {
    if (!needDrive(res) || limited(res, driveLimit(String(req.user._id)))) return;
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || !Array.isArray(b.ids) || !b.ids.length || b.ids.length > 20 || b.ids.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(x))) return bad(res, 'Pick up to 20 files.');
    const p = await projectFor(req, res); if (!p) return;
    try {
      const files = []; for (const id of b.ids) files.push(await drive.info(id));
      const out = await importFiles(p, files, by(req), new Set(p.media.map((m) => m.driveId).filter(Boolean)));
      res.json({ ...out, project: await Project.findById(p._id) });
    } catch (err) { failed(res, err); }
  });

  // "Build from Google Drive": adds the folder's photos, floor plans and brochures, reads its documents, and returns a
  // proposal for review (shared.js driveProposal: empty fields only, nothing saved). The cover is set only if empty.
  r.post('/projects/:id/drive/build', edit, async (req, res) => {
    if (!needDrive(res) || limited(res, buildLimit(String(req.user._id)))) return;
    const b = req.body;
    if (!b || Object.keys(b).length !== 1 || typeof b.link !== 'string') return bad(res, 'Paste the project\'s Google Drive folder link.');
    let p = await projectFor(req, res); if (!p) return;
    try {
      const files = await driveFiles(b.link, 150);
      const mediaFiles = files.filter((f) => IMPORTABLE.includes(f.mimeType)).slice(0, 40);
      const { added, skipped } = await importFiles(p, mediaFiles, by(req), new Set(p.media.map((m) => m.driveId).filter(Boolean)));
      p = await Project.findById(p._id);
      // the Drive link and a cover are proposed like the other fields (only if empty), never saved here
      const extra = [];
      if (!p.driveLink && SH.parseDriveLink(b.link)) extra.push({ field: 'driveLink', value: b.link.trim().slice(0, 300), current: '', apply: true });
      if (!p.cover) { const c = p.media.find((m) => m.type === 'image' && !/floor|plan|layout|logo/i.test(m.name)); if (c) extra.push({ field: 'cover', value: c.id, label: c.caption || c.name, current: '', apply: true }); }
      // the documents: Google Docs / Sheets / Slides as text, PDFs as they are; brochure-like names first
      const rank = (f) => (BROCHURE.test(f.name) ? 0 : 1);
      const textFiles = files.filter((f) => GDOCS[f.mimeType] || /^text\/(plain|csv|markdown)$/.test(f.mimeType)).sort((x, y) => rank(x) - rank(y)).slice(0, 10);
      const pdfFiles = files.filter((f) => f.mimeType === 'application/pdf').sort((x, y) => rank(x) - rank(y));
      files.filter((f) => /officedocument|msword|rtf/.test(f.mimeType)).forEach((f) => skipped.push({ name: f.name, why: 'Word files aren\'t read: save it as a PDF or Google Doc' }));
      let note = '', proposal = [], docsRead = 0;
      if (!ai) note = 'Photos, floor plans and brochures were added. Filling the page fields from the documents needs ANTHROPIC_API_KEY on the server.';
      else {
        const texts = []; let total = 0;
        for (const f of textFiles) {
          if (total >= 60000) break;
          const t = (GDOCS[f.mimeType] ? await drive.exportText(f.id, GDOCS[f.mimeType]) : (await drive.download(f.id, 2 * 1024 * 1024)).toString('utf8')).trim().slice(0, 25000);
          if (t.length > 40) { texts.push({ name: f.name, text: t.slice(0, 60000 - total) }); total += t.length; }
        }
        const pdfs = []; let pdfBytes = 0;
        for (const f of pdfFiles) {
          if (pdfs.length >= 4) break;
          const size = Number(f.size) || 0; if (size > 15 * 1024 * 1024 || pdfBytes + size > 18 * 1024 * 1024) { skipped.push({ name: f.name, why: 'too large to read' }); continue; }
          const buf = mediaFiles.find((x) => x.id === f.id && x._buf)?._buf || await drive.download(f.id, 15 * 1024 * 1024);
          if (media.fileType(buf) !== 'application/pdf') continue;
          pdfs.push({ name: f.name, data: buf.toString('base64') }); pdfBytes += buf.length;
        }
        docsRead = texts.length + pdfs.length;
        if (!docsRead) note = 'No documents to read in that folder (Google Docs, Sheets, Slides or PDFs).';
        else {
          const found = await ai.extract({ project: p, texts, pdfs });
          proposal = SH.driveProposal(p.toObject(), found);
          matchUnitImages(proposal, p);
          if (!proposal.length) note = 'The documents didn\'t add anything new.';
        }
      }
      proposal = extra.concat(proposal);
      res.json({ added, skipped, docsRead, proposal, note, project: p });
    } catch (err) { failed(res, err); }
  });
}

/** Proposed units get a floor plan or photo by bedroom count ("studio", "2 BR"), as the original did; floor plans first. */
function matchUnitImages(proposal, p) {
  const u = proposal.find((x) => x.field === 'units'); if (!u) return;
  const imgs = p.media.filter((m) => m.type === 'image').sort((a, b) => (a.kind === 'floorplan' ? 0 : 1) - (b.kind === 'floorplan' ? 0 : 1));
  const key = (s) => { const t = String(s || '').toLowerCase(); if (/studio/.test(t)) return 'studio'; const m = t.match(/(\d)\s*(br|bed|bedroom)/) || t.match(/^(\d)$/); return m ? m[1] + 'br' : ''; };
  u.value.forEach((unit) => { const k = key(unit.type) || key(unit.bedrooms); if (!k) return; const m = imgs.find((x) => key(x.name + ' ' + x.caption) === k); if (m) unit.media = m.id; });
}

/** The published pages (no sign-in): /p/<slug> and its media. Unpublished or unknown → 404; files left off the page → 404. */
function projectPublicRoutes() {
  const r = express.Router();
  // anyone may open a published page: limited per address (visitors behind one network share it, so it is generous)
  const { createLimiter, limitRoute, byIp } = require('./rateLimit');
  r.use('/p', limitRoute([{ take: createLimiter({ max: 1200, windowMs: 10 * 60e3 }), key: byIp }], { html: true, message: 'Too many requests for this page. Try again in a few minutes.' }));
  const find = (slug) => (/^[a-z0-9-]{1,60}$/.test(slug) ? Project.findOne({ slug, published: true }).lean() : null);
  r.get('/p/:slug', async (req, res) => {
    const p = await find(req.params.slug);
    if (!p) return res.status(404).type('text/plain').send('Not found');
    const hook = ((await ProjectSetting.findOne({ key: 'inquiryHook' }).lean()) || {}).value || '';
    // not cached (the app's default no-store): an edit, unpublishing or a new form endpoint shows at once
    res.set({ 'Content-Security-Policy': PAGE_CSP, 'Content-Type': 'text/html; charset=utf-8' });
    res.send(renderProject(p, { mediaUrl: (id) => `/p/${p.slug}/media/${id}`, hook }));
  });
  r.get('/p/:slug/media/:fid', async (req, res) => {
    const p = await find(req.params.slug);
    // only files the page itself shows (not every file of a published project)
    if (!p || !pageMedia(p).ids.has(req.params.fid) || !(await media.send(res, req.params.fid, { cache: 'public, max-age=300' }))) return res.status(404).type('text/plain').send('Not found');
  });
  return r;
}

module.exports = { projectRoutes, projectPublicRoutes, captionFor, slugBase };
