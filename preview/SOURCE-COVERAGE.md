# Source coverage: Monday.com and respond.io (read-only phase)

What the original Apps Script portal (`src/Code.gs` in `../blackhouse-leads-portal.zip`) reads or writes, and where
each feature stands in this preview. Everything here is **read-only**, except the allowlisted Monday updates (README "Monday updates", off unless `MONDAY_WRITES=on`). All of it has been checked **only against the
local fake API** in `test/fixtures/fake-integrations.js` (fictional records); nothing has been run against real accounts.

Legend: ✅ done (fake data) · 🔑 needs real account details to verify · ⏳ later phase · ⛔ not possible without another system

## Implemented in this phase

| Feature | Original (`Code.gs`) | Preview | Verify with real data 🔑 |
|---|---|---|---|
| AI Status | `computePipeline_`, `aiStatus_`, `aiStatusOne_` | ✅ `src/integrations/pipeline.js`: Calendar proof (Failed by hand, signed contract, Total Paid, Contract Date, LOI with the 5-day owner rule) → Monday **AI STATUS** column (the value the live portal writes back) → rules on Next Action / Status text. "Not on Respond.io" without a Respond ID. Source shown in the UI (proof / Monday / inferred, dotted) | That the AI STATUS and "AI Status Detail" columns exist with these titles; that labels match the 9 stage names |
| Temperature | `temperature_` | ✅ same thresholds (Hot / Warm / Cold / Lost / Dead / Active / Not on Respond.io) | Thresholds against a few known chats |
| Needs VA Reply / Waiting on Client | `apiGetReplyStates` | ✅ last 15 messages per contact; only human replies (user, phone app, portal API) count, not AI agent / workflow / broadcast. Max 60 chats per call, cached 10 min–2 h by activity, the page asks again while chats are pending | respond.io `sender.source` values on real messages; rate limits with ~2,000 leads |
| Days in Stage | `stageSegments_`, `leadStart_` | ✅ milestones: Date of Inquiry / created → first Calendar item → LOI dates → Contract Date → signed contract → Total Paid; LOI and unsigned contract roll back to matching after 5 days | Column titles on the Calendar board (Date LOI Submitted, LOI Creation Date, LOI, Contract, Signed Contract, Total Paid) |
| VA labels for Team & Access | `setupUsersSheet` / `statusOptions_` (VA Assigned labels) | ✅ read from the VA Assigned column's labels (+ values in use); Salesperson labels for brokers; Team & Access shows "Monday match" per member and only accepts real labels | Label spelling on the live board |
| Access rules on Monday data | `visibleItems_` | ✅ VA → own VA label; Broker → Salesperson name or a Calendar viewing; Manager → all; same for chat, notes, reply states, photos | Broker names vs Salesperson labels |
| Listing photos | `shapeListing_` (Photos column + image assets, `public_url` expires ~1 h) | ✅ asset IDs only in the browser; the server proxies `/api/monday/photo/<id>` (links refreshed after 40 min with a read query, JPEG/PNG/GIF/WebP ≤ 10 MB, no Monday token sent to the file host, SVG refused) | Real asset hosts and redirects; photo sizes; Monday API rate on big listing boards |

## Not implemented yet

| Feature | Original | Status | What's needed |
|---|---|---|---|
| AI chat reading (stage guesses, AI-dated milestones) | `stageTimelineJob` (Anthropic API, Drive timeline file) | ⏳ | `ANTHROPIC_API_KEY`, a scheduled job with durable state, and the Drive timeline file exported. Until then the Monday AI STATUS column stands in |
| Portal viewings / LOIs / human stage checks / LOI confidence | Script Properties `vw_`, `hv_`, `lc_`, `sent_`, `chk_` | ⛔ | Export of Script Properties from the live project (🔑), then import into MongoDB |
| Website Inquiries board (`2001153181`) | `importWebInquiries_`, `webInquiries_` ("Looking For" links, import every 15 min) | ⏳ | Read-only listing is straightforward; the import **writes** to Direct Clients and respond.io, so it waits for the write phase |
| Older lead boards (`5031658775`, "2026 Clients") | `CONFIG.OTHER_LEAD_BOARDS` (extra "Looking For" source) | ⏳ | Board ID in `.env` and a title-matching pass like the Leads board 🔑 |
| Direct Clients subitems (`2051164648`) | VA Offer / Client Inquiry, Owner, Listing Status, View? (units per client, sourcing KPIs) | ⏳ | Read via `items { subitems { … } }`; columns by title. Sync **writes** stay off |
| Reply-state checks for MongoDB leads | — | ⏳ | Only Monday leads are checked (MongoDB demo leads have fictional Respond IDs) |
| respond.io contact lookup by phone/email, contact list | `/contact/phone:`, `/contact/email:`, `POST /contact/list` | ⏳ | Read-only but used to fill Respond IDs; `POST /contact/list` needs an allowlist exception |
| Translation (Google LanguageApp) | auto-translate in chats | ⏳ | A translation service decision |
| Inventory Dashboard extras, Leads Report KPIs, Broker Management, P&L, Data Check | many Monday reads (Calendar commissions, creation logs) | ⏳ | Column-by-column mapping from `docs/data-points.xlsx`, sheet "Monday columns used" |
| All other writes | AI STATUS write-back, subitems, Client Status/Fail, VA Assigned, Pets, viewings/calendar items, new listings, respond.io messages/templates/contacts, webhooks | ⛔ in this phase | Explicit go-ahead per write, idempotency and audit (see the root migration plan) |

## How to check with real accounts later 🔑

1. Put the tokens and board IDs in `preview/.env` (never commit it). Use a test workspace or a copy of the boards if possible.
2. `npm start`, sign in as a Manager, **Settings → Integrations → Test Monday connection**: every board should show ✓ with its name.
3. **Settings → Team & Access**: every VA should show "✓ on board" and every broker "✓ Salesperson".
4. Switch **Data source → Monday.com**, compare 10 leads against the live portal: AI Status (hover for its source), Temperature, Needs VA Reply / Waiting on Client, Days in Stage. Expect differences where the live portal used portal-only data (viewings, human checks, AI timeline).
5. Open a few listings with photos, and a few chats.
