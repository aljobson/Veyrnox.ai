# Veyrnox Publish — Specification Pack

**Feature:** Native multi-platform social scheduling and publishing ("Veyrnox Publish")
**Version:** 0.1 (draft)
**Status:** Accepted via [ADR-0061](../adr/0061-veyrnox-publish-social-scheduling.md)
(2026-09-28) — build-vs-buy (native adapters) and v1 platform scope — and via
[ADR-0062](../adr/0062-veyrnox-publish-entitlement-model.md) (2026-09-28) — the billing
mechanism (independent "Publish Plan," never the credit ledger). Both approved by the
product owner. Implementation may now proceed under these ADRs' designs; open items are
tracked in each ADR's "Open questions".
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
   built, what is switched off, what was and was not verified, and the next work in order.

8. [All-network tester handover, 2026-10-08](INTEGRATIONS-TESTING-2026-10-08.md) — native
   connections for eleven networks, supported publish actions, administrator credentials,
   feature switch, migration 0228 and live tester acceptance steps.

## Non-goals for this pack

- The build-vs-buy and platform-scope ADR ([ADR-0061](../adr/0061-veyrnox-publish-social-scheduling.md))
  and the billing-mechanism ADR ([ADR-0062](../adr/0062-veyrnox-publish-entitlement-model.md)) are
  both now Accepted: an independent recurring "Publish Plan," modelled on Cinema Pass (ADR-0057), never touching
  the generation-credit ledger.
- Exact Metricool pricing tiers are **not** reproduced with invented numbers — the authenticated
  pricing page wasn't reachable, and copying a competitor's price points without a confirmed source
  isn't something to guess at.

## Open questions

1. **Platform rollout.** The original five-network scope is extended to all eleven for tester
   implementation by owner direction on 2026-10-08. Production activation still requires
   provider setup and live acceptance. See the tester handover for format/analytics boundaries.
2. **OAuth app approval lead time.** Meta (Instagram/Facebook), TikTok and YouTube each require app
   review before production posting scopes are granted — this can take weeks and should start in
   parallel with engineering, not after.
3. **Credit model** — see Non-goals above.
4. **Does Veyrnox already have a Metricool account for its own brand?** Yes — `getBrandSettings`
   shows a connected brand (`Veyrnox`, blogId `6457974`) with Instagram/X/LinkedIn/TikTok/YouTube
   linked. That account belongs to the sibling Veyrnox wallet product's socials, not Veyrnox.ai's;
   it was used here only as a live, authorized source of Metricool's API shapes, not as product data.
