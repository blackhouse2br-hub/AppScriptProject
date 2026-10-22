'use strict';
// Local admin CLI: hidden password prompt and Manager password reset (throwaway in-memory MongoDB).
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDb, disconnectDb } = require('../src/db');
const { User, Session } = require('../src/models');
const { hashPassword, verifyPassword } = require('../src/auth');
const { askHidden, askNewPassword } = require('../scripts/lib/prompt');
const { resetManagerPassword, listManagers } = require('../scripts/lib/managers');

/** A fake terminal: input emits keystrokes, output records everything written to the screen. */
function fakeTty() {
  const input = new EventEmitter();
  Object.assign(input, { isTTY: true, isRaw: false, rawCalls: [], setRawMode(v) { this.isRaw = v; this.rawCalls.push(v); }, setEncoding() {}, resume() {}, pause() {} });
  const written = [];
  return { input, output: { write: (s) => written.push(String(s)) }, written };
}

test('hidden prompt never echoes the password and restores the terminal', async () => {
  const t = fakeTty();
  const p = askHidden('Password: ', t);
  t.input.emit('data', 'se'); t.input.emit('data', '\u001b[A'); t.input.emit('data', 'cr\u007fet-pass!\r');
  assert.strictEqual(await p, 'secet-pass!');
  assert.ok(!t.written.join('').includes('sec'), 'typed characters must not be written');
  assert.deepStrictEqual(t.input.rawCalls, [true, false]);
  const c = fakeTty(); const q = askHidden('Password: ', c); c.input.emit('data', 'abc\u0003');
  await assert.rejects(q, /Cancelled/);
  await assert.rejects(askHidden('Password: ', { input: { isTTY: false }, output: { write() {} } }), /interactive terminal/);
});

test('new password must be typed twice identically', async () => {
  const t = fakeTty();
  const p = askNewPassword(12, t);
  t.input.emit('data', 'first-password-1\r');
  await new Promise((r) => setImmediate(r));
  t.input.emit('data', 'other-password-2\r');
  await assert.rejects(p, /do not match/);
});

let mem;
test.before(async () => { mem = await MongoMemoryServer.create(); await connectDb(mem.getUri('bh_cli')); });
test.after(async () => { await disconnectDb(); await mem.stop(); });

test('resetting a Manager password: hash only, sessions signed out, other accounts refused', async () => {
  const boss = await User.create({ email: 'boss@example.com', name: 'Boss', role: 'Manager', modules: {}, passwordHash: await hashPassword('old-password-123') });
  await User.create({ email: 'va@example.com', name: 'VA', role: 'VA', vaLabel: 'Ana', passwordHash: await hashPassword('va-password-1234') });
  await Session.create({ tokenHash: 'x'.repeat(64), userId: boss._id, expiresAt: new Date(Date.now() + 3600e3) });
  assert.deepStrictEqual((await listManagers()).map((m) => m.email), ['boss@example.com']);

  await assert.rejects(resetManagerPassword('boss@example.com', 'short'), /12–200 characters/);
  await assert.rejects(resetManagerPassword('va@example.com', 'a-new-password-99'), /No Manager account/);
  await assert.rejects(resetManagerPassword('nobody@example.com', 'a-new-password-99'), /No Manager account/);

  const r = await resetManagerPassword(' BOSS@example.com ', 'a-new-password-99');
  assert.deepStrictEqual([r.email, r.signedOut], ['boss@example.com', 1]);
  const after = await User.findOne({ email: 'boss@example.com' }).select('+passwordHash');
  assert.ok(await verifyPassword('a-new-password-99', after.passwordHash));
  assert.ok(!(await verifyPassword('old-password-123', after.passwordHash)));
  assert.deepStrictEqual([after.name, after.role, after.active], ['Boss', 'Manager', true]);   // nothing else changed
  assert.strictEqual(await Session.countDocuments({ userId: boss._id }), 0);
  assert.ok(!after.passwordHash.includes('a-new-password-99'));
});
