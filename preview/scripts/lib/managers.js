'use strict';
// Manager account changes used by the local CLI scripts (and their tests). Passwords are only ever hashed here.
const { User } = require('../../src/models');
const { hashPassword, revokeSessions } = require('../../src/auth');
const SH = require('../../public/shared');

const listManagers = () => User.find({ role: 'Manager' }).select('email name active').sort({ email: 1 });

/**
 * Sets a new password for an existing Manager and signs out all of their sessions.
 * Only the password hash changes; name, role, access and active state stay as they are.
 */
async function resetManagerPassword(email, password) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!SH.EMAIL_RE.test(e)) throw new Error('Enter the Manager\'s email address.');
  if (typeof password !== 'string' || password.length < SH.MIN_PASSWORD || password.length > 200) throw new Error(`The password must be ${SH.MIN_PASSWORD}–200 characters. Nothing was changed.`);
  const user = await User.findOne({ email: e, role: 'Manager' });
  if (!user) throw new Error(`No Manager account with the email ${e}. Nothing was changed. (To add one: npm run create-manager)`);
  user.passwordHash = await hashPassword(password);
  await user.save();
  const r = await revokeSessions(user._id);
  return { email: user.email, name: user.name, active: user.active, signedOut: r.deletedCount || 0 };
}

module.exports = { listManagers, resetManagerPassword };
