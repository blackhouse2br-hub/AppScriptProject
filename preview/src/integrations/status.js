'use strict';
// Connection state per integration, shown in the UI: not_configured → not_checked → ok | error.
const { redact } = require('../config');

class IntegrationError extends Error {
  constructor(integration, message, { status = 502, countsAsFailure = true } = {}) {
    super(redact(message));
    this.integration = integration;
    this.httpStatus = status;
    this.countsAsFailure = countsAsFailure;   // e.g. "no such contact" is not a connection failure
  }
}

function createStatus(configured, missing) {
  const s = { configured, missing, state: configured ? 'not_checked' : 'not_configured', lastOkAt: null, lastError: '', lastErrorAt: null };
  return {
    ok() { s.state = 'ok'; s.lastOkAt = new Date().toISOString(); },
    error(msg) { s.state = 'error'; s.lastError = redact(msg); s.lastErrorAt = new Date().toISOString(); },
    snapshot: () => ({ ...s }),
  };
}

/** Records success/failure of one call against the integration's status. */
async function tracked(status, fn) {
  try { const out = await fn(); status.ok(); return out; } catch (err) {
    if (!(err instanceof IntegrationError) || err.countsAsFailure) status.error(err.message);
    throw err;
  }
}

module.exports = { IntegrationError, createStatus, tracked };
