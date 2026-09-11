# ADR-0007 — Legacy Muapi proxy deprecation

- **Status**: Proposed (2026-09-11)
- **Date**: 2026-09-11
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0000 — Product strategy](0000-product-strategy.md), `CLAUDE.md` HARD WALL

## Context

`app/api/v1/[[...path]]/route.js` is a catch-all proxy that forwards every request to `https://api.muapi.ai`. It reads the caller's `__Host-muapi_key` cookie and injects it as `Authorization: Bearer …`. This is the last surviving piece of the "MuAPI-reseller/bring-your-own-key" era.

Two forces make this route awkward today:

1. **ADR-0000 chose the Hybrid path via Reseller-first**, but Phase 1 shipped `/api/v1/generations` as a *direct* fal.ai adapter. The legacy `/api/v1/[[...path]]/*` catch-all sits alongside it and can shadow-match the new route depending on Next.js path-priority rules — a genuine footgun, not just aesthetic clutter.
2. **CLAUDE.md HARD WALL** says Veyrnox.ai and the legacy Muapi studio are separate products. Every request the catch-all serves is a request the new product would rather not own — no ledger entry, no moderation gate, no margin capture, and the user's own MuAPI key does the paying.

There is no known first-party client of this route in the current app tree. We do not have telemetry on outside callers.

## Options considered

### A. Delete immediately

Remove `app/api/v1/[[...path]]/route.js` and the `MUAPI_BASE_URL` / cookie code in the same commit.

- Effort: ~1 hour.
- Blast radius: any external client still pointing at the old path gets a Next.js default 404. No `Sunset` signal, no warning.
- Reversibility: trivial — restore the file from git.
- Risk: unknown. If any real user still relies on it, they discover the removal by breakage.

### B. Return `410 Gone` with `Sunset:` header, two-week grace window

Replace the proxy body with a hand-written 410 response carrying `Sunset: <date>`, `Deprecation: true`, and a `Link: <url>; rel="deprecation"` header pointing at this ADR (or a short public note). After the sunset date, delete the route.

- Effort: ~2 hours now + ~30 minutes to delete on the sunset date.
- Blast radius: same as (A) at the sunset date, but callers get 14 days of clear signal in server logs before things break. Compliant with RFC 8594 (Sunset header) and RFC 9745 (Deprecation header).
- Reversibility: trivial.
- Risk: low. Two weeks is a reasonable "if you're out there, speak up" window.

### C. Rename to `/legacy/v1/*` with a hard EOL date

Move the route to `/legacy/v1/[[...path]]/route.js`, redirect `/api/v1/[[...path]]/*` there with a 308, and document a hard end-of-life date (e.g. 90 days out). Callers get a URL that names the reality; internal routes never collide with the legacy shape again.

- Effort: ~half a day (rename, redirect, ToS/docs note).
- Blast radius: none up front — every existing caller keeps working with a permanent redirect. Blast comes at EOL, same as (A)/(B), but with a longer warning window.
- Reversibility: trivial.
- Risk: the longer we keep it alive, the longer the HARD WALL has a hole in it — every `/legacy/v1/*` request bills a MuAPI account, not a Veyrnox one. Nothing about a rename fixes that revenue leak.

## Trade-offs

| Driver / Option | A. Delete now | B. 410 + 14-day grace | C. Rename + 90-day EOL |
|---|---|---|---|
| Effort | 1h | 2h + 30m | ~4h |
| Time to full removal | today | +14d | +90d |
| Signal to callers | none | Sunset header | 308 redirect |
| Confusion with new `/api/v1/generations` | Gone today | Gone today | Persists 90d |
| HARD WALL exposure window | Gone today | +14d | +90d |
| Reversibility | trivial | trivial | trivial |

## Recommendation

**Option B — 410 Gone with a two-week Sunset window.**

One-line reason: the HARD WALL says these are separate products, so the legacy proxy is a liability we want gone quickly; 410 gives outside callers a clear, standard signal for 14 days without paying the coordination cost of a 90-day rename.

Two implementation notes for whoever executes:

- The 410 body should be short JSON (`{"error":"gone","sunset":"YYYY-MM-DD","docs":"…"}`) so any programmatic caller can log something useful.
- On the sunset date, delete the route file *and* the `muapi_key` cookie plumbing in `app/api/session/muapi/` in the same commit — leaving the cookie handler alive after the route is gone is dead code that will confuse future readers.

## Decision

_To be completed by Al._

## Consequences (if B is accepted)

- Any external tool still pointing at `api.veyrnox.ai/v1/*` (or wherever the app is deployed) breaks after the sunset date. Acceptable given the HARD WALL.
- Two-week window is short enough that we don't need a public deprecation announcement — server logs will show the affected callers, if any.
- Removing the cookie code closes the last surface where a user's own MuAPI key touched this repo. That is a meaningful reduction in the "which product am I?" ambiguity flagged in the audit.

## Open questions

- Do server logs show any real traffic on `/api/v1/[[...path]]/*` today that is not first-party? If yes, the 14-day window may need extending. If no, Option A is defensible.
- Is there a public URL where the deprecation note should live, or is the ADR itself enough for the `Link:` header target?
