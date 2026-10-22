'use strict';
// Creates (or resets the password of) a Manager account in MongoDB.
//   npm run create-manager
// Asks for the details in this terminal; the password is not echoed and is never written to a file or log.
const { loadConfig, redact } = require('../src/config');
const { connectDb, disconnectDb } = require('../src/db');
const { User } = require('../src/models');
const { hashPassword, revokeSessions } = require('../src/auth');
const SH = require('../public/shared');
const { ask, askNewPassword } = require('./lib/prompt');

(async () => {
  if (!process.stdin.isTTY) throw new Error('Run this in an interactive terminal, so the password can be typed without being shown.');
  const config = loadConfig(process.env, ['--mode=mongo']);
  await connectDb(config.mongoUri);
  try {
    const email = (await ask('Manager email: ')).trim().toLowerCase();
    const name = (await ask('Display name: ')).trim();
    const password = await askNewPassword(SH.MIN_PASSWORD);
    const { value, errors } = SH.validateUser({ email, name, role: 'Manager', password });
    if (errors.length) throw new Error(errors[0]);
    const existing = await User.findOne({ email });
    const passwordHash = await hashPassword(value.password);
    if (existing) {
      Object.assign(existing, { name: value.name, role: 'Manager', active: true, passwordHash });
      await existing.save();
      await revokeSessions(existing._id);
      console.log(`Updated ${email}: now a Manager with the new password. Other sessions were signed out.`);
    } else {
      await User.create({ email: value.email, name: value.name, role: 'Manager', vaLabel: '', modules: {}, passwordHash });
      console.log(`Created Manager ${email}. Start the app with "npm start" and sign in.`);
    }
  } finally {
    await disconnectDb();
  }
})().catch((err) => { console.error('[create-manager] ' + redact(err.message)); process.exit(1); });
