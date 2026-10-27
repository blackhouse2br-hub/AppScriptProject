# Blackhouse Leads Portal: local preview

A local rebuild of the Blackhouse Leads Portal's screens, using the original app's layout, labels and
workflows (from `src/Index.html`, `src/Code.gs` and `docs/data-points.xlsx` in `../blackhouse-leads-portal.zip`).
It runs in one of two **explicit** modes:

| | Demo mode | MongoDB mode |
|---|---|---|
| Data | Fictional sample data (DEMO- lead IDs, example.com emails, +63 900 555 numbers) | Your MongoDB database (`MONGODB_URI`) |
| Where edits go | This browser's localStorage only | MongoDB, through the local Express API |
| Sign-in | None. "View as" is a preview switch, **not authentication** | Email + password accounts stored in MongoDB |
| API | Switched off; the page may not make any network request (`connect-src 'none'`) | Same-origin `/api/` only |
| If MongoDB is unreachable | n/a | The server refuses to start (or the API answers 503). It never falls back to demo data |
| Monday.com / respond.io | Off (tokens are ignored) | **Read-only**, only when you set tokens in `.env`; otherwise "Not connected" |

Nothing connects to Google Apps Script, Google Drive/Sign-in, Railway or GitHub. Monday.com and respond.io are
read only in MongoDB mode, only after you add your own tokens, and nothing is ever written to them.

## Setup

Requires Node.js 22.9 or newer.

```powershell
cd preview
npm install          # once (express, mongoose; mongodb-memory-server for tests)
npm test             # demo, config, auth, permission and API tests (uses a throwaway in-memory MongoDB)
```

## Run in demo mode

```powershell
npm run start:demo   # http://127.0.0.1:4173
```

`npm start` with no `.env` also runs demo mode. "Reset demo data" in the yellow bar restores the sample set.

## Run with MongoDB

1. Copy `.env.example` to `.env` **in this folder** and edit `.env` on your computer (it is ignored by Git):
   - `APP_MODE=mongo`
   - `MONGODB_URI=` your connection string, for example a local MongoDB
     (`mongodb://127.0.0.1:27017/blackhouse_preview`) or a MongoDB Atlas database.
     Use a database name for this preview only. Don't point it at production data.
2. Create the first Manager. You're asked for the email, name and password in the terminal; the password is hidden and never stored in a file:
   ```powershell
   npm run create-manager
   ```
3. Optional: fill an **empty** database with the fictional sample records (refuses if data exists):
   ```powershell
   npm run seed:demo
   ```
4. Start and sign in:
   ```powershell
   npm start            # or: npm run start:mongo
   ```
   Add VAs and brokers in **Settings → Team & Access** with a temporary password (12+ characters).

`GET /healthz` reports `{ mode, db }`.

## Read-only Monday.com and respond.io (MongoDB mode)

What the original Apps Script reads, and what this phase connects:

| Source (original `Code.gs`) | Read here | Not in this phase |
|---|---|---|
| Monday **Direct Clients** board: lead fields matched by column **title** (`FIELD_DEFS`), hidden groups/statuses (`CONFIG.HIDE`), updates as notes | ✓ leads list, lead details, notes | Monday writes (AI STATUS, Client Status/Fail, move-in, subitems) |
| Monday **Listings** board (`LISTING_TITLES`, skip groups) | ✓ listings, property matching, inventory, photos (proxied) | availability changes, new listings |
| Monday **Calendar** board (Final Schedule, Clients, Building, City, Time, Salesperson, Status) | ✓ viewings in the lead panel, Calendar, Daily Report | LOI/contract/collection stages |
| respond.io `GET /contact/id:{id}` and `/message/list` (`shapeMessage_`) | ✓ contact + latest 300 messages in **Respond.io Chat** | sending, attachments, WhatsApp templates, contact search/creation, webhooks |

### Setup

1. In `preview/.env` (never committed) set any of:

   | Variable | Purpose |
   |---|---|
   | `MONDAY_TOKEN` | Monday API token (avatar → Developers → My access tokens) |
   | `MONDAY_LEADS_BOARD_ID` | Direct Clients board ID (original: `2001153190`) |
   | `MONDAY_LISTINGS_BOARD_ID` | Listings board ID (original: `2004661102`) |
   | `MONDAY_CALENDAR_BOARD_ID` | Calendar board ID (original: `2001153191`) |
   | `RESPOND_TOKEN` | respond.io Developer API token |
   | `RESPOND_SPACE_ID` | optional, for "Open in respond.io" links |

   Board IDs are deliberately not built in: reading a real board is always your explicit choice. **Real tokens show real customer data on this computer**, so keep them empty until you decide to connect.
2. Restart with `npm start` and sign in. The mode bar shows **Monday.com** and **respond.io** status chips: *Not connected* (variables missing), *Configured* (not used yet), *Connected*, or *Error* (hover for the message).
3. Switch **Data source → Monday.com · read-only** in the mode bar to see live Monday records in the same screens. Editing, booking and notes are disabled for them. **Settings → Integrations** shows each service's status, last success/error and a **Test Monday connection** button (Managers).

How it behaves:
- Credentials stay on the server; the browser only sees status. Monday requests can only be GraphQL `query` operations (mutations are refused before sending); respond.io requests can only be `GET` to an allowlist of paths.
- A failing service shows a red error and **no substitute data** (no demo or MongoDB records in its place).
- Monday data is cached in server memory for 5 minutes (Refresh forces a reload, at most every 30 s) and is **not saved to MongoDB**.
- The same visibility rules apply to Monday records: VAs see leads whose *VA Assigned* label matches their VA label; brokers see leads where they're the Salesperson or the broker on a viewing. **Settings → Team & Access** reads the VA Assigned and Salesperson labels from the board, offers them when adding a VA, refuses labels that aren't on the board, and shows a "Monday match" column per member.
- AI Status, Temperature, Needs VA Reply / Waiting on Client and Days in Stage are computed with the original's rules (`src/integrations/pipeline.js`). Reply states are checked from respond.io in batches of 60 chats after the Monday data loads. Listing photos are shown through a server proxy.
- What remains (Website Inquiries, older lead boards, subitems, AI chat reading, portal-only data) and what needs real accounts to verify: see **[SOURCE-COVERAGE.md](SOURCE-COVERAGE.md)**.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Starts in the mode from `.env` (`APP_MODE`; if empty: mongo when `MONGODB_URI` is set, else demo) |
| `npm run start:demo` / `start:mongo` | Forces a mode regardless of `APP_MODE` |
| `npm run create-manager` | Creates a Manager, or resets a Manager's password (signs out their other sessions) |
| `npm run reset-manager-password` | Resets an existing Manager's password only: shows the Manager account(s), asks for the new password twice without displaying it, signs out that Manager's sessions. Needs an interactive terminal; never logs the password |
| `npm run seed:demo` | Inserts fictional sample leads, listings, viewings, notes and templates into an empty database |
| `npm test` | All tests |
| `node test/ui-check.js [outDir]` | Browser check at desktop (1440 px) and phone (390 px) widths in headless Chrome/Edge, against a throwaway MongoDB and the local fake Monday/respond.io; screenshots and `results.json` in `outDir` |

## What's built

| Area | Demo | MongoDB |
|---|---|---|
| Leads list: tiles, search, filters, sort, chips | Working | Working |
| Lead drawer: Details edit + validation, Notes, Properties matching, Book Viewing, For Scheduling → Confirmed Schedule → Done | Working | Working |
| VA Portal, VA Management, Calendar, Inventory Dashboard (availability edit), Leads Report, Broker Management, Renewals, Daily Report, Property Requirements | Working | Working |
| Settings: Team & Access, WhatsApp Templates (stored only) | Working | Working (passwords, at least one Manager kept) |
| Manager / VA / Broker permissions and lead visibility | Simulated in the browser | Enforced by the server on every request |
| Respond.io Chat | Read-only sample | Read-only from respond.io when `RESPOND_TOKEN` is set, else "not connected" |
| Monday.com leads, listings, calendar, notes | n/a | Read-only, live (Data source switch) when configured |
| Properties tab: the VA's own search (city, bedrooms, rent/sale, price, furnishing, pets, keyword, "ignore the client's requirements") | Working | Working |
| Asking for Availability: units being checked with owners (one per lead + listing, up to 60 per lead), owner Call / WhatsApp / Viber links that open only when tapped (taps logged, newest 20), owner confirmed / not available. Nothing is sent and nothing goes to Monday or respond.io | This browser | MongoDB (`AvailabilityRequest`), for Monday and MongoDB leads |
| Mark as Failed: a **portal override** with a reason, **Managers only** (set and remove; enforced by the server), labelled "Portal override" wherever AI Status shows; Monday's Client Status / AI STATUS are not changed | This browser | MongoDB (`LeadOverride`) |
| For Client Approval, LOI / Contract / Collection / Active / For Renewal, Upselling, Service Requests, Project Pages, P&L, Files, Monday Sync | Placeholder | Placeholder |
| Google sign-in | n/a | Built for the hosted server (DEPLOYMENT.md); the local preview keeps email and password |
| Monday writes, respond.io messaging, Drive files, e-signatures, webhooks, scheduled jobs | Not connected | Not connected |

## Everyday use: quick keys and shortcuts

| Task | How |
|---|---|
| Find a lead | <kbd>/</kbd> jumps to search (name, phone, lead ID, location, VA); <kbd>Esc</kbd> clears it. Filter chips show every active filter; **Clear all filters** resets them |
| Scan the list | Click a column header to sort (again to reverse). AI Status shows days in stage; Temperature shows who owes a reply; VA and RENT/SALE are coloured pills |
| Open details | Click a row, or <kbd>↑</kbd><kbd>↓</kbd> then <kbd>Enter</kbd>. Status, VA, type, budget and move-in are at the top of the panel. <kbd>[</kbd> <kbd>]</kbd> go to the previous/next lead; <kbd>Esc</kbd> closes and returns to the row |
| Arrange a viewing | <kbd>B</kbd> on a row (or the 📅 button, or **Book Viewing** in the panel) opens matched properties with the first **Book Viewing** focused → <kbd>Enter</kbd> → pick Today/Tomorrow/Sat/Sun and a time slot → <kbd>Enter</kbd> |
| Save edits | <kbd>Ctrl</kbd>+<kbd>S</kbd> in the Details tab |

### Phones and tablets

Below 900 px the sidebar becomes a ☰ menu (tap outside or Esc to close). Below about 760 px the lead list shows cards
(name, phone, lead ID, AI Status, Temperature/reply, VA, type, 📅 book). On phones, search stays at the top and the
filters open in a **Filters** sheet (the button shows how many are active; chips list them). Lead details and chat open
full-screen, dialogs (booking, viewings, team, templates) open as bottom sheets, and the Calendar adds an agenda list
under the month grid. Desktop layout is unchanged. Checked at 360, 390, 430 and 768 px in both modes (emulated, not yet on a real device).

Large lists draw 150 rows at a time and add more as you scroll; filtering, sorting and saving update only the affected
parts of the page. Columns drop out on narrower windows (Added, then Source, then Move-in) instead of forcing sideways scrolling.
For a stress test in demo mode, open `http://127.0.0.1:4173/?leads=3000` (fictional, not saved).

## Layout

```
server.js            entry point: picks the mode, connects MongoDB (mongo mode), starts Express
src/config.js        environment → explicit mode; validation; credential redaction; production block
src/deploy.js        page/API addresses (GitHub Pages + Railway), same-site check, sign-in method
src/google.js        Google sign-in (OAuth code flow + PKCE, ID token signature check, Team & Access match)
src/db.js            mongoose connection (no fallback)
src/models.js        Lead, Listing, Viewing, Note, User, Template, Session
src/auth.js          scrypt password hashing, MongoDB sessions (HttpOnly, SameSite=Strict cookie), sign-in throttle
src/api.js           explicit API routes with module-access and lead-visibility checks
src/access.js        module access + lead visibility (MongoDB records and Monday records)
src/integrations/    read-only Monday.com (monday.js) and respond.io (respondio.js) clients, status, routes
src/app.js           Express app: security headers, /config.js, /healthz, static files
public/shared.js     picklists, access rules, validation shared by browser and server
public/app.js        the UI (unchanged design); data layer switches between localStorage and the API
public/api-client.js JSON client (only /api/ paths; same origin, or the configured API on GitHub Pages)
scripts/             create-manager, reset-manager-password, seed-demo, build-pages (static portal for GitHub Pages)
railway.json         Railway start command + health check
DEPLOYMENT.md        GitHub Pages + Railway + Atlas + Google setup, step by step
test/                node:test suites; test/fixtures/fake-integrations.js is a local fake Monday/respond.io API
```

## Before production

The hosting plan (Railway runs the portal; GitHub Pages only redirects to it; MongoDB Atlas; Google sign-in) is
described step by step in **[DEPLOYMENT.md](DEPLOYMENT.md)**. It needs no custom domain. With `NODE_ENV=production` the server
still refuses to start in **either** mode, until a staging deployment has passed the checklist there.

### Google sign-in (implemented; tested locally against a fake Google)

Email-and-password sign-in works only on the local preview (`HOST=127.0.0.1`). A server reachable by others must use
Google (`AUTH_PROVIDER=google`, the default there), matching the original portal.

1. **OAuth client** in Google Cloud Console (Web application); `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are server variables only.
2. **Server-side flow** (`src/google.js`): authorization code with PKCE, a one-time `state` bound to the browser, and a `nonce`. The ID token's RS256 signature is checked against Google's published keys, then issuer, audience, expiry and nonce. No extra library is needed; Node's crypto does it.
3. **Access stays in Team & Access.** Only an active member whose verified email matches can sign in; optionally only one Workspace domain (`GOOGLE_ALLOWED_DOMAIN`). Role, VA label and module access come from MongoDB on every request. The Google account is linked on first sign-in and must match afterwards.
4. **No passwords on a Google server.** `/api/auth/login` answers 404, Team & Access has no password fields, and members are added by email.
5. **Sessions:** MongoDB sessions in a `__Host-` `HttpOnly; Secure; SameSite=Strict` cookie over HTTPS, `trust proxy` for Railway. Removing a member or changing their email signs them out.
6. **Remove the production guard** in `src/config.js` only after the staging checklist in DEPLOYMENT.md passes.

### Also required before real data

- An import plan for Monday.com and the Users sheet with validation and rollback, run first against a copy.
- Production MongoDB with authentication, network restrictions, backups and a least-privilege database user.
- Monday.com writes and respond.io messaging stay off until each one is switched on deliberately.

## Security notes and limits of this phase

- Sign-in uses local email-and-password accounts (scrypt) on the local preview, and Google on a hosted server (see above).
- Session cookies are `HttpOnly; SameSite=Strict`, plus `Secure` and the `__Host-` prefix over HTTPS. State-changing requests are accepted only from this server's own page or `PORTAL_URL`; only `PORTAL_URL` gets CORS access.
- Monday.com data is kept only in server memory (never in MongoDB or the browser's storage). After the first load, the last good copy stays on screen with the time it was read, while a newer one loads in the background; a failed refresh is shown in red with its time, and nothing else is substituted.
- Every API input is checked against an allowlist; unknown fields and non-text values are refused.
- The failed-sign-in throttle is in memory (per process). A shared store is needed before running several instances.
- Lead fields such as AI Status, Temperature and reply state are stored snapshots here; in the live portal they are computed from Monday.com and respond.io.
- Demo mode refuses to start with `NODE_ENV=production`.
