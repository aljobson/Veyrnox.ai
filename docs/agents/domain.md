# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is single-context:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── README.md
│   ├── 0000-product-strategy.md
│   └── ...
├── app/
├── components/
├── lib/
└── packages/
```

Create standalone `docs/adr/NNNN-kebab-title.md` ADRs at the next free number after checking main and open PRs, with a first `#` heading and a `Status:` line. Do not edit the frozen `docs/adr/README.md` or `index-baseline.txt`. Read the complete index with `node scripts/adr-index.mjs` from the repository root, or list `docs/adr/`; filenames distinguish amendments and repeated numbers.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0013 (credit expiry policy), but worth reopening because…_
