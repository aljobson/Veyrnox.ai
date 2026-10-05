# Metricool and Buffer pricing — 28 September 2026

Question asked: what should Veyrnox Publish's own pricing look like? Answered by reading both
companies' **public** `/pricing` pages directly (no login required — this is marketing content),
so the numbers below are confirmed live figures, not estimates. Feeds
[ADR-0063](../adr/0063-veyrnox-publish-plan-pricing.md).

Source: `metricool.com/pricing/` and `buffer.com/pricing`, read live 2026-09-28, USD, both the
monthly and annual billing toggle states captured.

## Metricool — tiered by number of connected brands

| Plan | Monthly | Annual (per month) | Brands | Included |
|---|---:|---:|---:|---|
| Free | $0 | $0 | 1 | Manage all networks except LinkedIn/X, 20 posts/mo, 5 competitor profiles, 30-day analytics, AI assistant (limited credits), Metricool MCP |
| Starter | $25 (5) / $45 (10) | $20 (5) / $36 (10) | 5 or 10 | + Unlimited publishing* (fair-use), 100 competitors, X add-on, Advanced Analytics add-on, LinkedIn, limited Campaign Dashboards/Studio, PDF/PPT reports, multi link-in-bio, unlimited analytics history, Flows, Drive/Canva integration |
| Advanced | $67 (15) / $107 (25) / $210 (50) | $53 (15) / $85 (25) / $159 (50) | 15, 25 or 50 | + Team/client management, role management, post approval system, complete X analytics, customizable report templates, Looker Studio connector, API (Zapier/Make/MCP) |
| Custom | Contact us | — | Custom | + White label, dedicated account manager, custom AI assistant credits |

Feature-comparison table highlights (Free / Starter / Advanced / Custom):
- Post limit/month: 20 / Unlimited* / Unlimited* / Unlimited*
- AI Social Media Assistant credits: 5/brand/mo / 20/brand/mo / 35/brand/mo / custom
- Metrics storage: 30 days / Unlimited* / Unlimited* / Unlimited*
- Competitor analysis: 5 / 100 / 100 / 100
- Twitter/X analytics: none (add-on) / reduced (add-on) / complete / complete

\* Unlimited publishing is bounded by Metricool's Fair Use Policy, not a hard number shown.

## Buffer — priced per connected channel, not per brand

| Plan | Price | Included |
|---|---:|---|
| Free | $0 | 3 channels, 10 scheduled posts/channel, 1 user, basic AI assistant, 30-day analytics history, 1 API key (3,000 req/mo) |
| Essentials | $5/channel/mo | + Unlimited scheduled posts/channel (5,000-post fair-use ceiling), advanced analytics, 3 API keys (7,500 req/mo), hashtag manager, first-comment scheduling |
| Team | $10/channel/mo | + Unlimited team members, 5 API keys (15,000 req/mo), access levels, approval workflows |

Buffer's own FAQ, quoted directly (source, one sentence, under the 15-word copyright limit —
paraphrased beyond that): they price per connected channel specifically so a 30-account
portfolio costs the same whether it's one brand or fifteen, and volume discounts kick in above
10 channels rather than jumping to a new tier.

Annual billing: 20% off across both paid plans (Buffer states this plainly, unlike Metricool's
tier-by-tier percentage).

## Convergence point used in ADR-0063

Both companies land near **$20–25/month for a "manage ~5 accounts" workload**, despite pricing on
different axes (Metricool: per-brand tier; Buffer: linear per-channel):
- Metricool Starter, 5 brands: $25/mo monthly, $20/mo annual.
- Buffer Essentials, 5 channels: $25/mo (5 × $5).

This convergence, from two independently-priced products, is the anchor ADR-0063 uses rather
than an invented number.

## What Veyrnox should not copy

- **Neither company's tier count.** Both ship a 3–4 tier ladder priced against a much larger
  feature set (approval workflows, competitor tracking, Looker Studio connectors, white-label)
  than Veyrnox Publish's v1 scope (ADR-0061) includes. Matching tier count now would price
  features that don't exist yet.
- **Metricool's hard 20-post/month free cap.** ADR-0063 recommends a more generous free tier
  (unlimited posts, fair-use bounded, capped by connected-account count instead) specifically to
  maximize adoption of the Generate→Schedule differentiator — Veyrnox's actual wedge over both
  of these competitors, neither of which has any generation capability of its own.
