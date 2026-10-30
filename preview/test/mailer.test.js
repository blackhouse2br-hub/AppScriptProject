'use strict';
// The built-in SMTP client (src/mailer.js) against a local fake mail server: a message the server accepted counts as
// sent even if the goodbye fails; a refusal before that is a failure; the mode follows the port. Nothing leaves this computer.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { createMailer } = require('../src/mailer');

function fakeSmtp({ dropAtQuit = false, refuseRcpt = false } = {}) {
  const got = [];
  const server = net.createServer((s) => {
    let data = false, buf = '';
    s.write('220 fake ready\r\n');
    s.on('data', (d) => {
      buf += d.toString();
      if (data) { const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return; got.push(buf.slice(0, i)); buf = buf.slice(i + 5); data = false; s.write('250 queued\r\n'); }
      let j; while (!data && (j = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, j); buf = buf.slice(j + 2);
        if (/^EHLO/.test(line)) s.write('250 fake\r\n');
        else if (/^MAIL/.test(line)) s.write('250 ok\r\n');
        else if (/^RCPT/.test(line)) s.write(refuseRcpt ? '550 no such user\r\n' : '250 ok\r\n');
        else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { if (dropAtQuit) s.destroy(); else s.end('221 bye\r\n'); }
      }
    });
  });
  server.got = got;
  return server;
}
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

test('a message the server accepted is sent, even when the connection drops at the goodbye', async () => {
  const srv = fakeSmtp({ dropAtQuit: true }), port = await listen(srv);
  const m = createMailer({ host: '127.0.0.1', port, secure: false, from: 'Blackhouse <loi@example.com>' });
  await m.send({ to: 'test.signer@example.com', subject: 'Test', text: 'Hello' });
  assert.strictEqual(srv.got.length, 1);
  srv.close();
});

test('a refusal before the message is accepted is a failure, in plain words', async () => {
  const srv = fakeSmtp({ refuseRcpt: true }), port = await listen(srv);
  const m = createMailer({ host: '127.0.0.1', port, secure: false, from: 'loi@example.com' });
  await assert.rejects(m.send({ to: 'nobody@example.com', subject: 'Test', text: 'Hello' }), /refused the message \(recipient: 550\)/);
  srv.close();
});

test('the encryption follows the port: implicit TLS on 465, STARTTLS otherwise; plain only when switched off', () => {
  assert.strictEqual(createMailer({ host: 'smtp.example.com', port: 465, secure: true, from: 'a@b.c' }).mode, 'tls');
  assert.strictEqual(createMailer({ host: 'smtp.example.com', port: 587, secure: true, from: 'a@b.c' }).mode, 'starttls');
  assert.strictEqual(createMailer({ host: '127.0.0.1', port: 2525, secure: false, from: 'a@b.c' }).mode, 'plain');
});
