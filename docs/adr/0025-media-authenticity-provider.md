# ADR-0025 — Media authenticity: provider, or no product

**Status:** Proposed 2026-09-18 · revised 2026-09-18 after research · **legal section incomplete, see §8**
**Blocks:** Track B of [docs/face-filters/PRD.md](../face-filters/PRD.md) (B1 image, B2 video, B3 voice)
**Related:** [ADR-0017](0017-c2pa-claims-withdrawn.md) (C2PA claims withdrawn), [ADR-0005 §5](0005-phase-0-business-preconditions.md) (EU AI Act Article 50), [ADR-0020](0020-kie-and-openrouter-providers.md) (adding a provider)

## 1. What changed since the first draft

The first draft of this ADR was written from assumption. Research corrected
three of its load-bearing claims, all in ways that matter:

| First draft said | Evidence says |
|---|---|
| Option B needs a vendor contract, "weeks" | **Four vendors are self-serve today.** Reality Defender $399/yr, Hive with $50 free credits, BitMind $100/mo, Resemble pay-as-you-go |
| Option C is out on cost | **Cost was never the barrier.** The best open detector is a 22M-param ViT that runs on CPU — ~$24/mo, or single-digit dollars on Cloudflare Containers inside the existing Workers plan |
| Detectors run 70–85% in the wild | **No commercial detector in an independent benchmark reaches 90%.** Several open-source models score at or below chance |
| Option D (read C2PA) is the honest alternative | **C2PA adoption is 0.067%** of images in the one hard measurement available. A reader alone answers "no data" essentially always |

The technical question is therefore settled and it is not the interesting one.
Any of these can be built cheaply, this week. The question is whether the output
is defensible.

## 2. Context

fal has no authenticity endpoint — verified twice, independently, against its
catalog API rather than its rendered site (`keywords=deepfake|ai detector|
classifier|authenticity|forensic` all return `total: 0`). Replicate and
OpenRouter have none either. Cloudflare Workers AI, which would have avoided a
new vendor entirely, has no detection model — its image classification is
ResNet-50 on ImageNet labels.

A verdict is also not an `assets` row. `assets` describes an R2 object with a
MIME type and a byte count; a verdict is a label, a confidence, and a model
version. It has nowhere to live in the current schema.

## 3. The reframe that shrinks the problem

**Veyrnox is the generator.** For any asset produced on this platform, the
`jobs` row and the ledger are a complete, exact, permanent provenance record —
which model, which prompt, which user, which second. No classifier, no vendor,
no decay, and 100% accurate by construction.

Detection is therefore only relevant to **media Veyrnox did not make**: the
third-party uploads the Track A work in `77e182b` now accepts. That is a much
narrower product than "deepfake analysis of video, audio and photos", and the
narrow version may be worth more than the broad one.

## 4. Options

- **A — Decline.** Track B is recorded as deliberately unbuilt.
- **B — Resell a detection API.** Self-serve vendor, a new provider entry, a new
  results table. Buildable in days.
- **C — Self-host an open detector.** MIT-licensed ViT on a Cloudflare
  Container. Cheap to run, expensive to keep working.
- **D — Read provenance, do not judge.** C2PA manifest plus IPTC/XMP/EXIF in one
  pass. Reports what a file discloses about itself; asserts nothing.
- **E — Publish our own provenance.** Make every Veyrnox asset verifiable from
  our own records. No detection at all.

## 5. Evidence

### 5.1 Accuracy — the precision/recall trap

NewsGuard (May 2026) tested five named commercial tools against 15 authentic,
unedited press photographs from Reuters, AP, NYT, the Guardian and Google Earth.
**13.3% of genuine press photographs were collectively declared AI-generated**;
the worst tool, 40%.

The same data contains the trap. Hive and Sightengine had **0% false positives
but caught only 73% and 33%** of significantly-altered images, and 27% of
lightly AI-edited ones. There is no threshold that gives both. The choice is
between accusing real people and reassuring the victims of fakes.

Deepfake-Eval-2024 (in-the-wild media, 88 sites, 52 languages) states plainly:
*"No commercial models that we evaluated had an accuracy of 90% or above."* Best
commercial results: video 0.78 acc / 0.79 AUC, audio 0.89 / 0.93, image 0.82 /
0.90 with **precision 0.99 and recall 0.71** — tuned against false alarms, and
therefore missing 29% of fakes. Open-source detectors lose ~45–50% of AUC moving
from their own benchmarks to real media; AASIST goes 1.00 → 0.43, worse than
chance.

Anything quoting "0.90 AUC" as "90% accurate" is wrong, and that error is how
this product gets mis-sold internally.

### 5.2 The errors are demographically skewed

Trinh & Liu (IJCAI-21): female Asian and female African faces are **1.5–3× more
likely to be wrongly labelled fake** than male Caucasian faces; 10.7 percentage
points between best and worst intersectional subgroup. The disparity concentrates
in **false positives against real faces** — the accusation direction.

Non-English audio runs 7.21 points lower accuracy than English even after
finetuning. Veyrnox serves EU users.

For a UK Ltd this is an Equality Act 2010 indirect-discrimination question, not
an ethics footnote. See §8.

### 5.3 It fails against anyone actually trying

Adversarial perturbation succeeds **>95%** against commercial detectors. The
detector works on adversaries who are not trying — which excludes the
sophisticated deepfakes that would justify the product.

### 5.4 Self-hosting decays faster than it can be maintained

Detectors learn generator-specific artefacts, so every new model release is
out-of-distribution by construction. TrueMedia.org — funded nonprofit, founded
by Oren Etzioni, 60,000+ items analysed — shut its detector down in January 2025
citing maintenance cost, open-sourced it under MIT, and **nobody has picked it
up**. Most video detectors are also licence-contaminated at the training-data
layer, because FaceForensics++ is non-commercial and flows downstream.

### 5.5 Provenance has the opposite problem: honest, but silent

C2PA reading is technically easy and verified working on this runtime:
`@trustnxt/c2pa-ts`, 260 KB gzipped, pure TS, Web Crypto, no Node builtins, and
a tamper test flips `isValid` correctly. Cloudflare removed the Worker bundle
limit on 2026-09-04 (now 64 MiB), so size is not a constraint.

But the one hard measurement puts adoption at **0.067%** of images. Midjourney
has never shipped C2PA. Instagram, Facebook, X and YouTube strip manifests on
re-encode. C2PA's own watermark-based recovery has 3 confirmed instances in
2.8M images scanned.

Two caveats in our favour: the library ships **no trust-list logic** and will
report `signingCredential.trusted` for a test certificate, so the trust list must
be pinned in KV or the claim is false. And adding IPTC `DigitalSourceType` and
EXIF to the same pass raises the hit rate to an estimated **5–15%** — inference,
not measurement — because Midjourney and Meta AI write IPTC without C2PA.

**fal joined the C2PA trust list in August 2026.** No document says which
endpoints sign. This is a ten-minute test — generate one image per model we ship
and run `c2patool` — and it is worth running before any decision, because our
delivery path is byte-preserving end to end (verified: no `sharp` import, no
`next/image`, no Cloudflare Images; `copyUrlToR2` streams verbatim and assets
reach the browser by presigned GET), so any manifest fal writes survives to the
user intact.

## 6. Trade-offs

| | A · Decline | B · Buy | C · Self-host | D · Provenance | E · Our own records |
|---|---|---|---|---|---|
| Build cost | zero | days | ~1 week | ~3 days | ~2 days |
| Run cost | zero | $399/yr–$0.006/img | ~$24/mo | negligible | zero |
| Accuracy of the claim | n/a | ~80%, skewed | worse | exact when present | **exact, always** |
| Answers "is this fake?" | no | badly | badly | 5–15% of the time | only for our own assets |
| Liability | none | **high** | **highest** | low | none |
| Decay | n/a | vendor's problem | ours, quarterly | none | none |

## 7. Recommendation

**E now. D alongside it if the fal test shows manifests. B only for a named
customer, and never as an unqualified verdict. C not at all.**

Engineering's opinion, which is not the decision:

**E is free and exact.** Every asset Veyrnox generates already has perfect
provenance in `jobs`. Exposing that — a verifiable page or signed record per
asset — is a real feature, costs nothing, cannot be wrong, and is the honest
version of what a customer asking for "authenticity" usually wants.

**D is cheap and honest but nearly silent.** Ship it only combined with IPTC/EXIF,
with the trust list pinned, and with the negative case worded so it cannot be
read as exoneration: *"this file carries no provenance metadata — most files
don't, and most platforms remove it."* A user who reads "no data" as "verified
human" is worse off than before we shipped.

**B is the product as originally described and it is buildable in an afternoon.**
That is exactly why it needs a decision rather than a sprint. At ~80% accuracy
with errors concentrated on women and darker-skinned subjects, an unqualified
verdict is a systematic harm with our name on it. If it ships, it ships as
"signals", never as a determination, with the vendor named and the confidence
shown — and only once §8 is complete.

**C is rejected** — not on cost, which was my error, but on maintenance. The best
funded organisation in this field quit rather than carry it.

## 8. Legal — INCOMPLETE, DO NOT ACCEPT THIS ADR UNTIL FILLED

Research on the following was still running when this revision was written, and
the session's search budget was exhausted, so what returns may be thin. These
questions must be answered before Option B is taken:

1. **UK defamation** — exposure for publishing an automated probabilistic
   assertion that media depicting a named person is manipulated. Does a ToS
   disclaimer protect the platform? All vendor terms are AS-IS with no accuracy
   warranty, and **none restricts showing verdicts to end users** — the liability
   sits entirely with us.
2. **EU AI Act Article 50** — what applies to a provider of a detection service,
   as distinct from a provider of generation tools. In-force dates.
3. **UK GDPR Article 22** — is a verdict about an identifiable person automated
   decision-making producing legal or similarly significant effects?
4. **Equality Act 2010** — does shipping a detector with the §5.2 measured
   disparity constitute indirect discrimination?
5. **Online Safety Act** — relevance to a detection service.

## 9. Open questions for the product owner

1. **Is there a named customer for Track B, or is it assumed?** This decides
   B versus A outright and nothing else in this ADR matters more.
2. Would Veyrnox publish a verdict about media depicting someone who is not the
   uploader? If no, the product is far narrower and far safer.
3. Does selling a face-swap tool and a swap detector from one brand help or hurt?
4. Run the fal `c2patool` test — it may make Option D substantially better, or
   rule it out, for ten minutes of work.
