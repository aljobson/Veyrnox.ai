# Mobile gap analysis: web product vs the Expo app (2026-10-17)

Read-only analysis. Nothing in the repo was changed except this file.

**Compared**
- Mobile worktree: `.claude/worktrees/veyrnox-mobile-app-f52c2f`, HEAD `bccd2868` (pre-squash copy of PR #1201).
- `origin/main` is `ccec464d`, 3 commits ahead of the worktree. `git diff HEAD origin/main -- apps/mobile` is empty, so the Expo app is identical on both. The 3 commits are the squash of #1201 (the same mobile change), #1199 (Oddlings catalog builder, client-side, no API) and #1200 (templates gallery in ten languages, ADR-0107). None touches `app/api/**`, so the route inventory below holds for both.
- Source of truth for intent: `docs/adr/0106-mobile-app.md`, `0108-mobile-store-billing.md`, `0109-mobile-publish-plan-and-store-catalog.md`.

## 0. Headline

- The web exposes **166** `app/api/v1/**/route.js` files: 19 admin (Cloudflare Access, out of scope), 3 non-product (`[[...path]]` 404 catch-all, `developer/[[...path]]`, `mcp`) and **144 product routes**. The app calls **11** of them (about 8%), plus the anonymous `GET /api/catalog` and Supabase Auth directly.
- The app is slices M0 to M3 of ADR-0106: sign-in (Apple, Google, email with hidden Turnstile), balance, chat with Vey, prompt-only generation, job status, a jobs-based library, store billing (credit packs and the Publish Plan paywall via RevenueCat). Everything from "M4+" is untouched: editor, Cinema, Publish management, projects, account.
- `/api/v1/*` is genuinely native-friendly. Middleware (`middleware.js`) needs only `Authorization: Bearer <Supabase ES256 JWT>`. There is no cookie, no Turnstile and no Origin requirement on `/api/v1`. Where an Origin check exists (`packages/security/context.js#checkOrigin`) a missing header is allowed and only a present, wrong one is refused, with the comment "native clients may omit Origin". React Native fetch sends no Origin, so CORS is irrelevant on native.
- The server does need changes for mobile. The blocking ones are: no account-deletion route (App Store rule), no push-token storage or sender, no universal-link or app-link files, Stripe-only checkout for Cinema and Publish, and Publish OAuth redirects that land on web pages. Section 3.2 has the full list.

## 1. API routes: web vs mobile

Legend for "Mobile": **Yes** = called by `apps/mobile/src/lib/*.ts` (or a provider that uses them); **No** = not called; **N/A** = not for a native client.

Mobile call sites (all from `apps/mobile/src`):
- `lib/api.ts` (`/api/v1/balance`)
- `lib/chat.ts` (chat models, threads, thread by id, messages)
- `lib/media.ts` (generations, jobs, job, job asset, plus `/api/catalog` outside v1)
- `lib/publishPlan.ts` (`/api/v1/social/plan`)
- `billing/BillingProvider.tsx` (`/api/v1/store-purchases/customer`)

### 1.1 Core, money and identity

| Route | Methods | Mobile | Notes |
|---|---|---|---|
| balance | GET | Yes | `lib/api.ts` getBalance; home and credits screens |
| session/me | GET | No | Not needed yet; the JWT already carries identity |
| account | GET | No | email, credits, asset count (flag `VEY_ACCOUNT_ENABLED`) |
| ledger | GET | No | Credit history; web credits page |
| ledger/usage | GET | No | |
| free-allowance | GET | No | `FREE_ALLOWANCE_ENABLED`; returns `{enabled:false}` when off |
| credit-packs | GET | No | Stripe packs; app uses RevenueCat packs instead |
| top-ups | GET, POST | N/A | Stripe Checkout. Cannot be used in the app (ADR-0108) |
| top-ups/[id] | GET | N/A | Stripe |
| top-ups/[id]/return | POST | N/A | Stripe |
| store-purchases/customer | GET | Yes | RevenueCat `logIn` customer id. Off (404) until `STORE_BILLING_ENABLED` |
| subscriptions | GET | No | Credit subscriptions; `SUBSCRIPTIONS_ENABLED=false` in production |
| subscriptions/plans | GET | No | |
| subscriptions/checkout | POST | N/A | Stripe |
| subscriptions/cancel | POST | N/A | Stripe |
| subscriptions/return | POST | N/A | Stripe |
| referrals | GET | No | `REFERRALS_ENABLED` |
| referrals/attach | POST | No | Web captures `?ref=` (`app/veyrnox/_lib/referralCapture.js`) |
| appeals | GET, POST | No | Content-strike appeals |
| reports | POST | No | In-app report; also needed for store UGC rules |
| help | POST | No | |
| health | GET | No | |
| mcp | GET, POST, DELETE | N/A | MCP clients |
| developer/[[...path]] | GET, POST, OPTIONS | N/A | Developer API (OAuth client claim, wildcard CORS) |
| [[...path]] | all | N/A | Typed 404 catch-all |

### 1.2 Create, jobs, library, uploads

| Route | Methods | Mobile | Notes |
|---|---|---|---|
| generations | POST | Yes | Prompt-only models; idempotency key and `confirmed_credits` sent |
| jobs | GET | Yes | Cursor `before` and `before_id`; the library list |
| jobs/[id] | GET | Yes | 3 s polling, 10 min cap (`waitForJob`) |
| jobs/[id]/asset | GET | Yes | 15-minute signed URL; never stored |
| jobs/[id]/provenance | GET | No | |
| uploads | POST | No | Presigned R2 PUT for source media (`UPLOAD_INTEGRITY_ENABLED`) |
| library/masters | GET, POST | No | Film masters (`FILM_LIBRARY_MASTERS_ENABLED`, `FILM_LIBRARY_SAVE_ENABLED`) |
| library/masters/upload | POST | No | Presigned PUT begin |
| library/masters/[id]/asset | GET | No | |
| library/editor-renders | GET, POST, DELETE | No | `EDITOR_LIBRARY_EXPORTS_ENABLED` (staging only in `wrangler.jsonc`) |
| library/editor-renders/[id]/asset | GET | No | |
| library/editor-renders/[id]/inspect | POST | No | |
| montage/plan | POST | No | Auto Short plan and price; then `generations` with model `video-agent` |
| (non-v1) GET /api/catalog | GET | Yes | Anonymous model catalog; `fetchCatalog` filters to prompt-only, ungated models |

### 1.3 Chat

| Route | Methods | Mobile | Notes |
|---|---|---|---|
| chat/models | GET | Yes | |
| chat/threads | GET, POST | Yes | list and create |
| chat/threads/[id] | GET, PATCH, DELETE | Partial | GET and DELETE used; PATCH (rename, pin) not |
| chat/threads/[id]/messages | POST | Yes | SSE. Needs a streaming fetch; `api.ts` takes an injected `streamFetch` |
| chat/sends/close | POST | No | `CHAT_SEND_CLOSE_ENABLED`; web calls it when a send is stopped |
| chat/folders, chat/folders/[id] | GET, POST; PATCH, DELETE | No | |
| chat/personas, chat/personas/[id] | GET, POST; PATCH, DELETE | No | `PERSONAS_ENABLED` |

### 1.4 Projects and workspaces (editor storage)

| Route | Methods | Mobile |
|---|---|---|
| workspaces | GET | No |
| workspaces/[id]/brand-assets | GET | No |
| workspaces/[id]/brand-kit | GET, PUT | No |
| projects | GET, POST | No |
| projects/[id] | GET, PATCH, DELETE | No |
| projects/[id]/document | GET, PUT | No |
| projects/[id]/history | GET | No |
| projects/[id]/review | GET, PATCH, POST | No |
| projects/[id]/assets | POST | No |
| projects/[id]/assets/[assetId]/download | GET | No |
| projects/[id]/assets/[assetId]/inspect | POST | No |

All gated by `TENANT_PROJECTS_ENABLED` (on in production); asset upload by `PROJECT_MEDIA_UPLOADS_ENABLED` (**off in production**, on in staging).

### 1.5 Cinema (viewer, creator)

All No. Flags: `CINEMA_ENABLED`, `CINEMA_VIEWING_ENABLED`, `CINEMA_PUBLISHING_ENABLED`, `CREATOR_*`, `CINEMA_FREE_CEILING_ENABLED` on in production; `CINEMA_SUBSCRIPTIONS_ENABLED` and `CINEMA_UNLOCKS_ENABLED` **off in production**, on in staging.

| Route | Methods | Notes |
|---|---|---|
| cinema/titles/[id] | GET | Authed title detail (anonymous list is `/api/cinema/titles`) |
| cinema/posters/[id] | GET | Authed poster |
| cinema/entitlement | GET | Viewer entitlement for a content id |
| cinema/play | POST | Mints a signed Cloudflare Stream token (15 min) |
| cinema/play/heartbeat | POST | Playback metering |
| cinema/unlocks | POST | Pay-per-title unlock (credits) |
| cinema/pass, pass/plans, pass/cancel, pass/portal, pass/return | GET/POST | Cinema Pass; Stripe checkout and portal |
| cinema/votes, voting | POST; GET | |
| cinema/comments | GET, POST | |
| cinema/story-polls, story-choices | GET; POST | |
| cinema/audience, retention | POST; GET, POST | |
| cinema/content, content/submit, content/withdraw | GET, POST, PATCH | Creator content |
| cinema/uploads, uploads/[id]/transfer, uploads/from-library, uploads/refresh, uploads/remove | GET, POST, PATCH | Creator upload (`CREATOR_UPLOADS_ENABLED`) |
| cinema/creator-analytics | GET | |
| creators/apply | GET, POST | |
| social-cinema/profile | GET, POST | `SOCIAL_CINEMA_PROFILES_ENABLED` |

### 1.6 Publish / social (`social/*`)

Only `social/plan` GET is called (Yes, tier check before the paywall). Everything else No. Gate: `PUBLISH_ENABLED` plus per-user `publishAllowed` (`social/access`). In production `PUBLISH_RELEASED_NETWORKS` is `youtube,linkedin,twitter,tiktok`; `PUBLISH_UPLOADS_ENABLED` and `PUBLISH_EXTENDED_NETWORKS_ENABLED` are off (staging has them on).

| Route | Methods |
|---|---|
| social/access | GET |
| social/plan | GET (Yes), POST |
| social/plan/cancel, portal, return | POST (Stripe) |
| social/accounts | GET |
| social/accounts/[accountId] | DELETE |
| social/accounts/{youtube,linkedin,twitter,tiktok,facebook,instagram,threads,pinterest,twitch,gmb}/connect and /callback | POST each (20 files) |
| social/accounts/bluesky/connect | POST |
| social/brands | GET |
| social/posts, posts/[id], posts/[id]/schedule | GET, POST; PATCH; PATCH |
| social/drafts | GET, POST |
| social/uploads | GET, POST, DELETE (presigned PUT) |
| social/calendar, best-time, analytics, activity | GET |
| social/queues, queues/reserve | GET, PUT, DELETE; POST, PATCH |
| social/autolists, presets, workflows, ads, commerce/products | GET, PUT, DELETE |
| social/smartlink | GET, PUT |
| social/reports, reports/[id]/export | GET, PUT, DELETE; GET |
| social/inbox, inbox/analytics, inbox/[threadId], /reply, /suggestions | GET, POST, PATCH |
| social/contacts | GET, POST, PATCH |
| social/approvals | GET, POST |
| social/team, team/accept | GET, POST, PATCH, DELETE; POST |
| social/developer/keys, logs, webhooks | GET, POST, DELETE |

### 1.7 Admin (excluded)

19 routes under `admin/*` (appeals, cinema/*, metrics, reports, security, users/*, violations, webhooks). They also require Cloudflare Access in code (CLAUDE.md "API gateway"), so they are not for a native client.

### 1.8 Routes the app calls that have no web counterpart under `/api/v1`

- `GET {apiBase}/api/catalog` (outside the gate, anonymous, cached).
- Supabase Auth: `/auth/v1/token` (password, pkce, id_token, refresh_token), `/auth/v1/signup`, `/auth/v1/authorize`, `/auth/v1/logout` (`lib/auth/supabaseAuth.ts`).
- RevenueCat SDK talks to RevenueCat directly; the server learns of purchases via `POST /api/webhook/revenuecat`.

## 2. Web product surfaces vs mobile coverage

Surfaces come from `app/veyrnox/**` (the signed-in app lives in `app/veyrnox/app/**`). Admin pages excluded.

| Surface (web path) | Mobile | What the app has today (`apps/mobile/src/app`) | Main gap |
|---|---|---|---|
| Studio / Create (`app/create`) | **Partial** | `create/index.tsx`, `create/[modelId].tsx`: prompt-only image, video, audio models from `/api/catalog`, price estimate, duration, idempotent submit | No source-media models (image-to-video, transform, reference images), no model options, no negative prompts, no free-allowance, gated models hidden |
| Enhance (`app/enhance`, on-device MediaPipe) | None | | Browser/WASM pipeline |
| Library (`app/library`) | **Partial** | `library.tsx` lists `/jobs`; `job/[id].tsx` shows the image or opens video/audio in the system browser | No in-app video/audio player, no save to Photos, no share, no film masters or editor renders, no provenance, no pagination cache |
| Chat (`app/chat`) | **Partial** | `chat/index.tsx`, `new.tsx`, `[id].tsx`: models, threads, SSE replies, delete thread | No personas, folders, rename/pin, images, research, stop or `sends/close`, markdown rendering, free allowance |
| Editor / timeline (`app/editor`, `editor/review`) | None | | Client engine in `app/veyrnox/_lib/editor*.mjs` and `_components/editor/*` (browser media decode and encode: `editorExport.mjs`, `editorSafariEncoder.mjs`) |
| Film Studio (`app/film-studio`) | None | | `_components/film/FilmWorkspace.js`: seven-stage planning plus `generations`, `library/masters`, `projects` |
| Auto Short (`app/video-agent`) | None | | brief, `montage/plan`, approve, one priced `generations` job (model `video-agent`) |
| Cinema viewer (`social-cinema`, `title/[id]`, `watch/[id]`, `series/[slug]`, `pass`) | None | | Cloudflare Stream playback, entitlement, votes, comments, polls |
| Cinema creator (`social-cinema/creator`) | None | | Apply, content, uploads, analytics |
| Publish / social (`app/publish/*`: home, plan, queues, calendar, analytics, inbox, contacts, team, ads, autolists, commerce, smartlink, reports, workflows, developer, activity) | **Partial (paywall only)** | `publish.tsx`: benefits, server tier check, RevenueCat weekly/monthly/annual purchase, restore, renewal terms | No account connect, composer, schedule, calendar, analytics, inbox |
| Projects (`app/projects`, `projects/[id]`) | None | | Workspaces, document, history, review |
| Credits (`app/credits`) | **Partial** | `credits.tsx`: RevenueCat consumable packs, balance poll after purchase; home shows balance and free credits | No ledger or usage, no top-up history, no subscriptions, no free-allowance meter |
| Account (`app/account`, `account/appeals`, `account/report`) | None | Sign-out button only (`(app)/index.tsx`) | No profile, appeals, report content, delete account, privacy export |
| Referrals (`_components/ReferralPanel.js`, `ReferralBridge.js`) | None | | `referrals` GET, `referrals/attach` POST, `?ref=` capture |
| Presets / templates (`presets`, `presets/[id]`) | None | | Public; `/api/popular-templates` plus static data |
| Oddlings (`oddlings`, `oddlings/[id]`, `app/oddlings`) | None | | Public gallery; client-side doll lab and catalog builder (origin/main #1199) |
| Models / pricing / guides / about / tools / developers / mcp / design-system / oauth consent | None | | Marketing and developer pages; link out or skip. `oauth/consent` is a web page for MCP clients |
| `/m/*` (`create`, `credits`, `explore`, `job`, `library`) | N/A | | A web **design prototype** with sample data (`app/veyrnox/m/layout.js`); useful as a UI reference only |
| Auth (sign-in) | **Done** | Apple native on iOS, Google and Apple-on-Android via PKCE system browser, email with hidden Turnstile (`sign-in.tsx`, `email.tsx`, `auth/*`) | Turnstile on a real device is unverified (ADR-0106 point 3) |

## 3. Uncovered surfaces: what each needs

### 3.1 Cross-cutting facts that hold for every `/api/v1` call

- **Bearer only.** `middleware.js` verifies the Supabase JWT (ES256, JWKS, issuer, audience `authenticated`) and overwrites `x-veyrnox-auth-*`. The app's `createApiClient` (`lib/api.ts`) already does token refresh, one retry on 401, and `onSessionLost`.
- **No CORS, cookie or Turnstile dependency.** Turnstile is enforced by Supabase on email auth only (ADR-0026). `/api/v1` has none. The cookie BFF (`/api/auth/session`, ADR-0102) is not used by the app.
- **Publish brand header.** Web sends `x-publish-brand-id` when a team brand is selected (`app/veyrnox/_lib/gateway.js`, read in `lib/social/resolveBrand.js`). The mobile client has no equivalent yet; needed for any `social/*` team feature.
- **Uploads.** `POST /api/v1/uploads` returns `{key, upload_url, content_type, headers?, max_bytes, expires_in}`. The Content-Type is inside the signature, so the native PUT must send exactly `content_type` and any returned `headers`. The bytes go straight to R2; CSP and browser CORS do not apply on native. Same pattern for `library/masters/upload` (`ticket`, `upload_url`, `headers`), `library/editor-renders` (`upload_url`, `headers`) and `social/uploads`. Pending-upload cap is 10 per user (`MAX_PENDING_UPLOADS`). Cinema creator video goes to Cloudflare Stream upload origins (`upload.cloudflarestream.com`, `upload.videodelivery.net`); `cinema/uploads` returns an `upload` projection and the flags `proxy_uploads_enabled` and `library_uploads_enabled`, so check the exact shape before building (a tus or direct-upload client will be needed on native).
- **Rate limits.** `lib/apiEdgeRateLimit.js` limits at the edge per connecting address, and several routes have per-user limits (`UPLOAD_REQUEST_RATE_LIMIT_ENABLED`, `ACCOUNT_READ_RATE_LIMIT_ENABLED`, 10 generations per 60 s). Mobile carrier networks share addresses, so watch for 429 in beta; the app should surface `Retry-After` (web `GatewayError.retryAfter` does; `ApiError` in mobile does not parse it).
- **Production binding cap.** Production Worker vars are at the Cloudflare text-binding limit (`wrangler.jsonc` comments say 125 of 128, and `tests/workerBindingBudget.test.mjs`). Any new server flag for mobile (push, app links) needs a slot freed or consolidation first. Absent means off.

### 3.2 Server changes that mobile forces (consolidated)

| # | Change | Why | Evidence it is missing | Blocking? |
|---|---|---|---|---|
| S1 | **Account deletion route** (`DELETE /api/v1/account` or a deletion-request route) plus in-app entry | Apple requires in-app account deletion; Google Play requires a deletion path | `app/api/v1/account/route.js` exports GET only. Web handles erasure by email request (`app/legal/gdpr/page.js`) | **Yes, for store review** |
| S2 | **Push notifications**: device-token table (migration), `POST/DELETE /api/v1/devices`, a sender (Expo push service or APNs/FCM) and triggers (job finished, refund, Cinema, Publish post result) | Generations take minutes; polling needs the app open | No `push_token`, `device_token`, APNs or FCM anywhere under `lib`, `app`, `packages`, `docs`, `workers`, `services`; app has no `expo-notifications` | No for a first build; strongly needed for video |
| S3 | **Universal links and app links**: serve `/.well-known/apple-app-site-association` (JSON, no redirect, `application/json`) and `/.well-known/assetlinks.json`; add `associatedDomains` and Android `intentFilters` in `app.json` | Email confirmation, referral links (`?ref=`), shared Cinema titles, team invites (`/social/team/invite`), approval links (`/social/review/[token]`), Publish OAuth return | `public/.well-known/` holds only `security.txt`; no `apple-app-site-association` or `assetlinks` string anywhere. Existing precedent for dynamic well-known is a route handler (`app/.well-known/oauth-protected-resource/**/route.js`). Middleware wraps non-API paths with CSP and `no-store`, and `CANONICAL_HOST` handling must not redirect these files | No for M-slices, yes for Publish connect and sharing |
| S4 | **Publish OAuth for native**: every connect route builds `redirectUri` as an HTTPS web path (`/social/connect/callback/<network>`) and `callback` is "called by a client page" with the PKCE verifier from `sessionStorage` (`app/api/v1/social/accounts/youtube/connect/route.js`). Native needs either (a) app links claiming `/social/connect/callback/*` and then POSTing `code`, `state`, `codeVerifier` with its own Bearer, or (b) an optional mobile return target honoured by `connect`. Option (a) needs S3 only; (b) needs a route change and an allowlist | Without it the provider redirect lands in a browser with no session | Same file; `CALLBACK_PATH` constant | Yes for Publish connect |
| S5 | **Store billing for Cinema and any subscription or unlock sold in the app**: Cinema Pass (`cinema/pass*`), unlocks (`cinema/unlocks`), credit subscriptions (`subscriptions/*`) use Stripe. ADR-0108 covers credit packs only, ADR-0109 the Publish Plan only | App Store 3.1.1: digital goods consumed in the app need IAP | Stripe checkout in those handlers; `social_publish_store_products` and 0344/0346 cover packs and Publish only | Yes before Cinema paid content ships on iOS |
| S6 | **Flip `STORE_BILLING_ENABLED` in production** | App purchases are not credited otherwise | `wrangler.jsonc` line ~207: deliberately unset in production (cap); staging sets it. Also needs migrations 0344 and 0346 applied, `REVENUECAT_WEBHOOK_SECRET`, and the iOS and Android products (ADR-0109 says only Test Store products exist) | Yes before store launch |
| S7 | **Cinema playback for native**: `cinema/play` returns `{token, expires_at, customer_code, content_id, watch_session_id?}`. The web builds `https://customer-<code>.cloudflarestream.com/<token>/iframe` and meters through the Stream embed SDK (`app/veyrnox/social-cinema/watch/[id]/Player.js`, `lib/cinema/playbackMeter.js`, `watchCoverage.js`). For a native player, Stream also serves HLS at `.../<token>/manifest/video.m3u8` (Cloudflare Stream convention; **not used anywhere in the repo**, verify it works with the signed-token setup). Heartbeats are currently driven by embed media events, so a native player must replay that contract against `cinema/play/heartbeat` | HLS in `expo-video`, or iframe in a WebView (works today, loses native casting) | `lib/cinema/stream.js`, `lib/cinema/unlockApi.js` | No server change if the WebView route is chosen; a documented HLS URL and heartbeat contract if native |
| S8 | **Feed endpoints**: Cinema browse uses anonymous `/api/cinema/titles`, `/discovery`, `/voting`, `/winners`, `/comments`, `/story-polls` (CLAUDE.md "Routes outside the gate"). These are plain JSON and usable from native as is. There is no authenticated "for you" or mobile-shaped feed, no pagination contract documented for mobile, and posters come from `/api/cinema/posters/:id` | Needed for a Cinema tab | `app/api/cinema/*` | No |
| S9 | **Download and save**: `jobs/[id]/asset` gives a 15-minute signed URL. Saving to the camera roll needs a client download (`expo-file-system`) and `expo-media-library`; no server change. Watch the asset-link rate limit (`ASSET_LINK_RATE_LIMIT_ENABLED`) if a grid fetches many links | | `lib/media.ts` | No |
| S10 | **Moderation obligations from the ADR**: in-app report (`reports` POST exists), block or mute users, and the content filter story (App Store 1.2, Google AI-generated content policy). Report and appeal routes exist; block does not | | ADR-0108 "Risks" | Yes for review if Cinema comments ship |
| S11 | **Build and release identity**: AASA needs the Apple Team ID; assetlinks needs the signing certificate SHA-256 (Play App Signing key). Owner prerequisites in ADR-0106 (Supabase redirect allowlist, Apple client ID) are still open per the ADR | | ADR-0106 | Yes |
| S12 | **Analytics and crash ingest**: web proxies PostHog through `/ingest` (`middleware.js`, `lib/analyticsClient.js`). Native can call PostHog directly or via the same proxy; privacy rules in `lib/analyticsPrivacy.js` must be mirrored | | | No |

### 3.3 Per surface

**Studio / Create (finish: partial to done)**
- Routes: `generations`, `jobs*`, `balance`, `uploads` (new), `free-allowance` (new), `/api/catalog` (richer filter). `montage/plan` for Auto Short.
- Bearer-only: yes. Upload: presigned R2 PUT with `expo-image-picker` (or `expo-document-picker`) and `expo-file-system` upload; `UPLOAD_INTEGRITY_ENABLED` is on in production, so send `size_bytes`.
- Flags: `FREE_ALLOWANCE_ENABLED` (on), `UPLOAD_INTEGRITY_ENABLED` (on), `UPLOAD_REQUEST_RATE_LIMIT_ENABLED` (on), `CONTENT_SCAN_ENABLED` (off in production).
- Server change: none. Client work: catalog capability parser (`isPromptOnly` currently drops every model with a required media slot), per-model options.

**Library**
- Routes: `jobs`, `jobs/[id]/asset` (have), plus `library/masters*`, `library/editor-renders*`, `jobs/[id]/provenance`.
- Bearer-only: yes. Flags: `FILM_LIBRARY_MASTERS_ENABLED`, `FILM_LIBRARY_SAVE_ENABLED` (on); `EDITOR_LIBRARY_EXPORTS_ENABLED` (staging only).
- Server change: none. Client: `expo-video` or `expo-audio` for playback, Photos save.

**Chat**
- Routes: add `chat/threads/[id]` PATCH, `chat/folders*`, `chat/personas*`, `chat/sends/close`, `free-allowance`.
- Streaming: SSE is handled with an injected `streamFetch` (`api.ts`); confirm the injected implementation works on Hermes (React Native's own fetch cannot stream a body, per the comment in `api.ts`). `CHAT_ENABLED`, `PERSONAS_ENABLED`, `CHAT_SEND_CLOSE_ENABLED` are on in production.
- Server change: none.

**Editor / timeline, Film Studio, Auto Short**
- Editor: routes `projects*`, `workspaces*`, `uploads`, `library/editor-renders*`, `jobs*`. Flags `EDITOR_TIMELINE_ENABLED`, `EDITOR_MULTITRACK_ENABLED`, `EDITOR_SHARED_TOOLS_ENABLED`, `TENANT_PROJECTS_ENABLED` (on); `PROJECT_MEDIA_UPLOADS_ENABLED` and `EDITOR_LIBRARY_EXPORTS_ENABLED` are **not on in production**. The render is a browser-side pipeline, so there is no server render to call. Recommendation: do not port in M4. Offer read-only project list and a "continue on web" handoff, or a WebView only after a feasibility spike. No server change for read-only.
- Film Studio: planning is client-side; the server surface is `generations`, `library/masters/upload` (begin then PUT then finish), `projects`, `free-allowance`. Reasonable native port as forms plus a shot list; Bearer-only; presigned PUT.
- Auto Short: `montage/plan` then `generations` (model `video-agent`), then `jobs`. Flags `AGENT_VIDEO_ENABLED`, `MONTAGE_LIVENESS_ENABLED` (on), `MONTAGE_RUNNER_BASE`. Cheapest uncovered feature to add (about two screens): needs only the already-built job screen plus push (S2) for the 2 to 10 minute wait (`docs/auto-short/SPEC.md`).

**Cinema viewer and creator**
- Viewer routes: `/api/cinema/titles|discovery|winners|voting|comments|story-polls` (anonymous), `cinema/titles/[id]`, `cinema/entitlement`, `cinema/play`, `cinema/play/heartbeat`, `cinema/votes`, `cinema/comments`, `cinema/story-*`, `cinema/audience`, `cinema/unlocks`, `cinema/pass*`.
- All Bearer-only. Playback: see S7. Paid access: see S5 (production has subscriptions and unlocks off, so a free-only viewer is shippable first via `CINEMA_FREE_CEILING_ENABLED`).
- Creator: `creators/apply`, `cinema/content*`, `cinema/uploads*`, `cinema/creator-analytics`, `social-cinema/profile`. Upload is a Cloudflare Stream direct upload (not R2); needs a native tus or multipart client and background upload. Flags `CREATOR_APPLICATIONS_ENABLED`, `CREATOR_CONTENT_ENABLED`, `CREATOR_UPLOADS_ENABLED`, `CINEMA_UPLOAD_RECOVERY_ENABLED` (on). Defer.

**Publish / social**
- Routes: see 1.6. Needed first: `social/access`, `social/accounts`, `social/brands`, `social/uploads`, `social/posts`, `social/drafts`, `social/calendar`.
- Server changes: S3 and S4 for connecting accounts; S5 not needed for Publish (ADR-0109 done, flag off). Plan changes via store only (ADR-0109 point 4: do not link to the web Stripe portal).
- Gates: `PUBLISH_ENABLED`, `publishAllowed`, `PUBLISH_RELEASED_NETWORKS`; `PUBLISH_UPLOADS_ENABLED` is off in production, so media posts via `social/uploads` are not available there yet.

**Projects**
- Routes: section 1.4. Bearer-only; `exactKeys` body validation and idempotency keys (`idempotencyKey(request)` header) apply. Useful only with the editor. Defer.

**Credits (finish)**
- Add `ledger`, `ledger/usage`, `top-ups` history (read-only; `top-ups` GET returns Stripe-origin purchases, fine to display), `free-allowance`. No server change.

**Account**
- Routes: `account`, `session/me`, `appeals`, `reports`, `referrals`, and new deletion (S1). Store requirement: Terms, Privacy and AUP links, restore purchases (`BillingProvider` has restore on the Publish screen; ADR-0108 puts it on the account screen), delete account.

**Referrals**
- `referrals` GET and `referrals/attach` POST. Needs S3 so a `veyrnox.ai/?ref=CODE` link opens the app, or a manual code field. Gate `REFERRALS_ENABLED` (on).

**Presets / templates and Oddlings**
- Public data (`/api/popular-templates`, static inventory in `lib/generatedProductInventory.js`; Oddlings is client-rendered). No auth, no server change. Templates feed straight into Create; low effort once Create accepts media. Oddlings is optional.

## 4. Structural gaps in the existing mobile code

Evidence is `apps/mobile/package.json`, `app.json` and the 2,325 lines under `src/`.

| Area | State | Detail |
|---|---|---|
| State management and caching | **Missing** | Component `useState` plus two React contexts (`AuthProvider`, `BillingProvider`). No query library (React Query/SWR), no store, no request de-duplication. Library, home and credits refetch on every focus (`useFocusEffect`). No optimistic updates, no cursor cache, no stale-while-revalidate. |
| Offline | **Missing** | No NetInfo, no persisted cache, no queue. `ApiError(0, 'network')` is surfaced as an error text with tap-to-retry. Chat and generation submits rely on idempotency keys, which is good groundwork for safe retries. |
| Push notifications | **Missing** | No `expo-notifications` dependency or plugin; no server side (S2). Job screen polls every 3 s for up to 10 min and stops when the screen closes (`waitForJob`), so a backgrounded app never learns a video finished. |
| Deep links and universal links | **Partial** | Custom scheme only: `scheme: "ai.veyrnox.app"` and `AUTH_REDIRECT_URL = 'ai.veyrnox.app://auth/callback'`. `expo-linking` is installed. No `associatedDomains`, no Android `intentFilters`, no `+native-intent` or link handling for shared content. Server files absent (S3). |
| Analytics and crash reporting | **Missing** | No Sentry, PostHog or similar, no `ErrorBoundary`, no logging layer. Web has `lib/analyticsClient.js`, `analyticsPrivacy.js` and operational error capture in `gateway.js`. |
| i18n | **Missing** | All strings are hard-coded English literals in screens and in `lib/billing.ts` (`renewalTerms`). No `expo-localization`, no catalogs, no RTL handling. Web ships 11 locales (`en` plus ten: es, zh, hi, ar, fr, pt, ru, ja, de, ko) from `lib/i18n/locales.mjs` with message files in `lib/i18n/messages/*.mjs` (ADR-0107). Arabic needs RTL. Note: the web catalogs cover only public marketing pages (`LOCALIZED_PATHS`), so app-screen strings have no existing translations to reuse. |
| Accessibility | **Minimal** | 33 mentions of `accessibilityRole` or `accessibilityLabel`, but only 1 `accessibilityLabel`. No `accessibilityState` on selectable rows, no dynamic-type or font-scale checks, no live-region for job status or streaming chat text, no contrast audit of `theme.ts`, dark only (`userInterfaceStyle: "dark"`). |
| Tests and E2E | **Unit only** | 7 Jest files, 44 test cases (`__tests__/*.test.ts`) covering pure logic: api client, auth, chat parsing, media, billing, publish plan, email form. No component tests, no Detox or Maestro flows, no mock-backed navigation tests. `dev/mock-server.mjs` exists (via `EXPO_PUBLIC_DEV_API_BASE`) and is a ready base for E2E. Root CI does not run them (below). Not verified on a device: Turnstile web view (ADR-0106), RevenueCat sandbox (ADR-0108/0109). |
| EAS build config | **Missing** | No `eas.json` in `apps/mobile`. `app.json` has no `extra.eas.projectId`, no `runtimeVersion`, no `updates` (no OTA), no `buildNumber` or `versionCode`, no `expo-build-properties`, no `expo-dev-client`. `ios/` exists on disk but is git-ignored CNG output (not tracked). `EXPO_PUBLIC_REVENUECAT_*` and `EXPO_PUBLIC_STORE_BILLING_ENABLED` are read from env with nothing to set them per profile. |
| CI | **Missing** | `.github/workflows/` has 25 workflows and none builds or tests `apps/mobile` (the only "mobile" match is the web page sweep in `page-qa.yml`). ADR-0106 says the root build never installs it. Needs: typecheck, lint, Jest, `expo-doctor`, `eas build` for preview, and a path filter on `apps/mobile/**`. `.github/CODEOWNERS` has no mobile entry. |
| App config and assets | **Gaps** | No privacy manifest tuning beyond the generated `PrivacyInfo.xcprivacy`; no `NSPhotoLibrary...`, camera, microphone, or notification usage strings because those modules are not installed; no splash config; adaptive icon present. Orientation locked to portrait, tablet supported (`supportsTablet: true`) with a phone layout. |
| Security hygiene | **Mostly good** | Refresh token in Keychain with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, access token in memory, single-flight refresh, constant `redirect_to`, Turnstile web view restricted to Cloudflare origins. To add: certificate-pinning decision, jailbreak/root stance, screenshot privacy for asset URLs (URLs are short-lived and not stored, good). |
| Navigation and UX structure | **Thin** | One `Stack` for everything; home screen is a button list (`(app)/index.tsx`). No tab bar, no persistent create flow, no global error or empty-state components, no toast, no shared UI kit (only `theme.ts` and `Logo.tsx`). `typedRoutes` is on. |
| Native modules needed for the roadmap (none installed) | **Missing** | `expo-notifications`, `expo-video`/`expo-audio`, `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-media-library`, `expo-localization`, `@react-native-community/netinfo`, a query library, a crash/analytics SDK, `expo-dev-client`, `expo-build-properties`. |

## 5. Suggested order (smallest steps that unblock a store release)

1. Release plumbing: `eas.json` (development, preview, production), `app.json` identity fields, GitHub Action for typecheck, lint and Jest on `apps/mobile/**`, crash reporting.
2. S1 account deletion (server and app) plus an Account screen (links, restore purchases, report). Required for review.
3. S6 production enablement for store billing (the owner prerequisites in ADR-0106 and 0108/0109), and device verification of Turnstile and sandbox purchases.
4. Query cache and offline-safe reads; i18n scaffold and VoiceOver and TalkBack pass.
5. Media: uploads (source images), richer catalog, in-app video and audio player, save to Photos. Then Auto Short (two screens) and push (S2).
6. S3 app links, then Publish connect (S4) and composer; Cinema free viewer (S7, S8) before any paid Cinema (S5).
7. Defer editor, projects and creator upload; offer web handoff.

## 6. Open questions the code cannot answer

- Whether Cloudflare Stream signed tokens work against `/manifest/video.m3u8` for the production customer code (needs a live `cinema/play` call).
- Exact response shapes for `cinema/uploads` start, `library/editor-renders` and `chat/personas` (handlers are factories in `lib/cinema/*.js`, `lib/editorRenderApi.js`); read them before estimating those slices.
- Whether production enables flags in the Cloudflare dashboard that `wrangler.jsonc` does not show. The comments in `wrangler.jsonc` say some are set outside the file; only the file was read.
- Whether the Apple provider in Supabase already accepts `ai.veyrnox.app` as audience (owner prerequisite in ADR-0106).
