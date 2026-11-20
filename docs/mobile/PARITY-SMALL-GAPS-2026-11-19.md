# Mobile parity: small gaps audit (2026-11-19)

Read-only audit of seven candidate gaps between the web and `apps/mobile`, against `main` at 7974c211d. Owner rule
(2026-11-19): everything on the phone is native; no web view, no web link-out. Credits stay store-only
(`docs/mobile/PARITY-2026-10-19.md`, decision 4). Passkey enrolment is out of scope (blocked on a spike).

## Result

| # | Gap | Verdict | Size | Native config / store rebuild |
|---|-----|---------|------|-------------------------------|
| 1 | Vey help assistant (`/api/v1/help`) | **Not a gap.** Removed from the phone on purpose by the owner (ADR-0265, 2026-10-27). Do not rebuild. | none | none |
| 2 | Per-network post text in Publish composer | **Already built.** `compose.tsx` keeps `networkText`, `NetworkTextFields`, `cleanNetworkText`, `networkTextProblem`, sent as `networkText` in `createBody`; gated by the server `variants` flag (`gates.variants`), with a free-plan lock message. Nothing to do. | none | none |
| 3 | Model Compare pages | **Real gap.** No phone route. | S | none (pure JS) |
| 4 | Publish plan cancel/manage | **Real gap**, native cancel only (no portal). | S to M | none |
| 5 | Magic-link / email-code sign-in | **Real gap.** | S (code entry) / M (tap-the-link) | code entry: none; tap-the-link: yes, see below |
| 6 | `GET /api/v1/social/access` | **Low value.** Web uses it only to show or hide the Publish nav flag (`PublishFlag.js`). The phone reads `/social/plan` and the account gates. Skip unless a Meta-review gate is needed on the phone. | S | none |
| 7 | Report PDF / slide export | **Already built.** `publishReports.ts` `shareReport` fetches `GET /reports/:id/export`, writes the cache file and calls `Sharing.shareAsync`. Needs only a device check. | none | none |

## Evidence per item

### 1. Vey help
- Web/API: `app/api/v1/help/route.js` (POST, free, rate limited by `consume_account_read_request`; may spend supplier money after `provider_spend_admit_custom_auth`; reads account snapshot for charge questions).
- Phone: `src/app/(app)/help.tsx` has guides, support email, chat link, appeals, report, rules. ADR-0265 states: "The web `/api/v1/help` endpoint is unchanged; the app no longer calls it." The parity table row in `PARITY-2026-10-19.md` ("Vey help assistant: Partial") predates it and is stale.
- Action: update that row; no build.

### 2. Per-network text
- Web: `app/veyrnox/app/publish/Composer.js` (`variantsEnabled`, `networkText`); server `lib/social/postVariants.js` (max 11 networks, per-network caption limit, `invalid_network_text`, `caption_too_long`).
- Phone: `src/app/(app)/publish/compose.tsx:60,147,259`, `src/lib/publishCompose.ts:64-140`, `src/components/ComposeExtras` `NetworkTextFields`.
- Live: `PUBLISH_RUNTIME_FLAGS.variants` is `"true"` in production and staging (`wrangler.jsonc:261,432`).

### 3. Compare pages
- Web: `app/veyrnox/compare/[pair]/page.js`, `lib/comparePairs.js`. Pair slug `<a>-vs-<b>`, ids alphabetical; allowed only for two prompt-only generators (`inputs.prompt` and no required media slot) of the same modality. Rows: price, then every model fact side by side. SEO page; no API of its own, built from the public catalog.
- Phone: `models.tsx` and `model/[id].tsx` exist; `fetchCatalog`, `fetchPremiumModels`, `modelFacts`, `priceUnit` already give every row. No compare route.
- Live: public page, always on.
- Plan: a native `model/compare` screen fed by the catalog already on the phone, entered from the model detail page. No server call, no spend, no consent. No USD row (credits stay store-only; the web USD row comes from web credit packs).

### 4. Publish plan billing
- Server: `lib/social/publishPlanApi.js`. `GET /social/plan` returns `entitlement.subscription` with `status`, `current_period_end`, `cancel_at_period_end`, `source` (`stripe` | `store` | `complimentary`). `POST /social/plan/cancel` (no body, `application/json`, Stripe cancel at period end, then `mark_social_publish_cancelled`; returns `{ok, current_period_end}`) works only for a Stripe-sourced live plan. `portal` returns a Stripe-hosted URL: a link-out, **excluded**. `return` is the Stripe checkout return: not needed.
- Phone: `src/lib/publishPlan.ts` reads tier and source only; `components/publish/PlanLocked.tsx`. No cancel, no period end shown.
- Live: `PUBLISH_RUNTIME_FLAGS.plans` is `"true"`.
- Plan: native status card (plan, renews or ends on date) plus a confirm-then-cancel button, shown only when `source === 'stripe'`. Store plans are cancelled in the store (OS settings: not a web view) and complimentary plans are managed nowhere; show a plain-text note. Cancel is a write that could double-apply: one idempotent attempt, disabled while in flight, re-read the plan after. Not a content POST; register as paid-adjacent only if the hard paywall list covers cancel (it should not, it removes spend).

### 5. Magic link
- Web: `app/lib/authClient.js:379-408` sends `POST /auth/v1/otp` with `create_user: true`, captcha token and `redirect_to`.
- Phone: no OTP sign-in. Google and Apple use PKCE with the `/auth/mobile` hand-back to `ai.veyrnox.app://auth/callback`.
- Two routes:
  - **A. Emailed 6-digit code, typed into the app** (`POST /auth/v1/otp`, then `POST /auth/v1/verify` with `type: email`). Fully native, no deep link, **no native config change or store rebuild**. Needs the Supabase magic-link email template to include `{{ .Token }}` (a dashboard change by the owner) and a Turnstile token for sign-in (the phone already needs a solution for the password path).
  - **B. Tap the emailed link** back into the app. Needs the link to land on a path the app owns. `app.json` has `associatedDomains` `applinks:veyrnox.ai` (iOS) and Android intent filters limited to `/app/library`, `/app/chat`, `/app/create`, `/app/credits`. A new path (for example `/auth/mobile`) must be added to `lib/mobileAppLinks.js` and the AASA file, and to the Android `intentFilters` in `app.json`; the Supabase redirect allow-list must include it. `app.json` change = **new native build and store submission**. Not done in this slice.
- Recommendation: route A first when the owner wants it.

### 6. Publish access check
`GET /social/access` returns `{enabled}` from `publishAllowed(authId)` (`PUBLISH_ENABLED` is `"true"` in production, or a tester id). The web uses it to hide the Publish menu. The phone shows Publish unconditionally and handles `publish_not_open`-style errors per call. Low value; skip.

### 7. Report export
Already shares PDF/slides through the system share sheet (`src/lib/publishReports.ts:99`). Verify on a device when one is available; not a code gap.

## Ordered plan

1. **Slice 1 (this PR): Compare (item 3).** Pure JS, read-only, no server, no spend.
2. Slice 2: Publish plan status and cancel (item 4). Small, needs the real client guard test and an idempotent single attempt.
3. Slice 3: emailed-code sign-in (item 5, route A). Needs the owner to confirm the Supabase email template and the captcha approach.
4. Later, only on the owner's word: tap-the-link (5B, store rebuild); `social/access` (6); device check of report export (7).
5. Doc housekeeping: mark the Vey help row stale in `PARITY-2026-10-19.md`.
