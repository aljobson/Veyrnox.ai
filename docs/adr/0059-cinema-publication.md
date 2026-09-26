# ADR-0059 — Social Cinema publication: review queue, public catalogue, player

- **Status**: Accepted 2026-09-26 (owner: "build the publication slice", review queue and full viewer pages chosen). Built with migration 0147.
- **Related**: [ADR-0050](0050-cinema-private-content-drafts.md) (drafts), [ADR-0052](0052-cinema-stream-upload-preview.md) (uploads, signed URLs, CSP), [ADR-0049](0049-cinema-creator-onboarding.md) (the administrator review gate this reuses), [ADR-0057](0057-cinema-viewer-paywall.md) (Unlocks, Pass, playback, reversal), `CONTEXT.md` (Social Cinema publishing).

## Context

Every earlier Cinema slice stopped at "nothing is published": drafts were private, uploads encoded without publishing, and the paywall priced content no viewer could see. ADR-0050 left publication open because it needs a moderation decision. Two readings were possible: creators publish directly with takedown after the fact, or a review queue before anything goes public. The owner chose the queue.

## Decision

1. **A title is the unit of publication.** A FILM, SHORT, TRAILER or SERIES root is submitted, reviewed, published, withdrawn or suspended as one; seasons and episodes follow their root. A submission requires a finished Stream upload for the film or for every episode, at least one episode for a series, and a versioned **Rights Declaration** whose wording the client must echo exactly, as Supply Consent does.
2. **UNDER_REVIEW locks editing.** The lifecycle is DRAFT → UNDER_REVIEW → PUBLISHED, with rejection returning to DRAFT and a creator-visible note, and SUSPENDED as a terminal state the creator cannot edit or resubmit. `save_cinema_draft` already refuses anything but DRAFT.
3. **The review gate is the creator-application gate.** Queue, decision and suspension need a verified identity, a second factor satisfied within five minutes and a Cloudflare Access assertion at the route, and every RPC re-checks the active Cinema administrator role. Self-review is refused. Decisions and takedowns are append-only audit rows keyed on the actor's idempotency key.
4. **Taking a title out of Social Cinema refunds its viewers.** A creator withdrawal or an administrator suspension of a published title calls `reverse_cinema_unlocks` for every playable item, in the same transaction, and records what it reversed. This is ADR-0057 §5 made automatic; a human still decides. "Takedown" in the glossary is the generation-side action from ADR-0058; the Cinema words are Withdrawal and Suspension.
5. **Public reads carry nothing private.** The catalogue and title reads expose the creator's public name, the title's own fields, durations, and, for a signed-in viewer, what they may do with each episode via `cinema_entitlement`. Anonymous reads live outside `/api/v1`, are cached for a minute per URL and never see an identity; signed-in reads go through the middleware and are never cached. Titles whose creator's Cinema account is not active disappear from both.
6. **The player is Stream's iframe.** `/social-cinema/watch/<id>` mints the ADR-0057 playback token and embeds `https://customer-<code>.cloudflarestream.com/<token>/iframe`, renewing before the 15-minute expiry and sending a 30-second heartbeat while visible. CSP `frame-src` gains `https://*.cloudflarestream.com` and nothing else; ADR-0052's rule that a new host needs a documented change is honoured here.
7. **Two switches, both off.** `CINEMA_PUBLISHING_ENABLED` (creator submission and the administrator queue, a child of content) and `CINEMA_VIEWING_ENABLED` (the public reads and pages, a child of the master only, so viewing can open without profiles).

## Considered options

- **Creators publish directly.** Less to build; anything uploaded is public until noticed. Rejected by the owner for a first launch.
- **Reviewer preview playback.** Reviewers would watch before approving. Deferred: playback tokens are minted only for entitled viewers of published content, and a reviewer path needs its own entitlement rule. The queue shows durations and disclosures; the first reviews will use the creator's own uploads out of band.
- **A per-episode publication.** Rejected: ReelShort's model and the paywall's free-episode rule both assume a whole series is visible at once.

## Consequences

- Before either switch is turned on: the Rights Declaration wording and the withdrawal and suspension copy need legal sign-off; Cloudflare Access must front `/app/admin/cinema/submissions`; the Stream signing key, customer code and the ADR-0057 preconditions still apply for playback and payment.
- The middleware does not gate `/api/cinema/*`. Those two routes are read-only, flag-gated, cached, and take no identity; adding anything else under that prefix needs the same care.
- Suspension is terminal for the creator by design; reinstatement is an Operator SQL action until a route exists.
- `cinema_content` rows now carry `rights_version`, `rights_at`, `submitted_at`, `published_at`, `closed_at` and `review_note`; the creator's own listing reports them and whether each item's video is ready.

## Addendum 2026-09-26 — Categories (0148)

A title carries one or two Categories from a fixed list held in `cinema_categories` (romance, drama, thriller, comedy, horror, sci-fi, fantasy, action, mystery, documentary, animation, kids). The creator picks them on the draft; submission refuses a title without one (`category_required`); seasons and episodes carry none. The public catalogue read takes an optional Category and returns the list alongside the titles, so the Social Cinema page shows category tabs. The list grows by migration, never from the app layer, and the JavaScript mirror in `lib/cinema/domain.js` only labels the picker. Considered and rejected: free-form tags (no browsable structure, moderation burden) and per-episode categories (a series is one shelf).
