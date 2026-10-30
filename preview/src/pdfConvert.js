'use strict';
// .docx → PDF for LOI signing (Code.gs loiPdf_ used Google Drive's converter: getAs('application/pdf')). Chosen by
// LOI_PDF_CONVERTER: "drive" (upload as a temporary Google Doc in the LOI folder, export, delete), "gotenberg" (a
// LibreOffice conversion service at GOTENBERG_URL), or "none" (no PDF: signers read the document text on the page).
const crypto = require('crypto');

class PdfError extends Error { constructor(message) { super(message); this.integration = 'pdf'; this.httpStatus = 502; } }
const isPdf = (b) => Buffer.isBuffer(b) && b.subarray(0, 5).toString('latin1') === '%PDF-';

/** st: config.storage; drive: the writer client (or null). → { kind, convert(docxBuffer, name) → PDF Buffer } or null. */
function createConverter(st, drive) {
  if (st.pdf === 'drive') {
    if (!drive || !st.loiFolder) return null;
    return { kind: 'drive', async convert(buf, name) {
      const tmp = await drive.upload(buf, { name: '(temporary) ' + name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parent: st.loiFolder, asGoogleDoc: true });
      try { return await drive.exportPdf(tmp.id); } finally { await drive.remove(tmp.id).catch(() => {}); }
    } };
  }
  if (st.pdf === 'gotenberg') {
    return { kind: 'gotenberg', async convert(buf, name) {
      const boundary = 'bh' + crypto.randomBytes(12).toString('hex'), fname = 'document.docx';
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fname}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      let r;
      try { r = await fetch(st.gotenbergUrl + '/forms/libreoffice/convert', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Gotenberg-Output-Filename': 'loi' }, body, signal: AbortSignal.timeout(60000) }); }
      catch (e) { throw new PdfError('The PDF converter could not be reached.'); }
      const out = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !isPdf(out)) throw new PdfError(`The PDF converter failed (HTTP ${r.status}).`);
      return out;
    } };
  }
  return null;
}

module.exports = { createConverter, PdfError, isPdf };
