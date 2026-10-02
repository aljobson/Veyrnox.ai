# Product documents — Veyrnox.ai

The app-wide set. Feature sets extend these (e.g.
[docs/face-filters/](../face-filters/README.md)).

| # | document | answers |
|---|---|---|
| 1 | [PRD.md](PRD.md) | what the product is, what is shipped, built-but-off, decided, and deliberately not built |
| 2 | [TRD.md](TRD.md) | stack, hosting, providers, API conventions, security, CI, tests |
| 3 | [APP-FLOW.md](APP-FLOW.md) | phases, routes, navigation, every journey click by click, every failure path |
| 4 | [UI-UX.md](UI-UX.md) | look and feel, colour tokens, type, layout, components, motion, screens, copy, accessibility |
| 5 | [SCHEMA.md](SCHEMA.md) | auth flow, every table and relationship, key RPCs, cron, migration rules |
| 6 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | the build order from here, by track, with exit checks |
| — | [ISSUES.md](ISSUES.md) | defects and drift found in the 2026-10-02 audit |

Diagrams (Archify — open the `.html`; edit the `.json` and re-run
`archify deliver`):

| diagram | type |
|---|---|
| [system-architecture](diagrams/system-architecture.html) | architecture |
| [auth-flow](diagrams/auth-flow.html) | sequence |
| [job-lifecycle](diagrams/job-lifecycle.html) | lifecycle |
| [schema-map](diagrams/schema-map.html) | architecture (tables by domain) |

**Precedence when documents disagree:** `CLAUDE.md` → `docs/adr/` →
`CONTEXT.md` (vocabulary) → the SQL migrations (for schema) → these
documents → feature sets.

These describe the product as of 2026-10-02. When a PR changes what they say
is true, it updates them in the same change.
