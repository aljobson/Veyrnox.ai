# Veyrnox.ai design context

Next.js / React / Tailwind v3. Dark by default, light via the existing theme toggle. Tokens are defined in `app/globals.css`, mapped in `tailwind.config.js`; use the `vx` token classes so both themes work.

Reuse `AppNav`, `Button`, `Modal`, and `Chip` from `app/veyrnox/_components`. Archivo is the studio typeface; JetBrains Mono supplies small labels. Aqua indicates actions; amber is reserved for money. Use compact layouts, pill buttons, and rounded bordered sections.

Projects uses a workspace selector, searchable list, restrained empty state, and native dialog. Catalog search considered Project Empty State, Project Selector and Workspaces; existing primitives fit the product without adding dependencies. New project screens remain behind `localStorage.veyrnox_projects=1` pending release gates in CLAUDE.md. APIs enforce authorization independently.
