# Veyrnox.ai

A credit-metered AI generation platform. Users spend credits to generate images, video and voice; every spend goes through an append-only ledger, so a balance can always be proven from its history.

Built from a fork of [Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT). The legacy studio code was later extracted ([ADR-0015](docs/adr/0015-legacy-studio-extraction.md)); the money path, gateway and catalog are Veyrnox's own.

## Status

Pre-launch. Core generation, the credit ledger, Stripe Credit Packs and the admin and recovery tooling are built. Public sign-up and Credit Pack launch are tracked in the launch checklist ([#204](https://github.com/aljobson/Veyrnox.ai/issues/204), [#101](https://github.com/aljobson/Veyrnox.ai/issues/101)). Subscriptions, Cinema and Veyrnox Publish are in progress or gated. See [`ROADMAP.md`](ROADMAP.md) for what is next and [`CHANGELOG.md`](CHANGELOG.md) for what has shipped.

## Main features

- **Generation**: image, video, audio and lip sync across several providers, priced in whole credits from a server-side model catalog.
- **Credits and billing**: Credit Pack top-ups via Stripe (Managed Payments), Free Credits at sign-up, refunds, chargeback freezes and nightly reconciliation.
- **Library and background jobs**: jobs keep running when you leave the page; results are stored privately and delivered by short-lived signed links.
- **Auto Short**: topic in, finished short video out, sold as one priced job that orchestrates several provider calls.
- **Clip Editor**: trim, merge and add audio to generated clips.
- **Projects and workspaces**: tenant-aware project documents with autosave and history, plus quarantined media uploads.
- **Social Cinema** (gated): episodic video catalogue with creator onboarding, review, publication and a viewer paywall.
- **Veyrnox Publish** (in progress): connect Instagram, TikTok, YouTube, LinkedIn and X, then schedule and publish.
- **Auth**: Supabase Auth with email/password, Google, Apple, passkeys and TOTP, with Turnstile on sign-up and sign-in.

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 15, React 19, Tailwind CSS (JavaScript, with TypeScript for `packages/`) |
| Runtime | Cloudflare Workers via OpenNext (`worker.js` adds body limits, admin rate limiting and cron recovery) |
| Database and auth | Supabase Postgres and Auth (EU, Frankfurt), RLS forced on user-facing tables |
| Object storage | Cloudflare R2, EU jurisdiction, signed with SigV4 through Web Crypto |
| Providers | fal.ai, kie.ai, GrsAI, OpenRouter, BytePlus ModelArk (adapters in `packages/adapters`) |
| Payments | Stripe Checkout, with Stripe as Merchant of Record |
| CI and deploy | GitHub Actions: protected, serialized production deploy and a migrations workflow behind owner approval |

## Getting started

Requirements: Node 22 and npm.

```bash
npm install
cp .env.example .env.local   # fill in Supabase and provider values for your environment
npm run dev
```

Secrets such as the Supabase service-role key, provider keys and R2 credentials are Worker secrets and must never be committed. Public values (`NEXT_PUBLIC_*`, the Supabase URL and anon key) live in `wrangler.jsonc`.

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Next.js production build |
| `npm run build:worker` | Build for Cloudflare Workers |
| `npm test` | Unit tests |
| `npm run test:ledger` | Ledger acceptance tests (need a real Postgres, see `packages/db/README.md`) |
| `npm run lint` | ESLint |
| `npm run check:signup-gate` | Check the live sign-up gate state |
| `npm run migrate` | Run migrations (production is applied only by the `apply-migrations` workflow) |

## Project structure

```
app/                 Next.js routes: the marketing site, studio UI and /api/v1 gateway
components/          Shared UI
lib/                 Gateway logic: capability registry, rate limits, sweeps, Auto Short, Cinema, social
packages/adapters/   Provider, Stripe and R2 adapters
packages/catalog/    Model catalog definitions
packages/db/         Postgres schema/migrations (schema/supabase/) and acceptance tests
packages/security/   Security helpers
middleware.js        JWT verification for /api/v1/*
worker.js            Worker entry: limits, cron recovery, retention
tests/               Unit tests
docs/                ADRs, specs, pricing research, runbooks
scripts/             CI gates and operational scripts
```

## Documentation

| File | What it is |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the pieces connect and the invariants that must hold |
| [`ROADMAP.md`](ROADMAP.md) | What is being built next, and what is deliberately not |
| [`CHANGELOG.md`](CHANGELOG.md) | What has shipped, by date |
| [`docs/adr/`](docs/adr/) | Why each technical decision was made (the decision log) |
| [`CONTEXT.md`](CONTEXT.md) | Domain language (Credit, Top-up, Free Credits, and so on) |
| [`CLAUDE.md`](CLAUDE.md) | Rules for AI-assisted work in this repo |

## License

Based on [Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) (MIT). See [LICENSE](LICENSE). Copyright (c) 2026 Veyrnox. Copyright (c) 2026 Open Generative AI Contributors.
