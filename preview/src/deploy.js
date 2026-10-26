'use strict';
// Where the API and the portal page live, and how people sign in. Used by config.js.
//
//   Local preview (default): page and API on http://127.0.0.1:<port>, email-and-password sign-in.
//   Split hosting:           page on GitHub Pages (PORTAL_URL), API on Railway (PUBLIC_API_URL), Google sign-in.
//
// The sign-in cookie must be a first-party cookie, so the two addresses have to be the same *site*: subdomains of one
// domain you own (portal.example.com + api.example.com). The default hosts (*.github.io, *.up.railway.app) are separate
// public suffixes, so a cookie from the API would be a third-party cookie there (blocked by Safari, Chrome Incognito
// and many privacy settings). That combination is refused at startup instead of half-working.

const LOOPBACK = /^(127\.0\.0\.1|localhost|::1|\[::1\])$/i;
// shared hosting domains on the Public Suffix List: every customer subdomain is its own site
const SHARED_HOSTS = ['github.io', 'up.railway.app', 'railway.app', 'pages.dev', 'vercel.app', 'netlify.app', 'onrender.com',
  'herokuapp.com', 'fly.dev', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'appspot.com'];

const isLoopback = (host) => LOOPBACK.test(String(host || ''));

/**
 * The "site" a host belongs to for cookies (approximately its registrable domain): user.github.io, example.com,
 * example.com.ph. Good enough for this check; a full Public Suffix List lookup is not needed for the hosts we expect.
 */
function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (isLoopback(h)) return 'localhost';
  const shared = SHARED_HOSTS.find((s) => h === s || h.endsWith('.' + s));
  if (shared) return h.split('.').slice(-(shared.split('.').length + 1)).join('.');
  const parts = h.split('.');
  const secondLevel = parts.length > 2 && /^(co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(secondLevel ? -3 : -2).join('.');
}
const sharedHost = (host) => SHARED_HOSTS.find((s) => host === s || host.endsWith('.' + s)) || '';

function parseUrl(key, value, { allowPath }) {
  let u;
  try { u = new URL(value); } catch (e) { throw new Error(`${key} must be a full address such as https://api.example.com (got "${value}").`); }
  if (u.username || u.password || u.search || u.hash) throw new Error(`${key} must not contain a user name, password, query or #fragment.`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) throw new Error(`${key} must use https:// (plain http is only allowed for 127.0.0.1).`);
  if (!allowPath && u.pathname !== '/') throw new Error(`${key} must be just the address, without a path (for example https://api.example.com).`);
  return u;
}

// Google endpoints are fixed; an override is accepted only for a local mock server (tests)
function googleUrl(env, key, official) {
  const v = String(env[key] || '').trim();
  if (!v) return official;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+(\/[\w/.-]*)?$/.test(v)) throw new Error(`${key} may only point to a local mock server (http://127.0.0.1:<port>).`);
  return v;
}

/**
 * @returns {{ web: object, auth: object }}
 *   web:  apiOrigin, portalUrl, portalOrigin, crossOrigin, secureCookies, trustProxy
 *   auth: provider 'password' | 'google', google: { clientId, clientSecret, allowedDomain, redirectUri, authUrl, tokenUrl }
 */
function loadDeploy(env, { host, port, production }) {
  const local = isLoopback(host);
  const apiRaw = String(env.PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  const portalRaw = String(env.PORTAL_URL || '').trim();
  const api = apiRaw ? parseUrl('PUBLIC_API_URL', apiRaw, { allowPath: false }) : null;
  const portal = portalRaw ? parseUrl('PORTAL_URL', portalRaw, { allowPath: true }) : null;
  if (!local && !api) throw new Error('PUBLIC_API_URL is required when the server is reachable from other computers (HOST is not 127.0.0.1). Set it to the API\'s public https:// address.');
  const apiOrigin = api ? api.origin : `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  const portalOrigin = portal ? portal.origin : apiOrigin;
  const crossOrigin = portalOrigin !== apiOrigin;

  if (crossOrigin) {
    const ph = portal.hostname, ah = api ? api.hostname : host;
    if ((portal.protocol === 'https:') !== (api ? api.protocol === 'https:' : false)) throw new Error('PORTAL_URL and PUBLIC_API_URL must both use https:// (or both be local http://127.0.0.1 addresses).');
    if (siteOf(ph) !== siteOf(ah)) {
      const shared = [sharedHost(ph), sharedHost(ah)].filter(Boolean);
      throw new Error(`The portal (${ph}) and the API (${ah}) are different sites, so the sign-in cookie would be a third-party cookie and would be blocked by many browsers`
        + (shared.length ? ` (${shared.join(' and ')} ${shared.length > 1 ? 'are' : 'is a'} shared domain${shared.length > 1 ? 's' : ''}: every customer address is its own site)` : '')
        + '. Put both on one domain you own, for example portal.yourdomain.com (GitHub Pages) and api.yourdomain.com (Railway). See DEPLOYMENT.md.');
    }
  }

  const provider = String(env.AUTH_PROVIDER || (local ? 'password' : 'google')).trim().toLowerCase();
  if (!['password', 'google'].includes(provider)) throw new Error(`AUTH_PROVIDER must be "password" or "google" (got "${provider}").`);
  // email-and-password sign-in is approved for this computer only
  if (provider === 'password' && (!local || crossOrigin || production)) {
    throw new Error('Email-and-password sign-in is for the local preview only (HOST=127.0.0.1, one address for page and API). A server others can reach must use Google sign-in: AUTH_PROVIDER=google.');
  }
  let google = null;
  if (provider === 'google') {
    const clientId = String(env.GOOGLE_CLIENT_ID || '').trim(), clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
    const missing = [!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET'].filter(Boolean);
    if (missing.length) throw new Error(`Google sign-in needs ${missing.join(' and ')} (from Google Cloud Console → APIs & Services → Credentials). Set them as server variables, never in the page.`);
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('GOOGLE_CLIENT_ID should look like 1234-abc.apps.googleusercontent.com.');
    const allowedDomain = String(env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase();
    if (allowedDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(allowedDomain)) throw new Error('GOOGLE_ALLOWED_DOMAIN must be a domain such as yourcompany.com (or left empty).');
    google = {
      clientId, clientSecret, allowedDomain,
      redirectUri: apiOrigin + '/api/auth/google/callback',
      authUrl: googleUrl(env, 'GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
      tokenUrl: googleUrl(env, 'GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
      jwksUrl: googleUrl(env, 'GOOGLE_JWKS_URL', 'https://www.googleapis.com/oauth2/v3/certs'),
    };
  }

  return {
    web: {
      apiOrigin, portalUrl: portal ? portal.href : '/', portalOrigin, crossOrigin,
      secureCookies: production || apiOrigin.startsWith('https:'),
      trustProxy: production || !local,   // Railway terminates HTTPS at its proxy
    },
    auth: { provider, google },
  };
}

module.exports = { loadDeploy, siteOf, isLoopback, SHARED_HOSTS };
