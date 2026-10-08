# Veyrnox Publish — Specification Pack

**Feature:** Native multi-platform social scheduling and publishing ("Veyrnox Publish")
**Version:** 0.2 (reconciled with the code)
**As of:** 2026-10-08, repo `main` at commit `42150476`. Every doc in this pack was checked against the
code, migrations through 0223, `wrangler.jsonc`, ADR-0061/0062/0063 and the 2026-10-03 to 2026-10-07
handover and acceptance records. Where the pack still describes a design the code does not (yet) do, the
doc says so under a "Built state" or "not built" note instead of silently keeping the old text.
**Status:** Accepted via [ADR-0061](../adr/0061-veyrnox-publish-social-scheduling.md)
(2026-09-28) — build-vs-buy (native adapters) and v1 platform scope — and via
[ADR-0062](../adr/0062-veyrnox-publish-entitlement-model.md) (2026-09-28) — the billing
mechanism (independent "Publish Plan," never the credit ledger). Both approved by the
product owner. Implementation may now proceed under these ADRs' designs; open items are
tracked in each ADR's "Open questions".
**Built state (2026-10-08):** the schedule-and-publish engine, composer, device uploads, draft review,
calendar with safe rescheduling, and analytics for Instagram, YouTube and TikTok are built. Production
keeps `PUBLISH_ENABLED` off, so none of it is open to users there; staging has every Publish flag on
except the two provider-consent switches. The Publish Plan (ADR-0062/0063) is not built. Five networks
are live in code (Instagram, X, LinkedIn, TikTok, YouTube). See the "Built state" notes in 01 and 02.
**Audience:** Product, engineering, design

## Purpose

Veyrnox.ai generates images, video and voice. Today, once a user generates an asset they leave
the product to post it anywhere. This pack specifies a native feature that lets a creator connect
their social accounts once and then draft, schedule, approve and publish directly from Veyrnox —
to every platform they have an account on — without a separate tool.

**One-line pitch:** *Generate it here. Schedule it everywhere. Never open a second tab.*

This is a feature-parity study of **Metricool** (the category leader for multi-network scheduling,
analytics and link-in-bio) combined with the **visual/brand language of syntx.ai** (the site the
user asked us to copy stylistically). Metricool defines *what* we build; syntx.ai defines *how it
should look*.

## Research method and sources

- **Metricool feature map** — crawled `metricool.com` marketing/product pages (public, unauthenticated)
  for the full product nav: Metricool Studio, Planner, Approval System, SmartLinks, AI Assistant,
  Inbox, Flows, Analytics, Competitors, Ads, Reports, Looker Studio connector, Hashtag Tracker.
- **Metricool data model** — the account's own **Metricool MCP connector** (an authorized, live
  integration already available in this session) was used to read the *actual* API contracts:
  `getBrandSettings`, `getScheduledPosts`, `createScheduledPost` / `updateScheduledPost` (full
  per-network payload validation rules), `getAnalyticsAvailableMetrics` (the full metric taxonomy,
  340+ fields across Instagram alone), `getBestTimeToPostByNetwork` (heatmap shape), and the
  SmartLinks and cross-network "Brand Summary" schemas. This is more reliable than screen-scraping
  the web app, which requires a live login session we could not carry into the automated browser.
- **Metricool app UI** — the login/marketing chrome only; the authenticated dashboard, planner and
  composer screens were not reachable by the automated browser (session cookies did not transfer;
  see Open Questions). Screenshots of `metricool.com` marketing pages were captured for palette and
  layout-pattern reference only.
- **syntx.ai** — crawled the public marketing site (home, pricing, trends, tools) for visual design
  tokens: color palette, typography, spacing, component shapes. The in-app generation screens were
  initially not reachable (cookie import into the automated browser didn't carry the session — same
  token-in-localStorage pattern as Metricool). The user then logged into syntx.ai themselves in the
  Claude Code desktop app's built-in browser pane, and this session drove that already-authenticated
  tab directly — see [03-design-style-guide.md §3.8](03-design-style-guide.md#38-authenticated-app--verified-live-2026-09-28-update)
  for the full in-app nav, component patterns, and real (live, authenticated) pricing, all captured
  2026-09-28.

## Documents

1. [Product Specification](01-product-spec.md) — vision, personas, full feature list mapped from
   Metricool, MVP scope vs. later phases, plan/entitlement model.
2. [Technical Specification](02-technical-spec.md) — architecture, data model, API surface,
   per-platform adapter contracts, scheduling engine, analytics ingestion, security mapping to
   this repo's existing rules (RLS, ledger-style audit logs, CSP, bundler traps).
3. [Design Style Guide](03-design-style-guide.md) — the syntx.ai-derived visual system (color,
   type, components) applied to the Publish surface, plus the Metricool UI *patterns* (calendar,
   composer, network badges) it needs to express.
4. [User Flows](04-user-flows.md) — step-by-step flows for connecting accounts, composing and
   scheduling, approvals, rescheduling, failure recovery, analytics review and link-in-bio setup.
5. [Security Baseline](05-security-baseline.md) — maps the design to OWASP (Top 10 + API Security
   Top 10), NIST CSF 2.0, ISO/IEC 27001 Annex A and NCSC guidance (Cloud Security Principles, OAuth
   guidance), with explicit gaps named rather than implied coverage.
6. [OAuth App Review Runbook](06-oauth-review-runbook.md) — prep steps, scopes, and submission
   requirements for Meta, TikTok and YouTube's developer/app-review processes (plus an X/LinkedIn
   appendix), sequenced against what needs a working composer first vs. what can start today. Stops
   short of actual account creation and submission — those need a human with real business
   credentials, not an agent.

7. [Analytics handover, 2026-10-03](HANDOVER-analytics-2026-10-03.md) — what the analytics work
   built, what is switched off, what was and was not verified, and the next work in order. Its later
   sections record the calendar rollout and the 2026-10-04 live YouTube/calendar acceptance.
8. [Publish device uploads, 2026-10-06](DEVICE-UPLOADS-2026-10-06.md) — the upload-from-device
   library (migration 0223), limits, activation steps and the staging acceptance.
9. [Staging acceptance, 2026-10-07](ACCEPTANCE-2026-10-07.md) — the real YouTube publication, real
   video analytics and the live calendar checks. This is the latest verified state.

## Non-goals for this pack

- The build-vs-buy and platform-scope ADR ([ADR-0061](../adr/0061-veyrnox-publish-social-scheduling.md))
  and the billing-mechanism ADR ([ADR-0062](../adr/0062-veyrnox-publish-entitlement-model.md)) are
  both now Accepted: an independent recurring "Publish Plan," modelled on Cinema Pass (ADR-0057), never touching
  the generation-credit ledger.
- Exact Metricool pricing tiers are **not** reproduced with invented numbers — the authenticated
  pricing page wasn't reachable, and copying a competitor's price points without a confirmed source
  isn't something to guess at.

## Open questions

1. **Which platforms ship in v1?** Metricool supports eleven networks (Instagram, Facebook, X/Twitter,
   LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky, Twitch, Google Business Profile). Section
   1.6 of the product spec proposes a phased rollout. **Resolved:** ADR-0061 approved the v1 cut
   (Instagram, X, LinkedIn, TikTok, YouTube); those five are the only networks the connect UI offers.
   Facebook, Pinterest, Threads, Bluesky, Twitch and Google Business Profile exist in the database
   CHECK lists but have no adapter on `main`.
2. **OAuth app approval lead time.** Meta (Instagram/Facebook), TikTok and YouTube each require app
   review before production posting scopes are granted — this can take weeks and should start in
   parallel with engineering, not after. Per-network status as of 2026-10-08 is in
   [06-oauth-review-runbook.md §6.0](06-oauth-review-runbook.md#60-review-status-by-network-2026-10-08).
3. **Credit model** — decided (see Non-goals above), but **not built**: there is no Publish Plan code
   or table (`social_publish_plans` appears only in ADR-0062/0063). Until it exists every user is on
   Free, which the database caps at one active connected account (0169).
4. **Does Veyrnox already have a Metricool account for its own brand?** Yes — `getBrandSettings`
   shows a connected brand (`Veyrnox`, blogId `6457974`) with Instagram/X/LinkedIn/TikTok/YouTube
   linked. That account belongs to the separate sibling Veyrnox business's socials, not Veyrnox.ai's (hard wall in `CLAUDE.md`);
   it was used here only as a live, authorized source of Metricool's API shapes, not as product data.
