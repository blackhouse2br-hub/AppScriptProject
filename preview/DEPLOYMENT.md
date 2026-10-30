# Hosting the portal: Railway (app) + GitHub Pages (redirect) + MongoDB Atlas

```
 GitHub Pages ── redirect ──►  https://<service>.up.railway.app   Railway: the whole portal
 (static page, no code,                                            page + API + Google sign-in + all secrets
  no settings, no cookies)                                          ├─► MongoDB Atlas   team, sessions, app records
                                                                    ├─► Monday.com      read-only (+ allowlisted updates if MONDAY_WRITES=on)
                                                                    ├─► respond.io      read-only (+ Upselling sends if RESPOND_SENDS=on)
                                                                    ├─► Google Drive    optional, read-only (Project Pages; service account)
                                                                    └─► Anthropic API   optional (Project Pages: Build from Google Drive)
```

* **Railway** runs the portal: it serves the page and the API from one address, and handles Google sign-in.
* **GitHub Pages** only publishes a redirect page to that address. It has no app code, no settings and no
  secrets, and it is published only after the Railway address answers as this portal (see step 5).

> **Status:** running on Railway as a staging deployment (`NODE_ENV` is not `production`). Every change is tested locally
> against fake Google, Monday, respond.io, Drive and AI servers first. `NODE_ENV=production` is still refused on purpose
> (the production sign-in guard) until the staging run passes "Before production" below.

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
| `NODE_ENV` | see step 6 and "Before production" | `staging` for the test run. `production` starts only when every production condition holds (`src/production.js`): Google sign-in, `HOST=0.0.0.0` with an https `PUBLIC_API_URL`, no local-test variable, a hosted `MONGODB_URI`, both KPI reviewers, `LOI_SIGN_SECRET` when signing is on, and `PRODUCTION_CHECKLIST_ACK`. |
| `PRODUCTION_CHECKLIST_ACK` | for production | exactly `DEPLOYMENT.md-before-production-v1`, set only after every item in "Before production" passed on the staging run. A changed checklist gets a new version, which has to be acknowledged again. |
| `SESSION_HOURS` | optional | sign-in length in hours, 1–720 (default `12`) |
| `MONDAY_TOKEN` | yes 🔒 | Monday API token (read-only use). With `MONDAY_WRITES=on` its user must be a full member (not a viewer or guest) able to edit, on Direct Clients: Budget, Target Move-in Date, Inquiry Type, Nationality; on Listings: Availability; on the Calendar: Status, LOI Creation Date (and the feedback column if set). |
| `MONDAY_LEADS_BOARD_ID` | yes | digits only (Direct Clients board) |
| `MONDAY_LISTINGS_BOARD_ID` | yes | digits only |
| `MONDAY_CALENDAR_BOARD_ID` | yes | digits only |
| `MONDAY_WRITES` | optional | leave **unset** (off): Monday is read-only. `on` enables only the allowlisted, user-confirmed updates in README "Monday updates" (the token then needs write access to those boards). |
| `MONDAY_CALENDAR_FEEDBACK_COLUMN` | optional | the id of one dedicated Calendar-board column of type **text**, with a title no other column has, that also receives a viewing's broker feedback (one line, ≤ 200 characters). Not one the portal already reads; never "Remarks" (duplicated). Unset or unusable: the feedback stays in the portal only (Settings → Integrations → Test Monday connection shows the check). |
| `MONDAY_WRITE_LIMIT` | optional | Monday update attempts per user per minute, 1–60 (default 10; the server as a whole allows 3×). |
| `RESPOND_TOKEN` | optional 🔒 | respond.io API token (read-only use, unless `RESPOND_SENDS=on`); without it the Chat tab says "not connected" |
| `RESPOND_SPACE_ID` | for Message Lead / Call | digits only: the number in your respond.io address (`app.respond.io/space/<number>/…`). The lead drawer's **Message Lead** and **Call on respond.io** open that lead's conversation with it; unset or not a number, they explain what is missing. |
| `RESPOND_LIST_CHECKS` | optional | leave **unset** (off): respond.io is read only when someone opens a lead's Chat tab. `on` checks every visible lead. |
| `KPI_REVIEWER_TOBY_EMAIL` | for KPI Review | Toby's **own** Google account email, exactly as in Team & Access. Only he and Jonjo can open KPI Review. |
| `KPI_REVIEWER_JONJO_EMAIL` | for KPI Review | Jonjo's own Google account email, as in Team & Access. Must differ from Toby's. `blackhouse2br@gmail.com` is refused. |
| `RESPOND_SENDS` | optional | leave **unset** (off). `on` lets Upselling send 1:1 messages and tag contacts through respond.io, each batch reviewed and confirmed by the operator; also supplier requests (Service Requests) and LOI links to a client. `RESPOND_TOKEN` must be allowed to send and tag. |
| `RESPOND_SEND_ONLY_TO` | for the first live test | up to 10 respond.io contact IDs (digits, comma-separated). While set, **every** respond.io send and tag goes only to these contacts (everyone else is left out before anything is recorded), and only a Manager can send. Remove it after the controlled test. |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | optional 🔒 | Project Pages "Add from Drive" / "Build from Google Drive": a service account's JSON key (or base64 of it). See "Google Drive for Project Pages" below. Unset: projects, uploads and pages still work. |
| `ANTHROPIC_API_KEY` | optional 🔒 | lets "Build from Google Drive" fill empty fields from the folder's documents (Claude Opus 5.5; results are reviewed before saving), and Service Requests "Check replies" mark interest per service (Claude Haiku 5.5). Unset: Build only adds the folder's media; Check replies only finds the offers. |
| `GOOGLE_DRIVE_OAUTH` | optional | `on`: LOI signed copies and deal files go to **one Google account's My Drive**, connected by a Manager in Settings → Files (for accounts without Shared drives). See "Google Drive for LOI signing and deal files" below. Not together with `GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON`. |
| `GOOGLE_DRIVE_TOKEN_KEY` | with `GOOGLE_DRIVE_OAUTH=on` 🔒 | 32 random bytes, base64 or hex: encrypts the stored Google refresh token. Changing it means reconnecting. |
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID` / `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` 🔒 | optional | only to use an OAuth client other than the sign-in one (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, used by default) |
| `GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON` | optional 🔒 | the other way: a **second** service account (not the read-only one) that is a Content manager of the folders below, in a **Shared Drive**. Unset (and no `GOOGLE_DRIVE_OAUTH`): those show a setup state. |
| `GOOGLE_DRIVE_LOI_FOLDER_ID` / `GOOGLE_DRIVE_DEALS_FOLDER_ID` | Shared Drive only | the folders' IDs (after `/folders/` in their links): signed LOIs and their PDFs; signed contracts, deposit slips, renewal contracts. Ignored with `GOOGLE_DRIVE_OAUTH=on` (the portal makes its own folders). |
| `LOI_SIGNING` | optional | leave **unset** (off) until the checks under "Before production" pass. `on` lets staff create LOI signing links. |
| `LOI_SIGN_TTL_DAYS` / `LOI_SIGN_SECRET` | optional / with signing 🔒 | days a signing link stays valid (default 14, 1–60); at least 32 random characters so open signing pages survive a restart (required in production when `LOI_SIGNING=on`) |
| `LOI_PDF_CONVERTER` / `GOTENBERG_URL` | optional | `drive` (Google's converter through the writer account, as the Apps Script), `gotenberg` (a LibreOffice service at `GOTENBERG_URL`, https), or `none` (no PDF; the signed copy is a .docx) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` 🔒 `SMTP_FROM` | optional | email for LOI signing links and Upselling "send test to me": port `465` (implicit TLS, the default) or `587` (STARTTLS), AUTH LOGIN. Gmail / Google Workspace: `smtp.gmail.com`, 465, the full address as `SMTP_USER`, a 16-character **App Password** (needs 2-Step Verification) as `SMTP_PASS`, and that address (or a verified alias) in `SMTP_FROM`. Check that your Railway plan allows outbound SMTP. Unset: links are copied instead. |

**Google Drive for Project Pages (optional, read-only).** No callback URL, consent screen or user sign-in is involved:
1. Google Cloud Console → a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **IAM & Admin → Service Accounts → Create** (no roles needed) → **Keys → Add key → JSON**. If key creation is
   blocked, your organization enforces `iam.disableServiceAccountKeyCreation` (default for organizations created since
   May 2024); an Org Policy Admin must allow it for this project.
3. Paste the JSON (or base64 of it) into `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`.
4. In Drive, **share each project folder with the service account's email as Viewer** (for a shared drive, add it as
   a member). The portal reads only what is shared with it (scope `drive.readonly`) and never changes Drive.

**Google Drive for LOI signing and deal files (optional, writes).** A service account has no storage of its own, so
sharing a My Drive folder with one does **not** let it upload (Drive answers "storage quota exceeded"). Two ways:

*A. One Google account's My Drive (no Shared drives needed) — `GOOGLE_DRIVE_OAUTH=on`.* The sign-in OAuth client is reused:
1. Google Cloud Console → the project of the sign-in client → **APIs & Services → Library → Google Drive API → Enable**.
2. **Google Auth Platform → Clients →** the sign-in Web client → **Authorized redirect URIs → add**
   `<PUBLIC_API_URL>/api/drive/oauth/callback` (keep the sign-in URI `…/api/auth/google/callback`).
3. **Data Access → Add or remove scopes →** tick `.../auth/drive.file` ("See, edit, create and delete only the specific
   Google Drive files you use with this app"; a non-sensitive scope, so no Google review is needed for it).
4. **Audience:** if the user type is *External*, the publishing status must be **In production**. While it is
   *Testing*, Google ends the portal's Drive access every 7 days and a Manager would have to reconnect each week.
   (*Internal*, for a Workspace organization, has no such limit.)
5. Railway variables: `GOOGLE_DRIVE_OAUTH=on` and `GOOGLE_DRIVE_TOKEN_KEY` (from
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, pasted straight into Railway). Redeploy.
6. A Manager signs in → **Settings → Files → Connect Google Drive** → chooses the Google account whose My Drive keeps the
   files → allows access. The portal makes `Blackhouse Portal / Signed LOIs` and `Blackhouse Portal / Deal files` there
   and can see nothing else in that Drive. The access renews by itself (Google refresh token, stored encrypted); if
   it is removed in that Google account (or unused for six months: opening Settings → Files renews it once a month), the Files page says so and a Manager reconnects.
   Always reconnect with the **same** Google account and keep the OAuth client in the same Google Cloud project: files the
   portal saved can only be reached through the account and the project that saved them. A failed reconnect never ends
   the working connection.

*B. A Shared Drive (Google Workspace) — `GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON`.* Same steps 1–2 as for Project Pages
for a second service account; create a **Shared Drive**, add the service account as **Content manager**, create the two
folders in it and put their IDs in `GOOGLE_DRIVE_LOI_FOLDER_ID` and `GOOGLE_DRIVE_DEALS_FOLDER_ID`.

Either way the portal never shares files with "anyone with the link": signers open the PDF through their signing link,
staff through the portal.

**Upselling images** are sent to respond.io as links to `<PUBLIC_API_URL>/upsell-media/<random token>`; respond.io
must be able to reach that address (it can on Railway). **Project inquiry form:** set the form endpoint in Project
Pages to the Apps Script public deployment's `/exec` link (the existing path that files Website Inquiries on Monday).

**KPI Review access.** Coaching, feedback, the reviewers' discussion records and the monthly snapshots are private to
the two accounts above. Managers (including the shared Blackhouse account) can't open KPI Review; their other
permissions are unchanged. Each reviewer must also be an active member in Team & Access (any role; give them only the
other modules they need) and must have signed in once with that Google account. Changing a reviewer's email in Team &
Access removes their KPI Review access until they sign in again with the Google account for the new address. Each VA
to be reviewed (Lara included) needs a Team & Access member with the VA role, their Monday VA label and their own Google
email: that member ID is their employee ID, and it's how they acknowledge "We discussed this review" themselves.

**Do not set:**
* `PORT`: Railway sets it.
* `PORTAL_URL`: leave it unset, because Railway serves the page itself. It's only for a page hosted on another domain you own.
* `MONDAY_API_URL`, `RESPOND_API_URL`, `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_JWKS_URL`, `GOOGLE_REVOKE_URL`: these are for local test servers only. The server refuses them unless they point to 127.0.0.1.
* `GOOGLE_DRIVE_API_URL`, `GOOGLE_DRIVE_TOKEN_URL`, `GOOGLE_DRIVE_UPLOAD_URL`, `ANTHROPIC_BASE_URL`, `GOTENBERG_TEST_URL`, `SMTP_SECURE` (any value): local tests only; a server others can reach refuses to start with them.

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
   *"Production start refused: …"*, naming the first production condition not met (at the end, `PRODUCTION_CHECKLIST_ACK`).
   It means every other setting passed.
3. Set `NODE_ENV=staging`. Railway redeploys; `<PUBLIC_API_URL>/healthz` must show
   `{"ok":true,"app":"blackhouse-leads-portal","mode":"mongo","db":"connected","auth":"google"}`.
4. Run the GitHub Pages workflow.

The staging run is a real, public address showing real Monday data, but only to team members who sign in with Google.

## Before production

Production (`NODE_ENV=production`) is refused (`src/production.js`) until all of these pass on the staging run and the owner sets `PRODUCTION_CHECKLIST_ACK=DEPLOYMENT.md-before-production-v1`:

- [ ] `<PUBLIC_API_URL>/healthz` shows `"db":"connected"` and `"auth":"google"`.
- [ ] A listed Manager, VA and Broker can each sign in with Google, in Chrome, Safari and a phone browser, and see only
      what their role allows.
- [ ] An unlisted Google account is refused with "That Google account isn't on the team".
- [ ] Removing a member signs them out on their next action.
- [ ] Monday leads, listings and calendar load; nothing is written to Monday.
- [ ] The GitHub Pages address forwards to the Railway address.
- [ ] KPI Review: Toby and Jonjo (signed in again with Google) open it; the Blackhouse account and other members don't.
- [ ] Upselling: with `RESPOND_SENDS` unset nothing can be sent; before turning it on, Team & Access `upsell: edit` grants are
      reviewed and one small batch to a test contact is sent and checked in respond.io.
- [ ] Project Pages: a test project's brochure downloads and photos show on its published page, then it is unpublished.
- [ ] Upselling history: the Apps Script's Script Properties are exported and `scripts/import-legacy-upsell.js` is run
      (dry run first, then `--apply`), so its opt-outs (`upo_*`) and recent offers (`up_*`) are honoured.
- [ ] LOI signing (before `LOI_SIGNING=on`): a test LOI is sent to a staff member's own email, signed on a phone, and
      the signed .docx / PDF open correctly in Word and appear in the LOI folder and the deal's files.
- [ ] Service Requests: suppliers entered by a Manager; with `ANTHROPIC_API_KEY`, "Check replies" on a test client
      marks interest correctly and keeps no client name or number in the request text.

- [ ] Railway runs **one** replica (sign-in throttles, the Monday cache and rate limits are kept in the server's memory).
- [ ] Atlas: the cluster tier has backups (M0 has none) and a restore was tried; the database user has only the
      readWrite role on the portal's database.
- [ ] `KPI_REVIEWER_TOBY_EMAIL`, `KPI_REVIEWER_JONJO_EMAIL` and, if signing is on, `LOI_SIGN_SECRET` are set.

Then set `PRODUCTION_CHECKLIST_ACK=DEPLOYMENT.md-before-production-v1` and `NODE_ENV=production`. The server checks every
condition again at each start and refuses, naming the variable, if one is missing (never its value). Nothing about
sign-in, Team & Access or KPI Review privacy changes in production.
