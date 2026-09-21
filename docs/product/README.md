# Product documents — Veyrnox.ai

The app-wide set. Feature sets extend these (e.g.
[docs/face-filters/](../face-filters/README.md)).

| document | answers |
|---|---|
| [PRD.md](PRD.md) | what is shipped, what is deliberately not, what is in flight |
| [APP-FLOW.md](APP-FLOW.md) | routes, sign-in, generating, buying Credits, every failure path |
| [UI-UX.md](UI-UX.md) | colour tokens, type, layout, components, copy, accessibility |

The other roles of the six-document framework are already covered:

| role | where |
|---|---|
| Technical decisions | [CLAUDE.md](../../CLAUDE.md) + [docs/adr/](../adr/README.md) |
| Backend schema | `packages/db/schema/supabase/` — the SQL is authoritative |
| Build plan | [docs/PHASE-1.md](../PHASE-1.md) for the money spine; each feature set carries its own |

**Precedence when documents disagree:** `CLAUDE.md` → `docs/adr/` →
`CONTEXT.md` (vocabulary) → these documents → feature sets.

These describe the product as of 2026-09-21. When a PR changes what they say
is true, it updates them in the same change.
