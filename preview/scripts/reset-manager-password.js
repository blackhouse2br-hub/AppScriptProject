'use strict';
// Resets the password of an existing Manager in the MongoDB from preview/.env.
//   npm run reset-manager-password
// The new password is typed twice in this terminal; it is never shown, written to a file, or logged.
// All of that Manager's sessions are signed out. Nothing else about the account changes.
const { loadConfig, redact } = require('../src/config');
const { connectDb, disconnectDb } = require('../src/db');
const SH = require('../public/shared');
const { ask, askNewPassword } = require('./lib/prompt');
const { listManagers, resetManagerPassword } = require('./lib/managers');

(async () => {
  if (!process.stdin.isTTY) throw new Error('Run this in an interactive terminal, so the password can be typed without being shown.');
  const config = loadConfig(process.env, ['--mode=mongo']);   // keeps the production guard: refuses with NODE_ENV=production
  await connectDb(config.mongoUri);
  try {
    const managers = await listManagers();
    if (!managers.length) throw new Error('There is no Manager account yet. Create one with: npm run create-manager');
    let email;
    if (managers.length === 1) {
      const m = managers[0];
      console.log(`Manager account: ${m.name} <${m.email}>${m.active ? '' : ' (inactive)'}`);
      const ok = (await ask('Reset this Manager\'s password? (y/N): ')).trim().toLowerCase();
      if (ok !== 'y' && ok !== 'yes') { console.log('Nothing was changed.'); return; }
      email = m.email;
    } else {
      console.log('Manager accounts:');
      managers.forEach((m) => console.log(`  ${m.email}  (${m.name}${m.active ? '' : ', inactive'})`));
      email = (await ask('Email of the Manager to reset: ')).trim().toLowerCase();
      if (!managers.some((m) => m.email === email)) throw new Error('That email is not one of the Manager accounts above. Nothing was changed.');
    }
    const password = await askNewPassword(SH.MIN_PASSWORD);
    const r = await resetManagerPassword(email, password);
    console.log(`Password updated for ${r.email}. ${r.signedOut} active session${r.signedOut === 1 ? ' was' : 's were'} signed out.`);
    if (!r.active) console.log('Note: this account is inactive, so it still cannot sign in until it is reactivated.');
    console.log('Start the app with "npm start" and sign in with the new password.');
  } finally {
    await disconnectDb();
  }
})().catch((err) => { console.error('[reset-manager-password] ' + redact(err.message)); process.exit(1); });
