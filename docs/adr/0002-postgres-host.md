# ADR-0002 — Postgres host & serverless driver

- **Status**: Proposed
- **Date**: 2026-09-10
- **Deciders**: Product owner (approver), Architect
- **Depends on**: ADR-0001 outcome (if Supabase Auth accepted, this ADR collapses to "Supabase")
- **Blocks**: Phase 1 ledger, catalog, jobs
- **Related**: architecture.md §10, §10.4, §10.9, §25.3

## Context

The target architecture (§10.1, §25.3) puts the credit ledger, users, subscriptions, jobs, assets, model catalog, and webhook events on Postgres. The ledger is money — append-only, row-locked on debit (`SELECT … FOR UPDATE`), point-in-time recovery required (§10.4, §10.9). The catalog is normative (§25.2). Everything else references these tables.

Veyrnox runs on Cloudflare Workers via OpenNext. Workers have hard limits on outbound TCP and no native `pg` driver — they need HTTP-based or WebSocket-based Postgres access. That constraint eliminates several otherwise-fine hosts.

The debit path (§25.3) does a locking read inside a request handler. On a serverless connection, holding a Postgres row-level lock across an HTTP round trip is workable at low concurrency, at risk at high concurrency. Choice of host and driver together decides whether the ledger stays correct under load or needs to move to a stateful runtime (Durable Object per user, or Fly).

## Options considered

### A. Supabase

Managed Postgres + auth + storage + realtime. HTTP driver (`@supabase/supabase-js`) plus a connection-pooled Postgres endpoint (Supavisor) for `pg`-driver-compatible libraries. First-class RLS.

- Free: 500 MB DB, 50k MAU auth, 1 GB storage
- Pro: $25/mo — 8 GB DB, PITR (7-day), 100 GB storage, daily backups
- Point-in-time recovery is Pro-only

### B. Neon

Managed Postgres, purpose-built for serverless. HTTP-based `@neondatabase/serverless` driver — no persistent connections needed; ideal for Workers. Branching (fork-a-database for previews).

- Free: 0.5 GB storage, 1 branch
- Launch: $19/mo — 10 GB, 5 branches, PITR (7-day)
- Fastest serverless Postgres benchmark at time of writing

### C. Fly Postgres

Self-managed Postgres on Fly.io. Full `pg` access via WireGuard or public listener. Full ownership, cheap, but you run it — backups, HA, upgrades on you.

- Cost: $0–$15/mo for a small Postgres + storage
- No first-class serverless driver — need PgBouncer + WireGuard from Workers

### D. Cloudflare Hyperdrive + external Postgres

Hyperdrive is Cloudflare's connection pooler + edge cache for external Postgres. Pairs with any Postgres (RDS, Fly, Neon). Reduces latency, does not host Postgres itself.

- Requires an underlying Postgres host anyway
- Adds an operational layer

## Decision drivers (ranked)

1. **Correctness under concurrent debit** — the ledger must not lose money.
2. **Serverless-driver quality** — no persistent connections from a Worker.
3. **Point-in-time recovery** — money data. Non-negotiable.
4. **Latency from Cloudflare Workers** — every request pays this.
5. **Ops burden** — solo team, no DBA.
6. **Cost at Phase-1 scale** — ~1 GB data, ~100 req/s peak.
7. **Vendor lock-in** — plain Postgres is portable, hosted extras are not.
8. **ADR-0001 collapse** — if auth is Supabase, this ADR is answered.

## Trade-off table

| Driver / Option | A. Supabase | B. Neon | C. Fly self-hosted | D. Hyperdrive + Neon/other |
|---|---|---|---|---|
| Serverless driver | Yes (HTTP + Supavisor) | Yes (HTTP, purpose-built) | No (bring your own) | Adds pooling on top of A/B |
| PITR | Pro tier, 7 days | Launch tier, 7 days | You configure `pgbackrest` | Depends on underlying host |
| Workers latency | Global reads, single-region writes | Multi-region reads (beta), single-region writes | Depends on region + WireGuard | Reduced via pooling |
| Concurrent debit safety | RLS + serialisable OK | Serialisable OK, watch pool exhaustion | Full control, full risk | Same as underlying |
| Ops burden | Low | Low | Medium-high | Medium |
| Cost | $25/mo (Pro) | $19/mo (Launch) | $0–$15/mo | +$0 (Hyperdrive on paid plans) |
| Backups | Managed | Managed | You | Managed (upstream) |
| ADR-0001 collapse | Yes, if auth is Supabase | No | No | No |
| Lock-in | Auth+storage extras | Plain Postgres | None | Cloudflare + underlying host |

## Recommendation

**Option A — Supabase**, if ADR-0001 accepts Supabase Auth.

Otherwise, **Option B — Neon**.

Reasoning:

- Both give a purpose-built serverless Postgres story with PITR at a $19–$25/mo tier. Both are correct under `SELECT FOR UPDATE` at Phase-1 concurrency.
- Supabase wins on vendor consolidation (one bill, one dashboard, one incident surface, RLS pins auth + data together).
- Neon wins on database-only focus and branching — every PR could get a preview database, which is a genuine developer-experience upgrade for the ledger code path.
- Fly self-hosted is real cost savings but the ops burden — backup restore rehearsal, replica failover, PgBouncer tuning — is enough to eat the difference. Only correct if the team grows to include a DBA.
- Hyperdrive is a performance overlay, not a database. Add it later if latency demands it; not a Phase-0 choice.

**Concurrency caveat**: at more than ~30 debits/second per user, even the best HTTP-Postgres path will start to show lock-hold latency. That is above Phase-1 target throughput. If we hit it, move the debit path to a Cloudflare Durable Object keyed by `user_id` (serialised writes per user, no DB lock needed) with async persist to Postgres. Design the ledger interface today so this migration is behind one function.

## Consequences

If Option A (Supabase):
- Single vendor for auth + DB + storage. Simpler ops, higher blast radius on a Supabase outage.
- Storage/realtime features are available but should not be used without a separate ADR — feature creep is the failure mode.
- The `platform_model.xlsx` catalog values (§25.2) load into Supabase-managed Postgres via a seed script.

If Option B (Neon):
- ADR-0001 accepts Clerk (or self-hosted / WorkOS). Two vendors to monitor.
- Neon branching enables per-PR preview environments (§19) — worth setting up in Phase 1.

Both:
- The `debit()` interface must be written so its underlying storage can be swapped for a Durable Object without callers noticing.
- PITR restore drill is a Phase-5 requirement (§10.9) but the backup config must be verified in Phase 1.

## Open questions

- Are there residency requirements (EU users, UK GDPR) that constrain region? Supabase and Neon both offer EU regions, but replicas may put data outside the chosen region.
- What is the largest expected `ledger_entries` row count at 12 months? At 1M entries/user × 10k users = 10B rows, we outgrow the $19–$25/mo tier and need to plan sharding or archival. Not a Phase-1 problem; note it.
- Does OpenNext + Neon-serverless play cleanly under Wrangler dev? Local development for a Postgres-backed app on Workers has historically been rough. Verify via a 1-day spike before Phase 1 commits.
