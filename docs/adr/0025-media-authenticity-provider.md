# ADR-0025 — Media authenticity: provider, or no product

**Status:** Proposed 2026-09-18
**Blocks:** Track B of [docs/face-filters/PRD.md](../face-filters/PRD.md) (B1 image check, B2 video deepfake check, B3 voice clone check)
**Related:** [ADR-0017](0017-c2pa-claims-withdrawn.md) (C2PA claims withdrawn), [ADR-0005 §5](0005-phase-0-business-preconditions.md) (EU AI Act Article 50), [ADR-0020](0020-kie-and-openrouter-providers.md) (adding a second provider)

## 1. Context

The product owner asked for deepfake analysis of video, audio, and photos
alongside the face filters in Track A. Track A is an extension of the existing
money spine: a filter is a `model_catalog` row, priced in credits, submitted to
fal, stored in R2. Track B is not.

Three facts make it a separate decision:

**fal has nothing.** Searched fal's model index on 2026-09-18 for `deepfake`,
`ai detector`, and `classifier`. Zero results for authenticity or detection of
any kind. `fal-ai/moondream3-preview/detect` and the Florence-2 endpoints are
*object* detection — they find a dog in a photo, they do not judge whether the
photo was generated. There is no version of Track B that is a catalog row
against our existing provider.

**The output is not an asset.** Every job today ends with bytes in R2 and a row
in `assets`, which describes an object with a MIME type and a byte count. A
verdict is a label, a confidence, and the version of the model that produced
it. It has nowhere to live. `packages/db/schema/0001_initial.sql` has no column
for it and `jobs` has no result field.

**The claim is about a person.** "This video of X is 87% likely to be
synthetic" is an assertion about identifiable people, published by Veyrnox, on
the strength of a third party's model. Published detector accuracy is measured
on clean academic datasets. On re-compressed social uploads — which is what a
user will actually paste in — reported accuracy degrades substantially, and
degrades unevenly across skin tones and video codecs. We would be selling a
confident number whose real error rate we cannot state.

There is a fourth fact that is commercial rather than technical: Veyrnox would
be selling a face-swap tool and a face-swap detector from the same brand. That
is not automatically wrong — the security industry does it — but it is a
positioning decision the product owner has to make deliberately.

## 2. Options considered

### Option A — Do not build it

Track A ships. Track B is declined. The PRD keeps B1–B3 as recorded,
deliberately-unbuilt scope.

### Option B — Resell a detection API

Integrate one vendor (Reality Defender, Hive, Sensity, or similar) as a new
provider alongside fal, kie, and openrouter. A check becomes a job with a new
result shape and a new table. Priced in credits like everything else.

### Option C — Self-host an open detector

Run an open-source detector on our own inference. No vendor contract, no
per-call fee, full control of the model version.

### Option D — Provenance instead of detection

Do not judge whether media is fake. Read C2PA / Content Credentials manifests
where they exist and report what the file *claims* about itself, plainly, with
"no provenance data" as the common answer.

## 3. Decision drivers, ranked

1. **Truthfulness of the claim** — can we state an error rate we believe?
2. **Liability** — what happens when we are wrong about a named person?
3. **Fit with the money spine** — how much of the ledger, jobs, and webhook
   machinery survives?
4. **Time to first paying use** — Track A is not shipped yet.
5. **Ongoing cost** — per-call fees, or GPU spend, against credits charged.

## 4. Trade-offs

| | A · Decline | B · Resell a vendor | C · Self-host | D · Provenance only |
|---|---|---|---|---|
| Truthful claim | n/a | Vendor's number, not ours | Ours, and we own the measurement | Fully — reports a fact, not a guess |
| Liability | none | Shared in contract, ours in public | entirely ours | low — no accusation is made |
| Money spine fit | n/a | new provider, new webhook, new table | same, plus inference hosting | new table, no provider |
| Time | zero | weeks, plus contract | months | days |
| Cost | zero | per call, margin unknown until quoted | GPU, always on | negligible |
| Honest failure mode | — | confident wrong answers | confident wrong answers | "no data", frequently |

## 5. Recommendation

**Option D now, Option B only behind a named commercial reason.**

Engineering's view, which is not the decision:

Option D is the only one that ships a claim we can defend. Reading a C2PA
manifest and reporting it is a statement of fact — this file carries a
signed claim from this tool, or it carries nothing. Most files will carry
nothing, and saying so honestly is more useful to a user than a fabricated
percentage. It needs no vendor, no new provider adapter, and no webhook.

Option B is the product the owner actually described, and it is buildable, but
it should not start until there is a customer who has said what they would pay
for it. The engineering cost is a new provider adapter, a new signature scheme,
a new results table, and a UI that communicates uncertainty well enough not to
be defamatory. That is comparable to the entire Track A build, for a feature
with no verified demand.

Option C is out on cost and timeline for a pre-launch product.

Option A remains reasonable and is strictly better than shipping B badly.

Note that ADR-0017 already withdrew Veyrnox's own C2PA *output* claims. Option D
is the reverse direction — reading other people's provenance, not asserting our
own — so it does not reopen that decision. It should not be described in
marketing as anything more than manifest inspection.

## 6. Consequences

If **D** is taken:
- A new surface that accepts an upload and returns a provenance report. The
  Track A upload path (`/api/v1/uploads`, `lib/uploadSource.js`) is reused
  as-is.
- No new provider, no new webhook, no fal dependency.
- Public copy must say "provenance", never "detection", and the UI must state
  that absent provenance means nothing either way.
- Pricing: likely free or a token cost. It consumes no provider spend.

If **B** is taken:
- A new provider entry alongside `fal`, `kie`, `openrouter` in the
  `PROVIDERS` map, with its own signature verification, and an entry in
  `webhook_events` for idempotency.
- The `authenticity_checks` table sketched in
  [docs/face-filters/SCHEMA.md §5](../face-filters/SCHEMA.md), with RLS enabled
  and forced, explicit revokes, and `SET search_path = ''` on any function.
- Every verdict stores the detector version, so an old verdict can be
  re-assessed when the model changes.
- The UI must never render a bare percentage without the model's measured
  error rate beside it.
- Legal review before launch, not after. A wrong "synthetic" verdict about a
  real person is a defamation exposure that the ToS does not cover.

If **A** is taken:
- PRD §4 Track B is marked declined, with this ADR cited.

## 7. Open questions

1. Is there a named customer for Track B, or is it a feature we assume is
   wanted? This decides B versus A outright.
2. Would Veyrnox publish a verdict about media depicting a person who is not
   the uploader? If no, the product is much narrower and much safer.
3. Does selling a face-swap tool and a swap detector from one brand help or
   hurt? Ownership call.
4. If B: is the vendor contract's accuracy claim something we can repeat to
   users, or is it marketing we would be laundering?
