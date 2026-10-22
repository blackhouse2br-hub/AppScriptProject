'use strict';
const mongoose = require('mongoose');
const { redact } = require('./config');

mongoose.set('strictQuery', true);

async function connectDb(uri, { timeoutMs = 10000 } = {}) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs, appName: 'blackhouse-preview' });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    // the original error stays attached as `cause` (startup reporting redacts credentials)
    const e = new Error('Could not connect to MongoDB: ' + redact(err.message) + '. The app does not fall back to demo mode; fix MONGODB_URI or start with --mode=demo.', { cause: err });
    e.code = 'EMONGOCONNECT';
    throw e;
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));   // build indexes (unique emails, codes, session TTL)
  return mongoose.connection;
}

const dbReady = () => mongoose.connection.readyState === 1;
const disconnectDb = () => mongoose.disconnect();

module.exports = { connectDb, disconnectDb, dbReady };
