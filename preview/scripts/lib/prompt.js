'use strict';
// Terminal prompts for the local admin scripts. Hidden input is read in raw mode, so the characters are never
// echoed, and it refuses to run without an interactive terminal (a password must not be piped or logged).
const readline = require('readline');

function ask(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: !!input.isTTY });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this in an interactive terminal, so the password can be typed without being shown.'));
  }
  return new Promise((resolve, reject) => {
    output.write(question);
    let buf = '';
    const wasRaw = !!input.isRaw;
    const finish = (err, value) => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      const s = String(chunk);
      if (s.startsWith('\u001b')) return;                          // arrow keys and other escape sequences
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') return finish(null, buf);
        if (ch === '\u0003' || ch === '\u0004') return finish(new Error('Cancelled.'));   // Ctrl+C / Ctrl+D
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }         // Backspace
        if (ch < ' ') continue;                                    // other control characters
        buf += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}

/** Asks twice; both must match. */
async function askNewPassword(min, io) {
  const password = await askHidden(`New password (at least ${min} characters, hidden): `, io);
  const again = await askHidden('Repeat the new password: ', io);
  if (password !== again) throw new Error('The passwords do not match. Nothing was changed.');
  return password;
}

module.exports = { ask, askHidden, askNewPassword };
