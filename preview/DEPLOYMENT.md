# Hosting the portal: Railway (app) + GitHub Pages (redirect) + MongoDB Atlas

```
 GitHub Pages ── redirect ──►  https://<service>.up.railway.app   Railway: the whole portal
 (static page, no code,                                            page + API + Google sign-in + all secrets
  no settings, no cookies)                                          ├─► MongoDB Atlas   team, sessions, app records
                                                                    ├─► Monday.com      read-only (+ allowlisted updates if MONDAY_WRITES=on)
                                                                    └─► respond.io      read-only
```

* **Railway** runs the portal: it serves the page and the API from one address, and handles Google sign-in.
* **GitHub Pages** only publishes a redirect page to that address. It has no app code, no settings and no
  secrets, and it is published only after the Railway address answers as this portal (see step 5).

> **Status:** the code is ready and tested locally against fake Google, Monday and respond.io servers. It has not been
> deployed. `NODE_ENV=production` is still refused on purpose (the production sign-in guard) until a staging run
> passes "Before production" below.

## Does this need a custom domain? No.

The sign-in cookie is set by the Railway address and used by pages from that same address, so it's a first-party
cookie. It works in Safari, in Chrome Incognito and on phones. The GitHub Pages redirect never sets or reads a cookie,
so it doesn't matter that `github.io` is a different site.

A custom domain is optional, for a nicer address. It is only *required* if the page itself is hosted somewhere other
than Railway, which is the "full page" option of `scripts/build-pages.js`, and that isn't this setup.

## 1. Railway service settings

Project **Blackhousedashboard** → service **AppScriptProject** → **Settings**:

* **Source → Root Directory:** `/preview`. `preview/railway.json` then sets the start command (`node server.js`), the
  health check (`/healthz`) and restart on failure.
* **Networking → Public Networking → Generate Domain.** Railway shows an address like
  `https://appscriptproject-production.up.railway.app`. Use the port Railway suggests; the app listens on the `PORT`
  Railway gives it. This address is your `PUBLIC_API_URL` below, and the address people use.

## 2. Railway variables

Service **AppScriptProject** → **Variables**. Every name below is read by `src/config.js` or `src/deploy.js`.
🔒 marks a secret: type or paste it only into Railway, never into GitHub, chat, a file or the page.

| Variable | Required | What it must contain |
| --- | --- | --- |
| `APP_MODE` | yes | `mongo` |
| `MONGODB_URI` | yes 🔒 | Atlas connection string, `mongodb+srv://<user>:<password>@<cluster-host>/<database>?retryWrites=true&w=majority` |
| `HOST` | yes | `0.0.0.0`, so Railway's proxy can reach the app |
| `PUBLIC_API_URL` | yes | the Railway address from step 1, e.g. `https://appscriptproject-production.up.railway.app`: `https://`, no path, no trailing text |
| `AUTH_PROVIDER` | recommended | `google`. This is already the default when `HOST` isn't 127.0.0.1, and `password` is refused there. |
| `GOOGLE_CLIENT_ID` | yes | from step 3, ending in `.apps.googleusercontent.com`. It isn't a secret, but it belongs only here. |
| `GOOGLE_CLIENT_SECRET` | yes 🔒 | from step 3 (starts with `GOCSPX-`) |
| `GOOGLE_ALLOWED_DOMAIN` | optional | your Google Workspace domain (e.g. `yourcompany.com`) to refuse personal Gmail accounts. Leave it unset if the team uses Gmail. |
| `NODE_ENV` | see step 6 | Railway sets `production` by default, which the guard refuses. Leave it as it is until the new code is deployed, then set `staging` for the test run. |
| `SESSION_HOURS` | optional | sign-in length in hours, 1–720 (default `12`) |
| `MONDAY_TOKEN` | yes 🔒 | Monday API token (read-only use; with `MONDAY_WRITES=on` it also needs write access to the Leads and Listings boards) |
| `MONDAY_LEADS_BOARD_ID` | yes | digits only (Direct Clients board) |
| `MONDAY_LISTINGS_BOARD_ID` | yes | digits only |
| `MONDAY_CALENDAR_BOARD_ID` | yes | digits only |
| `MONDAY_WRITES` | optional | leave **unset** (off): Monday is read-only. `on` enables only the allowlisted, user-confirmed updates in README "Monday updates" (the token then needs write access to those boards). |
| `MONDAY_CALENDAR_FEEDBACK_COLUMN` | optional | a Calendar-board **text** column id that also receives a viewing's broker feedback (one line, ≤ 200 characters). Unset: the feedback stays in the portal only. Must not be a column the portal already reads. |
| `MONDAY_WRITE_LIMIT` | optional | Monday update attempts per user per minute, 1–60 (default 10; the server as a whole allows 3×). |
| `RESPOND_TOKEN` | optional 🔒 | respond.io API token (read-only use); without it the Chat tab says "not connected" |
| `RESPOND_SPACE_ID` | optional | digits only; only adds "Open in respond.io" links |
| `RESPOND_LIST_CHECKS` | optional | leave **unset** (off): respond.io is read only when someone opens a lead's Chat tab. `on` checks every visible lead. |

**Do not set:**
* `PORT`: Railway sets it.
* `PORTAL_URL`: leave it unset, because Railway serves the page itself. It's only for a page hosted on another domain you own.
* `MONDAY_API_URL`, `RESPOND_API_URL`, `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_JWKS_URL`: these are for local test servers only. The server refuses them unless they point to 127.0.0.1.

The app checks all of this at startup. If anything is missing or unsafe, it stops with a one-line message in the
deploy log naming the variable, and never prints the values.

## 3. Google sign-in (Google Cloud Console)

1. https://console.cloud.google.com → a project such as "Blackhouse Portal".
2. **APIs & Services → OAuth consent screen:** use **Internal** if the team is on Google Workspace. Otherwise use
   **External**, and add each team member under **Test users** or publish the app. Scopes: `openid`, `email` and
   `profile` only.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**:
   * **Authorized redirect URI:** `<PUBLIC_API_URL>/api/auth/google/callback`, for example
     `https://appscriptproject-production.up.railway.app/api/auth/google/callback`. It must match exactly.
   * No "Authorized JavaScript origins" are needed.
4. Put the Client ID and Client secret into the Railway variables `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Who can sign in: only active people in **Settings → Team & Access** (MongoDB). Their Manager / VA / Broker role and
module access come from there; Google only proves the email. On the first sign-in, the Google account is linked; a
different Google account with the same email is refused later. Removing a member, or changing their email, signs
them out.

## 4. MongoDB Atlas

* **Database Access:** a user for Railway with read/write on the portal's database only.
* **Network Access:** add `0.0.0.0/0`. Railway's outgoing addresses change unless you buy static IPs. Keep the
  password long and random.
* **First Manager:** Team & Access must already contain a Manager whose email is their Google account's email. If
  Railway uses the same database as your local preview, your existing Manager is already there. Otherwise create one
  from your own computer with `npm run create-manager`, against that database. The password it asks for is ignored on
  Railway.

## 5. GitHub Pages (redirect only)

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables tab → New repository variable:**
   `RAILWAY_APP_URL` = the Railway address, e.g. `https://appscriptproject-production.up.railway.app`. It's a public
   address, not a secret. Don't add anything else here.
3. **Actions → "Portal redirect to GitHub Pages" → Run workflow.** It runs only when started by hand. First it checks
   `<RAILWAY_APP_URL>/healthz`: this portal, MongoDB mode, Google sign-in, database connected. If any of those fail,
   nothing is published. Then it publishes `https://blackhouse2br-hub.github.io/AppScriptProject/`, which forwards to Railway.

Local check: `npm run build:pages -- --redirect=https://<service>.up.railway.app` (output in `preview/dist-pages/`).

## 6. Safe order

1. Enter the settings and variables from steps 1–4, with `NODE_ENV` left at Railway's default. While the old code is
   deployed, this keeps it refusing to start. The old code has no Google sign-in and must never run on Railway.
2. Push the new code. With `NODE_ENV=production`, the new code checks every setting and then stops with
   *"Production start is still blocked…"*. That message means all other settings passed.
3. Set `NODE_ENV=staging`. Railway redeploys; `<PUBLIC_API_URL>/healthz` must show
   `{"ok":true,"app":"blackhouse-leads-portal","mode":"mongo","db":"connected","auth":"google"}`.
4. Run the GitHub Pages workflow.

The staging run is a real, public address showing real Monday data, but only to team members who sign in with Google.

## Before production

Production (`NODE_ENV=production`) stays blocked in `src/config.js` until all of these pass on the staging run:

- [ ] `<PUBLIC_API_URL>/healthz` shows `"db":"connected"` and `"auth":"google"`.
- [ ] A listed Manager, VA and Broker can each sign in with Google, in Chrome, Safari and a phone browser, and see only
      what their role allows.
- [ ] An unlisted Google account is refused with "That Google account isn't on the team".
- [ ] Removing a member signs them out on their next action.
- [ ] Monday leads, listings and calendar load; nothing is written to Monday.
- [ ] The GitHub Pages address forwards to the Railway address.

After that, a small code change removes the block (the "Production start is still blocked" check in `src/config.js`),
and `NODE_ENV` can be set to `production`.
