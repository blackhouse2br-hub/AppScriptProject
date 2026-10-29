'use strict';
// Project Pages media: photos, floor plans and brochures kept in MongoDB itself (GridFS, bucket "projectMedia"), so
// they survive Railway restarts and deployments with no extra storage service. Files are checked by their first bytes,
// never by the name or the type the browser claims: JPEG, PNG, WebP and GIF images and PDF documents only (no SVG,
// HTML or anything a browser could run).
const mongoose = require('mongoose');
const { imageType } = require('./integrations/monday');

const BUCKET = 'projectMedia';
const LIMITS = { image: 10 * 1024 * 1024, pdf: 25 * 1024 * 1024 };
const MAX_UPLOAD = LIMITS.pdf;

/** The real type of a file from its first bytes: an image type, 'application/pdf', or '' (refused). */
function fileType(buf) {
  const img = imageType(buf);
  if (img) return img;
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return '';
}
/** Checks an upload: → { type } or { error } (a message for the person uploading). */
function checkFile(buf) {
  if (!buf || !buf.length) return { error: 'The file is empty.' };
  const type = fileType(buf);
  if (!type) return { error: 'Only JPEG, PNG, WebP or GIF images and PDF files can be uploaded.' };
  const max = type === 'application/pdf' ? LIMITS.pdf : LIMITS.image;
  if (buf.length > max) return { error: `That file is too large (${type === 'application/pdf' ? 'PDFs' : 'images'}: ${Math.round(max / 1048576)} MB at most).` };
  return { type };
}
/** A file name safe to keep and show: no path, no control characters, at most 120 characters. */
const cleanName = (s) => String(s || '').replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f<>"]/g, '').trim().slice(0, 120) || 'file';

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
const toId = (id) => (mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null);

/** Stores a checked file; returns its id. */
function save(buf, { name, type, projectId, by }) {
  return new Promise((resolve, reject) => {
    const up = bucket().openUploadStream(cleanName(name), { metadata: { projectId: String(projectId), type, by: by || '' } });
    up.once('error', reject);
    up.once('finish', () => resolve(up.id));
    up.end(buf);
  });
}
/** The stored file's record (length, metadata), or null. */
async function info(id) {
  const oid = toId(id); if (!oid) return null;
  return (await bucket().find({ _id: oid }).limit(1).toArray())[0] || null;
}
/** Sends a stored file with safe headers: its checked type, inline, no sniffing, and a sandbox for PDFs. */
async function send(res, id, { cache = 'private, max-age=300' } = {}) {
  const f = await info(id);
  if (!f || !f.metadata || !f.metadata.type) return false;
  // images inline; PDFs as a download (browsers' PDF viewers don't run under the sandbox, and a download needs no viewer)
  const pdf = f.metadata.type === 'application/pdf';
  res.set({ 'Content-Type': f.metadata.type, 'Content-Length': String(f.length), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${pdf ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.filename)}"`, 'Content-Security-Policy': "default-src 'none'; sandbox" });
  await new Promise((resolve, reject) => { bucket().openDownloadStream(f._id).once('error', reject).once('end', resolve).pipe(res); });
  return true;
}
/** Reads a stored file into memory (for the page builder's checks; files are at most 25 MB). */
async function read(id) {
  const oid = toId(id); if (!oid) return null;
  const parts = [];
  for await (const c of bucket().openDownloadStream(oid)) parts.push(c);
  return Buffer.concat(parts);
}
async function remove(id) { const oid = toId(id); if (oid) await bucket().delete(oid).catch((e) => { if (!/FileNotFound|not found/i.test(e.message)) throw e; }); }

module.exports = { fileType, checkFile, cleanName, save, info, send, read, remove, LIMITS, MAX_UPLOAD, BUCKET };
