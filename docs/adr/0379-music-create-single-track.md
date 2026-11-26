# Music Create generates one track per confirmed quote (ADR-0379)

Status: Accepted and implemented 2026-11-26 by the owner request to stop creating two versions. The release remains subject to the normal CI, review and production-deployment gates.

## Context

Music Create historically bought and displayed two independent A/B candidates for every new song. Under the Crun Suno contract in ADR-0376 that meant two supplier tasks, two ledger debits, an 8-Credit list price, and two independently refundable outputs. The product now presents a deliberate Create Music form with direct Voice, Genre, Mood, Tempo and Song structure controls. The owner chose one polished result instead of two automatic alternatives.

## Decision

1. A newly confirmed Music Create quote has `output_count=1`. It creates one request, one candidate, one job, one provider dispatch and at most one ledger debit. The public compatibility RPC remains named `music_submit_pair` until a later contract migration; its new-create behavior is single-track.
2. The quote list price is one catalog unit. For the current Crun Suno offer that is 4 Credits, not the former 8-Credit pair. A daily allowance can reserve and consume at most one candidate for the quote. A paid cancellation or provider failure refunds that one debit; a free failure returns that one allowance claim.
3. Existing requests keep their stored `output_count`. Historical two-output generations remain A/B and retain their independent state and refund truth. New one-output generations are labelled `Track`. Edit, extend and remix operations that explicitly promise alternatives keep their separate two-output contracts.
4. Migration 0619 expands the stored constraint to accept both 1 and 2, freezes new Crun and fal song-create quotes to 1, and replaces only the create submission/projection functions needed for the new contract. It also raises the verified Crun Suno duration ceiling to 360 seconds.
5. Smart Direction is additive user input. It must never shorten a saved prompt or style field to make its generated suffix fit. When the field has no remaining capacity, the selection is refused with a visible instruction to shorten the field. Genre, Mood, Tempo and Song structure never change the Instrumental or vocal setting; only an explicit Voice choice may do that.

## Consequences

- A normal paid Crun creation spends 4 Credits and incurs one supplier task instead of 8 Credits and two tasks.
- The user receives one result and one player, with no synthetic “Version A / Version B” choice.
- Idempotency, provider admission, allowance reconciliation, cancellation and privacy export now prove exactly one new-create job while historical pairs remain readable.
- The UI must state the one-track price before confirmation. Any future return to multiple automatic variants requires a new owner decision and ADR because it changes both spend and refund behavior.

## Verification

The fully replayed database acceptance suite proves quote totals, one dispatch, one allowance claim, replay isolation, cancellation and insufficient-balance behavior. Web and mobile contract tests prove one-track language and data-preserving Smart Direction behavior. The running web form is driven through every Smart Direction control and verified to render one Track result.
