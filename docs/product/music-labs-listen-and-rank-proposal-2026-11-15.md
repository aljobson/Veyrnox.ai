# Music Labs and listen-and-rank: proposal (2026-11-15)

Status: proposal for the owner's decision. Nothing here is built.
Parity items: S-U2 (earn credits by listening and ranking) and S-U3 (Labs) in
`docs/product/suno-music-parity-spec.md`.

## 1. What Suno offers

- **Labs**: a page of small experiments (a genre wheel, listen-and-rank, a tiny sequencer).
- **Listen-and-rank**: you hear two short clips, pick the better one, and earn
  credits for a batch of rankings. The rankings feed the model makers.

## 2. Recommendation

1. **Build Labs now as a page with no credits.** Start with two experiments that
   reuse what exists: the genre wheel (a spin picks a style, then opens Create
   with that style filled in) and the beat editor's step sequencer (already
   built, #2264). Cost: about one day. Risk: low. No money, no new tables.
2. **Build listen-and-rank without a credit reward first.** Pairs come from
   published tracks. A ranking feeds Explore ("Best of", #2271) and For You,
   which is useful on its own, and it shows whether people come back.
3. **Pay credits for ranking only after an ADR and two weeks of unpaid data.**
   Paying is where the risk is (section 3). The data tells us how many rankings
   a real person makes, so the caps can be set from evidence.

## 3. Why credits for ranking are risky

A credit is about $0.015 of provider spend. Anything that grants credits for an
action a script can repeat is a faucet. Signup credits needed Confirm email,
migration 0071 and Turnstile before they were safe. Ranking is easier to script
than signing up.

| Abuse | Control that would be required |
|---|---|
| A script clicks "A" forever | Each pair must be fully played (server-signed play token, minimum listen time per clip), and the answer must arrive after the clips' length. |
| Many accounts | Grant only to confirmed, non-frozen accounts older than 7 days with at least one paid purchase or subscription, or cap every other account at 0. |
| Answers are noise | Seed known-answer pairs (a clip against silence or a clipped copy); a wrong answer on a seed voids the batch. |
| Grant size | A low daily cap (for example 5 credits a day, 30 a month), granted per completed batch of 10, never per click. |

Every grant would go through `ledger_grant` with an idempotency key per batch,
never a raw ledger write, and would be refunded nowhere because nothing is
debited. `reconcile_balances()` must stay at zero. Account deletion must erase
the rankings (classified in `scripts/test-account-deletion.mjs` and the privacy
export).

## 4. Rights

Pairs must come only from published tracks whose creators agreed to have them
heard in rankings. Today's publication attestation does not cover that. Either
add an `allow_ranking` choice to publishing (off by default), or rank only
Veyrnox's own generated sample clips. Ranking data must not be sold or shared
with model makers without a separate owner decision and a Terms update.

## 5. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| L1 | Build a Labs page with no credits now? | Yes: genre wheel and the beat editor sequencer. |
| L2 | Build unpaid listen-and-rank? | Yes, after L4 is settled; it feeds Best of and For You. |
| L3 | Pay credits for ranking at all? | Not before an ADR and two weeks of unpaid data. |
| L4 | Which tracks can be ranked? | Only tracks whose creator opted in (`allow_ranking`), or Veyrnox sample clips. |
| L5 | May ranking data leave Veyrnox? | No, unless a later decision and a Terms update say so. |

## 6. Rough size if approved

| Slice | Size |
|---|---|
| Labs page with genre wheel and sequencer link | about 1 day |
| Unpaid listen-and-rank (pairs, signed play tokens, rankings table, Explore feed) | about 3 days, one migration, one flag |
| Paid rewards (ADR, caps, seed pairs, `ledger_grant` path, acceptance tests) | about 3 days after the ADR |
