'use strict';
// A minimal SMTP client (no dependency) for emailing LOI signing links, as the Apps Script used MailApp: implicit TLS
// (port 465) with AUTH LOGIN, or plain only for a local test server. One message per connection; never logs the password.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

class MailError extends Error { constructor(message) { super(message); this.integration = 'email'; this.httpStatus = 502; } }
const hdr = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=');
const addr = (s) => (String(s).match(/<([^>]+)>/) || [, String(s)])[1].trim();
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

/** cfg: { host, port, secure, user, pass, from } */
function createMailer(cfg) {
  function session(lines) {
    return new Promise((resolve, reject) => {
      const sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
      sock.setTimeout(30000, () => { sock.destroy(); reject(new MailError('The mail server did not answer in time.')); });
      let buf = '', step = -1;
      const next = () => { step++; if (step < lines.length) sock.write(lines[step].send + '\r\n'); else { sock.end(); resolve(); } };
      sock.on('data', (d) => {
        buf += d.toString('utf8');
        // a complete reply: its last line is "NNN text" (not "NNN-…")
        const done = buf.split('\r\n').filter(Boolean).pop(); if (!done || /^\d{3}-/.test(done) || !/^\d{3}/.test(done)) return;
        const code = Number(done.slice(0, 3)); buf = '';
        const want = step < 0 ? [220] : lines[step].expect;
        if (!want.includes(code)) { sock.destroy(); return reject(new MailError(`The mail server refused the message (${step < 0 ? 'greeting' : lines[step].what}: ${code}).`)); }
        next();
      });
      sock.on('error', () => reject(new MailError('The mail server could not be reached.')));
    });
  }
  /** { to, subject, text, attachment: { name, type, data } } */
  async function send({ to, subject, text, attachment }) {
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(to)) throw new MailError('That email address doesn\'t look valid.');
    const b = 'bh' + crypto.randomBytes(12).toString('hex');
    const msg = [`From: ${cfg.from}`, `To: <${to}>`, `Subject: ${hdr(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@blackhouse-portal>`, 'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text).toString('base64')),
      ...(attachment ? [`--${b}`, `Content-Type: ${attachment.type}; name="${attachment.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${attachment.name}"`, '', wrap76(attachment.data.toString('base64'))] : []),
      `--${b}--`, ''].join('\r\n').replace(/^\./gm, '..');
    await session([
      { send: 'EHLO blackhouse-portal', expect: [250], what: 'hello' },
      ...(cfg.user ? [{ send: 'AUTH LOGIN', expect: [334], what: 'login' }, { send: Buffer.from(cfg.user).toString('base64'), expect: [334], what: 'login' }, { send: Buffer.from(cfg.pass).toString('base64'), expect: [235], what: 'password' }] : []),
      { send: `MAIL FROM:<${addr(cfg.from)}>`, expect: [250], what: 'sender' }, { send: `RCPT TO:<${to}>`, expect: [250, 251], what: 'recipient' },
      { send: 'DATA', expect: [354], what: 'data' }, { send: msg + '\r\n.', expect: [250], what: 'message' }, { send: 'QUIT', expect: [221], what: 'quit' },
    ]);
  }
  return { send };
}

module.exports = { createMailer, MailError };
