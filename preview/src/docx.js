'use strict';
// LOI documents from the team's own Word templates (Code.gs fillLoiDoc_), without Google Docs: a .docx is a ZIP of XML
// parts; only word/document.xml is changed. Built-in zlib only (no new dependency). Nothing here sends or stores anything.
const zlib = require('zlib');

const MAX_ENTRIES = 2000, MAX_UNZIPPED = 30 * 1024 * 1024;

/** The parts of a ZIP file: [{ name, data }] (stored or deflated entries only). Throws on anything else. */
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Not a .docx file.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a .docx file.');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || cdOff >= buf.length) throw new Error('Not a .docx file.');
  const out = [], seen = new Set(); let p = cdOff, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The .docx file is damaged.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    // each entry once, inside the file and before the central directory (no entries sharing data: a zip bomb)
    if (seen.has(lho) || lho + 30 > cdOff || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('The .docx file is damaged.');
    seen.add(lho);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > cdOff) throw new Error('The .docx file is damaged.');
    const raw = buf.subarray(start, start + csize);
    // limits on what is really unpacked, not on the sizes the file declares
    if (usize > MAX_UNZIPPED - total) throw new Error('The .docx file is too large.');
    let data;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, MAX_UNZIPPED - total) });
      else throw new Error('unsupported');
    } catch (e) { throw new Error(e.message === 'unsupported' ? 'The .docx file uses an unsupported compression.' : 'The .docx file is damaged or too large.'); }
    if (data.length !== usize) throw new Error('The .docx file is damaged.');
    total += data.length;
    out.push({ name, data });
  }
  return out;
}

/** A ZIP file from [{ name, data }] (deflated). */
function zip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), comp = zlib.deflateRawSync(e.data), crc = zlib.crc32(e.data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const T_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g;
// a paragraph: empty and self-closing (<w:p .../>), or with content (never one that runs into the next)
const P_SRC = '<w:p(?:\\s[^>]*?)?\\/>|<w:p(?:\\s[^>]*[^/>])?>[\\s\\S]*?<\\/w:p>';
const P_RE = () => new RegExp(P_SRC, 'g');
/** A paragraph's (or cell's) visible text. */
const textOf = (xml) => { let s = ''; xml.replace(T_RE, (m, t) => { s += t ? xmlUnesc(t) : ''; return m; }); return s; };
/** The paragraph with its text replaced: all of it goes in the first text run (keeping that run's formatting). */
function setParaText(p, text) {
  let first = true;
  const out = p.replace(T_RE, () => { if (!first) return '<w:t/>'; first = false; return `<w:t xml:space="preserve">${xmlEsc(text)}</w:t>`; });
  return first ? p : out;   // a paragraph with no text run is left as it is
}

const KNOWN = ['DATE', 'TO_1', 'TO_2', 'TO_3', 'DEAR', 'OWNER', 'CLIENT', 'CLIENT_SIGN', 'PROPERTY', 'LEASE_TERM', 'MONTHLY_RENT', 'ADVANCE', 'DEPOSIT', 'PRICE', 'TERMS', 'CONCESSIONS', 'COMM_PCT', 'COMM_WORDS'];
// Annex table: label in the first cell → field (Code.gs fillLoiDoc_ MAP)
const MAP = { lessor: 'OWNER', seller: 'OWNER', lessee: 'CLIENT', buyer: 'CLIENT', property: 'PROPERTY', 'lease term': 'LEASE_TERM', 'monthly rental': 'MONTHLY_RENT', 'monthly rent': 'MONTHLY_RENT',
  'advance rental': 'ADVANCE', 'security deposit': 'DEPOSIT', 'total purchase price': 'PRICE', 'purchase price': 'PRICE', 'terms of payment': 'TERMS', 'other concessions': 'CONCESSIONS' };

/**
 * Fills an LOI template's document.xml with the fields (Code.gs fillLoiDoc_): {{KEY}} placeholders, the Date / To
 * (three lines) / Dear blanks, the Annex A table by its labels, the commission percentage, and the printed names under
 * the signature lines. An empty field leaves the template's blank line, so missing values stay visibly blank.
 */
function fillLoiXml(xml, fields) {
  const val = (k) => String(fields[k] == null ? '' : fields[k]).trim();
  const BLANK = '_______________';
  // {{KEY}} placeholders (templates made for the portal) — per paragraph, as Word can split a placeholder over runs
  xml = xml.replace(P_RE(), (p) => {
    const t = textOf(p); if (!/\{\{[A-Z_0-9]+\}\}/.test(t)) return p;
    // only the known fields (Code.gs fillLoiDoc_ list); any other {{…}} stays as written
    return setParaText(p, t.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => (!KNOWN.includes(k) ? m : val(k) || (['CONCESSIONS', 'TERMS', 'CLIENT_SIGN'].includes(k) ? (k === 'CLIENT_SIGN' ? '' : '—') : BLANK))));
  });
  // tables first (a cell's paragraphs are handled with their label), then the body's own paragraphs
  xml = xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (row) => {
    const cells = row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g); if (!cells || cells.length < 2) return row;
    const label = textOf(cells[0]).trim().toLowerCase().replace(/[:\s]+$/, ''), cur = textOf(cells[1]).trim();
    let cell = cells[1];
    if (/broker'?s commission/.test(label)) {
      if (!val('COMM_PCT')) return row;
      cell = cell.replace(P_RE(), (p) => { const t = textOf(p);
        if (!/_{3,}%|\(_{3,} percent\)/.test(t)) return p;
        return setParaText(p, t.replace(/_{3,}%/, () => val('COMM_PCT') + '%').replace(/\(_{3,} percent\)/, () => '(' + (val('COMM_WORDS') || '').toLowerCase() + ' percent)')); });
      return row.replace(cells[1], () => cell);
    }
    const k = MAP[label]; if (!k) return row;
    const v = val(k);
    const write = (text) => { let first = true; return cell.replace(P_RE(), (p) => { if (first && /<w:t[ >/]/.test(p)) { first = false; return setParaText(p, text); } return first ? p : setParaText(p, ''); }); };
    if (k === 'TERMS') { if (v) cell = write(v); }
    else if (k === 'CONCESSIONS') { if (v || !cur || /etc\.?$/i.test(cur)) cell = /<w:t[ >/]/.test(cell) ? write(v || '—') : cell; }
    else if (v && (!cur || /^_+$/.test(cur))) {
      // an empty value cell has no text run: add one to its first paragraph
      const run = `<w:r><w:t xml:space="preserve">${xmlEsc(v)}</w:t></w:r>`;
      cell = /<w:t[ >/]/.test(cell) ? write(v) : cell.replace(new RegExp(P_SRC), (p) => (/\/>$/.test(p) ? p.replace(/\s*\/>$/, `>${run}</w:p>`) : p.replace(/<\/w:p>$/, run + '</w:p>')));
    }
    return row.replace(cells[1], () => cell);
  });
  // header lines: Date / To (three lines) / Dear; signature captions
  let toLeft = 0; const toK = ['TO_1', 'TO_2', 'TO_3'];
  xml = xml.replace(P_RE(), (p) => {
    const t = textOf(p);
    // replacements are functions, so "$&", "$1"… in a value are kept as typed (Code.gs escapes "$" too)
    if (toLeft && /^\s*_{5,}\s*$/.test(t)) { const k = toK[3 - toLeft]; toLeft--; return val(k) ? setParaText(p, t.replace(/_{5,}/, () => val(k))) : p; }
    toLeft = 0;
    if (/Date:\s*_{5,}/.test(t) && val('DATE')) return setParaText(p, t.replace(/Date:\s*_{5,}/, () => 'Date: ' + val('DATE')));
    if (/^\s*To:\s*_{5,}/.test(t)) { toLeft = 2; return val('TO_1') ? setParaText(p, t.replace(/To:(\s*)_{5,}/, (m, sp) => 'To:' + sp + val('TO_1'))) : p; }
    if (/^\s*Dear\s+_{5,}/.test(t) && val('DEAR')) return setParaText(p, t.replace(/_{5,}/, () => val('DEAR')));
    if (/^\s*(LESSOR|SELLER)\s*$/.test(t) && val('OWNER_SIGN')) return setParaText(p, val('OWNER_SIGN') + ' — ' + t.trim());
    if (/^\s*BLACKHOUSE INC\. — Broker\s*$/.test(t) && val('BROKER_SIGN')) return setParaText(p, val('BROKER_SIGN') + ' — ' + t.trim());
    if (/^\s*Print Name & Signature\s*$/.test(t) && val('CLIENT_SIGN')) return setParaText(p, val('CLIENT_SIGN') + ' — ' + t.trim());
    return p;
  });
  return xml;
}

/** Checks an uploaded LOI template: a .docx with a document body. → { kind: 'lease' | 'sale' | '' } or throws. */
function checkTemplate(buf) {
  const parts = unzip(buf), doc = parts.find((e) => e.name === 'word/document.xml');
  if (!doc || !parts.some((e) => e.name === '[Content_Types].xml')) throw new Error('This isn\'t a Word .docx document (a .doc file must be saved as .docx first).');
  const t = textOf(doc.data.toString('utf8'));
  if (!/letter of intent/i.test(t)) throw new Error('This doesn\'t look like an LOI template (no “Letter of Intent” in it).');
  return { kind: /intent to lease/i.test(t) ? 'lease' : /intent to purchase/i.test(t) ? 'sale' : '' };
}

/** The filled LOI as a new .docx (the template itself is unchanged). */
function fillLoi(buf, fields) {
  const parts = unzip(buf);
  return zip(parts.map((e) => (e.name === 'word/document.xml' ? { name: e.name, data: Buffer.from(fillLoiXml(e.data.toString('utf8'), fields), 'utf8') } : e)));
}
/**
 * Puts a signature image into a filled LOI (Code.gs apiSubmitLoiSignature / loiOwnerSigned_): on the signature line
 * just above "Print Name & Signature" (client) or above LESSOR / SELLER (owner) — or at the end if the template has
 * neither — then adds the stamp line (9 pt italic) at the end. png: the signature PNG (checked by the caller).
 */
function addSignature(buf, { png, role, stamp, width = 600, height = 180 }) {
  const parts = unzip(buf), doc = parts.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('The .docx file is damaged.');
  const relsPart = parts.find((e) => e.name === 'word/_rels/document.xml.rels'), types = parts.find((e) => e.name === '[Content_Types].xml');
  let rels = relsPart ? relsPart.data.toString('utf8') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  // a relationship id and media name not used yet (the owner signs a copy the client already signed)
  let n = 1; while (rels.includes(`Id="rIdBhSig${n}"`) || parts.some((e) => e.name === `word/media/bhsig${n}.png`)) n++;
  const rid = `rIdBhSig${n}`, media = `bhsig${n}.png`;
  rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${media}"/></Relationships>`);
  let ct = types ? types.data.toString('utf8') : '';
  if (ct && !/Extension="png"/i.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  // 200 px wide (as the Apps Script), in EMU; height keeps the canvas ratio
  const cx = 1905000, cy = Math.round(cx * height / width);
  const pic = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${9000 + n}" name="Signature ${n}"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="0" name="${media}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  let xml = doc.data.toString('utf8');
  // the root must declare the drawing (wp) and relationship (r) prefixes
  xml = xml.replace(/<w:document\b([^>]*)>/, (m, attrs) => '<w:document' + attrs
    + (/xmlns:wp=/.test(attrs) ? '' : ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')
    + (/xmlns:r=/.test(attrs) ? '' : ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"') + '>');
  const anchor = role === 'owner' ? /(LESSOR|SELLER)\s*$/ : /Print Name & Signature\s*$/;
  const paras = [...xml.matchAll(P_RE())];
  const at = paras.findIndex((m) => anchor.test(textOf(m[0])));
  if (at >= 0) {
    // the line above the caption (an underline "____" or empty paragraph) becomes the signature; else it goes above it
    const prev = at > 0 ? paras[at - 1] : null, target = prev && /^[\s_]*$/.test(textOf(prev[0])) ? prev : null;
    if (target) xml = xml.slice(0, target.index) + pic + xml.slice(target.index + target[0].length);
    else xml = xml.slice(0, paras[at].index) + pic + xml.slice(paras[at].index);
  }
  const stampP = `<w:p><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${xmlEsc(stamp)}</w:t></w:r></w:p>`;
  const tail = (at >= 0 ? '' : pic) + stampP, sect = xml.lastIndexOf('<w:sectPr');
  xml = sect >= 0 && sect > xml.lastIndexOf('</w:p>') ? xml.slice(0, sect) + tail + xml.slice(sect) : xml.replace('</w:body>', tail + '</w:body>');
  const out = parts.filter((e) => e.name !== `word/media/${media}`).map((e) => (e === doc ? { name: e.name, data: Buffer.from(xml, 'utf8') } : e === relsPart ? { name: e.name, data: Buffer.from(rels, 'utf8') } : e === types && ct ? { name: e.name, data: Buffer.from(ct, 'utf8') } : e));
  if (!relsPart) out.push({ name: 'word/_rels/document.xml.rels', data: Buffer.from(rels, 'utf8') });
  out.push({ name: `word/media/${media}`, data: png });
  return zip(out);
}

/** A message for the user: this file's own checks as written, anything else (zlib, memory) as a plain sentence. */
const userMessage = (e) => (/^The \.docx file|^Not a \.docx|^This (isn't|doesn't)/.test(String(e && e.message)) ? e.message : 'The .docx file could not be read.');
/** The document's visible text, paragraph by paragraph (tests, and the on-screen review). */
const docText = (buf) => { const d = unzip(buf).find((e) => e.name === 'word/document.xml'); return d ? (d.data.toString('utf8').match(P_RE()) || []).map(textOf) : []; };

module.exports = { unzip, zip, fillLoi, fillLoiXml, checkTemplate, docText, userMessage, addSignature };
