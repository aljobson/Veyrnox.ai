# Metricool and Zernio reverse-engineering report — 13 October 2026

## Scope and evidence boundary

This report compares the authenticated Metricool and Zernio product surfaces with
Veyrnox.ai Publish as shipped on `origin/main` at
`9e94216cc5ad2c0ede6c400780eeaaace7978c8a`.

The requested REA workflow was started first. `rea-agents@6.4.0 doctor` reported
that the installed Codex MCP registration and REA skill are stale. The current
Chrome extension session also exposes no loopback CDP endpoint, so REA could not
attach and produce canonical Evidence objects. The investigation therefore used
read-only accessibility/DOM observation of the user's already-authenticated Chrome
tabs as a fallback. The `UI-Mxx` and `UI-Zxx` identifiers below are observation
ledger IDs, not REA Evidence IDs. No posts, messages, connections, exports,
subscriptions or settings were created or changed.

Repository claims use current source and focused contract tests. They do not prove
that a provider API works live. A focused run of 157 Publish tests passed with zero
failures.

## Executive finding

Veyrnox has a sound publishing core: account connections, one-media composition,
post-now and scheduled delivery, calendar rescheduling, token handling, provider
adapters, basic analytics storage, and Stripe billing. It is not yet a complete
Metricool-style social management product or a Zernio-style communications API
platform.

The largest commercial mismatch is the current Publish Plan promise. Production
advertises “Full analytics history” and “Best-time recommendations,” while the UI
offers only 7, 30 and 90-day views, the API entitlement is capped at 366 days, and
best-time insights are globally disabled in production. LinkedIn and X are public
production networks but have no analytics collectors.

## Benchmark summary

| Capability | Metricool | Zernio | Veyrnox production |
| --- | --- | --- | --- |
| Social connections | Broad social, web, blog and ad catalogue | Broad social, messaging, commerce, ads and API catalogue | Public: YouTube, LinkedIn, X; several more built behind switches |
| Composer | Network-aware formats, presets, notes, previews and scheduling | API-first post management and platform connections | One global caption, one media item, account selection, post now or schedule |
| Calendar | Week/list/library/autolists/deleted/flows; best-time overlay | Post management/history surfaces | Month/week/list, filters and drag-to-reschedule |
| Analytics | Deep per-network, cross-network summary, comparison periods, content and audience drilldowns | Posting and account analytics surfaces | Instagram/YouTube/TikTok/Twitch only; YouTube is the only public production network with analytics |
| Reporting | CSV, PDF, PPT, templates, branding and scheduled email | Operational logs, API and webhook visibility | No exportable or scheduled reports |
| Engagement | Unified inbox and automation flows | Inbox plus workflow surface; messaging channels | No inbox, reply or automation workflow |
| Collaboration | Users, roles, review requests | Users, profiles, API keys and webhooks | One implicit brand; no team roles or multi-person approval |
| Adjacent products | SmartLinks, ads, campaign dashboards, integrations | Ads, commerce, WhatsApp, iMessage, RCS, phone and API infrastructure | None in Publish |

## Metricool observations

### Analytics and reporting

- **UI-M01 — Instagram analytics.** Arbitrary main period plus comparison period;
  Community, Account, Posts and Reels sections. Visible metrics include followers,
  following, total content, changes and rates; account reach/views, interactions
  and profile activity; per-post reach, views, interactions, likes, saves, shares,
  comments, engagement and new followers. Reel columns add average/total watch
  time, duration, retention and three-second view rate. Tables have search,
  configurable columns, pagination and CSV downloads. A hashtag performance table
  is present.
- **UI-M02 — Cross-network Summary.** Aggregated followers, impressions,
  interactions and post counts across YouTube, X, Instagram, LinkedIn and TikTok,
  with a sortable cross-network content table and CSV export.
- **UI-M06 — Reports.** Arbitrary period, comparison month, language, reusable
  templates, per-section network/ad toggles, sort metric, row limits, logo branding,
  PDF/PPT generation, previous downloads, and automatic monthly email delivery with
  recipients, reply-to, delivery day and message.
- **UI-M07 — Reporting hub.** Predesigned reports, Campaign dashboards, Metricool
  Studio dashboards, Looker Studio and paid hashtag tracking are presented. Some
  were upsells, so their inner behavior was not observed.
- **UI-M12 — Network depth.** X exposes follower movement, impressions,
  engagements, reposts, replies, quotes, clicks, video views and bookmarks.
  LinkedIn exposes page growth, visitors, views, clicks, engagement, demographics
  and video watch metrics. TikTok exposes profile/video performance, reach,
  impression sources, completion and watch time. YouTube exposes subscriber
  movement, views, revenue, demographics, traffic sources, engaged views, watch
  time, reactions and competitors.
- **UI-M13 — Instagram drilldowns.** Views can be split by follower status;
  interactions by content type; profile activity by button type.

### Publishing, automation and operations

- **UI-M03 — Planner.** Week calendar plus List, Posts library, Autolists, Deleted
  posts and Flows. It has week navigation, search, timezone, custom views and a
  day/hour best-time heatmap.
- **UI-M14 — Content automation.** The Posts library supports reusable ideas,
  lists and boards. Autolists can ingest RSS/blog content, repeat a queue and
  publish on a schedule. Flows can react to comments, DMs and keywords, chain
  messages and measure activations, messages and conversions.
- **UI-M15 — Composer.** Multi-network selection, X post/poll modes, notes, media,
  long-form/thread guidance, saved text and presets, scheduled time, publish
  options and a social preview.
- **UI-M05 — Inbox.** Unified conversations with search, network filters and
  Unresolved/Unread/All states, conversation selection and resolution workflow.
  Private message contents were not inspected.

### Connections, collaboration and adjacent products

- **UI-M04 — Connections.** Web, Blog, Facebook, Instagram, Threads, X, Bluesky,
  LinkedIn, Pinterest, TikTok personal/business, Google Business Profile, YouTube,
  Twitch, Meta Ads, Google Ads, TikTok Ads and Looker Studio are catalogued.
- **UI-M08 — Integrations/API.** Connected-app inventory with revocation; the
  visible account listed Claude, ChatGPT, Make, Zapier and Adobe Express. Advanced
  plans advertise analytics export, workflow automation and reporting APIs.
- **UI-M10/UI-M11 — Users and roles.** Brand-filtered users, Add user, roles and
  permissions, plus predefined Client, Content creator, Analyst, Editor and
  Manager roles. The full matrix was plan-gated.
- **UI-M16 — SmartLinks and ads.** Link-in-bio microsites with click/conversion
  analytics, and campaign workspaces for Meta, Google and TikTok ads.

## Zernio observations

### Publishing and analytics

- **UI-Z01 — Connections catalogue.** Zernio presents Bluesky, Discord, Facebook,
  Google Ads, Google Business, iMessage, Instagram, LinkedIn, LinkedIn Ads, Meta
  Ads, OpenAI Ads, Pinterest, Pinterest Ads, Reddit, Reddit Ads, Shopify, Slack,
  Telegram, Threads, TikTok, TikTok Ads, X, WhatsApp, WordPress, X Ads and YouTube;
  Snapchat is marked coming soon. Connected accounts show identity, connection
  date, account health, copyable ID and disconnect.
- **UI-Z02 — Platform structure.** Primary navigation includes Connections,
  Posts, Analytics, Inbox, Ads, Commerce, WhatsApp, iMessage, RCS, Phone, API Keys,
  Users, Webhooks, Logs and Settings. This indicates an API/operations platform
  with social publishing as one subsystem, rather than a planner-only product.
- **UI-Z03 — Profiles and metering.** Connections are grouped under a profile with
  a copyable profile ID; the UI exposes New Connection and New Profile actions and
  shows a dollar credit balance. This is a multi-profile, usage-metered operating
  model.
- **UI-Z04 — Post inventory.** Forty-five records were visible with pagination,
  published/partial states, media previews, provider links, platform indicators and
  per-record results. Filters cover source, status, platform, profile, user and
  date. The page supports sorting, grid/table/calendar views, density controls and
  CSV import.
- **UI-Z05 — Composer.** Caption, media, profile/account search, multi-account
  selection, timezone and four delivery modes: Schedule, Now, Queue and Draft.
  Account rows expose preflight problems such as missing media.
- **UI-Z06 — Reuse and queues.** “Reuse previous post” opens a searchable visual
  catalogue of earlier content/media. Queues have profile, queue, slot, next-slot
  and status concepts, with Create Queue and Configure actions. No queue was
  configured, so recurrence and conflict handling remain unknown.
- **UI-Z07 — Calendar.** Month selection, Today, Sunday/Monday week-start choice,
  filters and grid/table/calendar switching. Drag-and-drop behavior was not tested.
- **UI-Z08 — Posting analytics.** Platform, profile, source and time filters plus
  CSV export. Summary metrics include engagement rate, reach, follower change,
  post volume, best post and prior-period deltas.
- **UI-Z09 — Analytics depth.** Posts and likes by platform/time, selectable
  engagement series, best-time heatmap, follower evolution, content-format
  comparison, platform breakdown, sortable top posts, posting frequency versus
  engagement and engagement accumulation after publication. Visible measures
  include followers, likes, comments, shares, saves, clicks, views, impressions,
  reach, follows and engagement rate.

### Engagement, automation and CRM

- **UI-Z10 — Unified inbox.** Messages, Comments, Reviews, Campaigns, Workflows
  and Contacts, with searchable/filterable account views. Private conversation
  content was not reproduced in this report.
- **UI-Z11 — Inbox analytics.** Received, sent, read and failed counts,
  conversation count, median response time, trends, platform volume, response-time
  analysis, account rankings, outbound source and a day/hour arrival heatmap.
- **UI-Z12 — Campaigns.** Bulk Broadcasts, timed Sequences and Comment-to-DM
  automation. Comment-to-DM can use tracked redirects for click and CTR reporting.
- **UI-Z13 — Workflows.** Graph automations respond to inbound messages and expose
  platform/account, node, run and creation metadata. The UI states these workflows
  are created through the API.
- **UI-Z14 — Contacts.** CSV import, manual add, search, platform filtering, tags,
  subscription state and last-active dates.

### Operations, collaboration and adjacent products

- **UI-Z15 — Ads and commerce.** Ads supports standalone creation and boosting
  existing posts, filtering, audiences and Meta lead forms. Commerce covers
  products, variants, prices, inventory, collections, discounts and Shopify or
  WooCommerce catalogue sync. Inner mutation flows were not opened.
- **UI-Z16 — Team.** Invites, roles, access scope, join/last-login details and an
  activity ledger for invites, role changes and removals.
- **UI-Z17 — Developer operations.** Profile-scoped API keys with permission
  levels, webhook management, and logs with time/status/type/route/account/error/
  platform filters, search, live tail, refresh and export.
- **UI-Z18 — Security and notifications.** Alerts for failed posts, disconnects,
  payments and usage; authenticator two-step verification, active sessions and
  global sign-out.
- **UI-Z19 — Billing and usage.** Per-connected-account billing with the first two
  free, credit balance, invoices, payment method, billing details, X API monthly
  cap and early-charge threshold. Usage supports custom ranges with daily, weekly,
  monthly and cumulative modes. Sensitive values were omitted.
- **UI-Z20 — AI and enterprise.** Workflow AI steps support customer-supplied,
  encrypted keys for Anthropic, OpenAI, Gemini, Mistral, Groq and OpenRouter.
  Enterprise surfaces advertise SAML/OIDC SSO, SCIM, audit logs and Slack Connect.

## Veyrnox implementation and live-state audit

### Built and enabled

- Production Publish, five-account allowance, billing, calendar and the basic
  analytics sweep are enabled. The production release list is only YouTube,
  LinkedIn and X.
- The UI can connect and disconnect accounts, choose multiple targets, select one
  generated-library asset, use one caption, choose Post now or Schedule post and
  set YouTube visibility.
- Calendar supports month/week/list, status/network filters, local time, provider
  status/link and explicit drag-to-reschedule confirmation.
- Analytics storage records daily account snapshots and per-post metrics. The
  dashboard shows one account at a time with follower evolution, post/video count,
  interactions, engagement and a per-post table.
- Stripe subscription start, recovery, billing portal and cancellation exist for
  the $15 monthly Publish Plan.

### Built but not generally live

- Instagram and TikTok publishing adapters exist, but they are not in the public
  production release list on `origin/main`.
- Facebook, Threads, Bluesky, Twitch and Google Business Profile depend on the
  extended-network flag, which is off in production. Pinterest has an adapter but
  has been removed from the visible catalogue.
- Device upload UI and storage flow exist but are off in production.
- Weekly draft generation and owner batch approval exist but are disabled during
  limited network release. They are not a team approval system.
- Posting-time/frequency insights exist with a twelve-week heatmap and evidence
  thresholds, but the production switch is off.
- Instagram reach/views/saves/shares and TikTok account/video analytics collectors
  exist, but their provider scope switches are off.

### Missing

- Analytics collectors for LinkedIn, X, Facebook, Threads, Bluesky and Google
  Business Profile.
- Cross-network summary, arbitrary comparison periods, audience demographics,
  traffic-source analysis, watch-time/retention depth, hashtag and competitor
  analysis.
- CSV/PDF/PPT exports, report templates, branding and scheduled report delivery.
- Unified inbox, comment/DM replies, resolution queues and workflow automation.
- Reusable content library, presets, platform-specific caption variants, threads,
  polls, previews, RSS/autolists, recycle queues and deleted-post recovery.
- Multi-brand workspaces, team members, granular roles and multi-person approvals.
- API keys/webhooks/log explorer for customers, SmartLinks/link-in-bio, ad campaign
  management and commerce/messaging products.

## Recommended build order

### P0 — Make the paid promise true

1. Change the paywall wording immediately or ship the promised entitlement:
   production best-time is off, “full history” is not exposed, and free and paid
   accounts currently both receive five connection slots.
2. Add an analytics capability matrix to the plan and dashboard so users can see
   which metrics each network supplies and whether reconnection/approval is needed.
3. Add production observability for sweep freshness, provider failures and stale
   accounts before adding more collectors.

### P1 — Complete analytics for live networks

1. Build X and LinkedIn account/post collectors first because both are already
   public production networks.
2. Enable posting-time insights for paid users after production data and migration
   checks, and display the heatmap in both Analytics and Calendar.
3. Replace the fixed 7/30/90 selector with arbitrary date ranges, period comparison
   and a paid history view consistent with the entitlement.
4. Add a cross-network Summary and a normalized metric dictionary that never
   invents unsupported equivalence.
5. Add CSV export for account evolution and post tables.

### P2 — Provider-rich metrics

1. Finish Meta and TikTok app review, then reconnect accounts for the new scopes.
2. Add watch time, retention, completion, traffic sources, subscriber/follower
   gained/lost and audience demographics where provider APIs permit them.
3. Add data-quality labels for lifetime versus period metrics, rounded values,
   partial access, freshness and provider sampling.

### P3 — Reporting and engagement

1. Branded reusable report templates, PDF/PPT export and scheduled email delivery.
2. Unified inbox for comments and messages, with unread/unresolved queues and
   assignment.
3. Team members, brand workspaces, roles and approval workflows.

### P4 — Content operations

1. Platform-specific text/media variants and previews.
2. Saved captions/presets, reusable content library, duplicate/recycle flows and
   deleted-post recovery.
3. RSS/autolists and carefully bounded comment/DM workflows.

### P5 — Optional expansion

Competitor/hashtag tracking, customer API/webhooks/logs, SmartLinks, ads and
commerce/messaging channels should follow the core analytics, reporting and inbox
work. These are distinct products and should not delay making the current $15 plan
truthful and dependable.

## Evidence status and residual unknowns

| Question | Status | Evidence |
| --- | --- | --- |
| Metricool visible analytics depth | Answered | UI-M01, M02, M12, M13 |
| Metricool publishing/automation surface | Answered at UI level | UI-M03, M14, M15 |
| Metricool reporting/collaboration/adjacent modules | Answered at UI level; premium internals partial | UI-M04–M11, M16 |
| Zernio platform, publishing, analytics and connections | Answered at UI level | UI-Z01–Z09 |
| Zernio inbox, automation and CRM | Answered at UI level | UI-Z10–Z14 |
| Zernio operations, team and adjacent modules | Answered at UI level; mutation flows partial | UI-Z15–Z20 |
| Veyrnox built versus enabled capability | Answered from source | `origin/main`, 157 focused tests |
| Competitor backend formulas and API contracts | Unresolved | REA/CDP unavailable; UI alone cannot establish them |
| Mutation flows such as publish, revoke, resolve, export or subscribe | Intentionally untested | Read-only investigation boundary |
| Premium Metricool Studio/Campaign/API behavior | Partially answered | Upsell descriptions only |
| Provider accuracy, freshness guarantees and historical retention | Unresolved | Requires provider documentation and controlled data study |

## REA remediation for source-level browser reconstruction

After the UI investigation, the owner approved and the following remediation was
applied successfully:

```text
npx -y rea-agents@latest setup --client codex --skill-client shared --yes
```

It updated `/Users/aljobson/.codex/config.toml`, created
`/Users/aljobson/.codex/config.toml.rea.backup`, and refreshed the shared REA skill
from version 23 to version 37. The post-setup doctor reported the Codex registration
and skill aligned. Codex must now be restarted before the new MCP tools appear in
this session. Browser analysis will still
require launching or exposing Chrome through an approved loopback CDP endpoint
with exact allowed origins for `https://app.metricool.com` and
`https://zernio.com`.
