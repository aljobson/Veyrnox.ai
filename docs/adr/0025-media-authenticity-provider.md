# ADR-0025 — Media authenticity: provider, or no product

**Status:** Proposed 2026-09-18 · revised 2026-09-18 after research (technical + legal)
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

## 8. Legal

Researched 2026-09-18. Research, not legal advice; several items below are
explicitly unverified and marked. The largest finding is in §8.1 and it is not
about Track B.

### 8.1 The upload path is the biggest criminal exposure, and it is already merged

**This is a Track A finding, not Track B.** Accepting arbitrary uploads means
receiving CSAM, and under **Protection of Children Act 1978 s.1(1)(a)** it is an
offence to "make" an indecent photograph **or pseudo-photograph** of a child.
On settled English authority, downloading or copying to a server is "making",
and "pseudo-photograph" expressly captures AI-generated material. Simple
possession is separately an offence under **CJA 1988 s.160**. Extreme
pornography is **CJIA 2008 s.63**.

The only relevant defence is **s.1B(1)(a)** — necessary for the prevention,
detection or investigation of crime — with the legal burden on us. The statutory
carve-outs name the Security Service, SIS, GCHQ and Ofcom. **A commercial vendor
is not on that list.**

This is triggered by `/api/v1/uploads` accepting a file. It is independent of
every model-accuracy question in this ADR, it applies whether or not Track B is
ever built, and it is live the moment Slice 6 ships an upload UI.

**Highest-value question for counsel:** does the CPS/NPCC Memorandum of
Understanding on the s.1B and s.160 defences — under which IWF analysts operate
— extend to a commercial operator? Not answered by this research.

Mitigation to scope before any public upload path: hash-matching against a
known-CSAM database at ingest, a documented reporting route, retention minimised,
and no human review of raw uploads without a defined legal basis. Note Ofcom's
18 May 2026 statement recommends hash matching equivalent to StopNCII.org — a
**different technology from AI classification**, and the one regulators actually
ask for.

### 8.2 Defamation — s.5 and s.10 are both unavailable to us

**s.5 (website operators) does not apply.** s.5(2) requires showing the operator
did not post the statement. A verdict is *our own statement*, authored by our
system. **s.10 does not apply** — it protects those who are not author, editor
or publisher, and we are all three.

The **UK Jurisdiction Taskforce Legal Statement on Liability for AI Harms**
(7 July 2026, not binding but the most authoritative English source) holds that
businesses deploying AI to publish content are "most likely liable as commercial
publishers", and — directly load-bearing — that **"several common defences will
not be available for wholly AI-generated statements without human review."**

**A bare confidence score is the paradigm bare comment.** *Corbyn v Millett*
treats comment with no indicated factual basis as a factual allegation, so
"87%" with no explanation fails s.3(2) by construction. s.3(5) also sits badly
with a machine: a non-human cannot hold an honest opinion, so the opinion must
be ours, which requires us to believe an output we know the error rate of.

**A ToS disclaimer does not protect us from the depicted person** — privity;
they never agreed to it. For consumers, CRA 2015 s.62 makes a blanket exclusion
a strong candidate for unfairness. A disclaimer *does* do real work on
**meaning** (*Charleston* bane-and-antidote), but the antidote must genuinely
neutralise.

**s.4 public interest is the best defence available** and s.4(5) applies it
irrespective of fact or opinion — it sidesteps the whole problem. Its vulnerable
limb is *reasonable belief*, which turns on validation, calibration, documented
limitations and human review. **The same engineering discipline satisfies s.4,
the FTC substantiation standard, and the GDPR accuracy principle.**

Exposure scales with **republication**, not with the first verdict: a verdict
seen by one paying user is published but unlikely to clear the s.1 serious-harm
threshold (*Lachaux*) on its own.

### 8.3 EU AI Act — outside Article 50, at risk under Annex III

**The timeline moved.** Regulation (EU) 2026/1744 ("Digital Omnibus on AI", in
force 27 July 2026) did **not** delay Article 50 — live since **2 August 2026** —
but pushed Annex III high-risk to **2 December 2027**.

**A pure detector is outside Article 50 in all four limbs**, per the Commission's
Guidelines C(2026) 5054 of 20 July 2026: 50(1) needs bidirectional interaction
and expressly excludes backend systems where the user only sees output; 50(2) is
a *generation* obligation and the Guidelines treat detectors as compliance
infrastructure *for* obligated providers; 50(3) and 50(4) are not engaged.
**Caveat: no source squarely answers "is a standalone detection SaaS in scope of
Art 50" — this is well-supported inference, not a citable holding.**

Two ways we would lose that:
- **Adding a chatbot or "ask our AI about this result" panel** engages 50(1),
  which is in force now. The obviousness exception is to be read restrictively.
- **An LLM-written explanation of a verdict** is AI-generated text we provide, so
  50(2) arguably attaches to it. Cheap mitigation: template-driven explanations,
  not generative ones — which is also better for §8.2 and for explainability.

**The real exposure is Annex III point 6(c)** — systems used by or for law
enforcement "to evaluate the reliability of evidence". Commentary on the
classification guidelines has this limb expressly capturing AI that assesses the
authenticity of digital evidence. "87% likely AI-generated" is the paradigm case,
not an edge case. **The trigger is intended purpose, established from technical
documentation *and marketing materials* — our website copy is a regulatory
instrument.** Art 25(2) provides an escape if we clearly specify the system is
not to be used that way.

**Annex III point 1(a)** turns on one architectural choice: matching a face
against *our own* reference gallery is remote biometric identification and is
high-risk; taking the identity assertion from the uploader and comparing
one-to-one is verification, which is excluded.

### 8.4 UK GDPR — the verdict is the depicted person's personal data

*Nowak* (C-434/16) forecloses the "it's only a probability" argument: personal
data covers "not only objective but also subjective information, in the form of
opinions and assessments", and relates to a person by content, purpose **or**
effect. The depicted person is identified, never contracted with us, and has
Article 15 rights — including over our audit logs of who ran which query.

**Article 9 has a purpose filter and we can engineer to stay outside it.** Both
the EDPB (Guidelines 3/2019) and the ICO (biometric guidance, March 2024) read
"for the purpose of uniquely identifying" as a real gate: biometric
*classification* needs only Art 6; biometric *recognition* needs Art 6 + Art 9.
A detector reading compression artefacts and frequency-domain fingerprints —
never building or matching a face template — processes biometric data that is
not special-category biometric data. **Same decision as §8.3.**

Note the UK diverged: DUAA 2025 s.80 replaced Art 22 with Arts 22A–22D from
5 February 2026, and solely automated decisions are now permitted by default
subject to safeguards. EU Art 22 is unchanged, so **build to the EU standard.**

An **EU representative is almost certainly required** (Art 27) — the derogation
fails on three independent grounds. Put them in Germany, where the data is.

### 8.5 Equality Act 2010

The §5.2 measured disparity is the live risk. Where a neutral practice puts
people with a protected characteristic at a particular disadvantage without
objective justification, that is indirect discrimination **regardless of intent
and regardless of whether a human or an algorithm decided**. *R (Bridges) v CC
South Wales Police* is the warning shot: the Court of Appeal found a PSED breach
for **failing to investigate** whether facial recognition software was biased —
**proof of actual bias was not required**. We already have the evidence that
bias exists in this class of tool, which removes any "we didn't know" position.

### 8.6 Enforcement precedent exists, and it is directly on point

**FTC v. Workado** — final order 28 August 2025, vote 3-0. An AI *detection*
vendor advertised "98% accurate"; the figure came from a model validated on
academic text and sold as general-purpose, where it scored **53%** — "no better
than a coin toss". Order: no efficacy claim without competent and reliable
evidence *at the time the claim is made*, evidence retained, annual compliance
reports for four years.

**FTC v. IntelliVision** (final order 13 January 2025) bars misrepresenting
accuracy **and comparative performance across genders, ethnicities and skin
tones** — which is precisely the §5.2 disclosure we would owe.

**FTC v. Evolv** (November 2024): false-negative and false-positive rates are
themselves claims.

In the UK, **DMCCA 2024** has given the CMA direct administrative enforcement
since 6 April 2025 with penalties to **10% of global turnover** — the power
exists for this and has not yet been used on AI accuracy claims. The ASA upheld
a complaint against **Glow Up LLC t/a Maxxing** (2 September 2026), an AI app
that scans faces and returns scores, on evidence grounds — the nearest UK
analogue, and it went against the advertiser.

**No regulatory action or litigation against any deepfake-detection vendor was
found** — but the researcher marks this "not found", not "does not exist", as
the search budget ran out.

### 8.7 Online Safety Act — out of scope, conditionally

If a user uploads media and only that user sees it and the verdict, this is not
a user-to-user service. **But s.3(2)(a) makes the test capability, not use**: a
dormant share button, a guessable permalink or a multi-seat team workspace makes
us a regulated service even if nobody shares anything. The compliance posture is
**no sharing functionality at all**, not "we don't expect sharing".

s.179 false communications is **not** a realistic risk — it needs actual
knowledge of falsity plus intent to cause harm.

Note the "internal business services" exemption (Sch 1 paras 7/8) does **not**
cover B2B SaaS; it requires the customer to be the provider of the service.

### 8.8 Unverified — do not rely on without checking

The researcher flagged that no EUR-Lex primary text could be retrieved (every
fetch returned a JavaScript shell), so all AI Act quotations are from the
Commission's guidance and secondary sources. Also unverified: the "2 February
2027 watermark interoperability" date, the 6%/€5m AI Office fine figure, and
whether the high-risk classification guidelines are final. There is **no case
law or regulatory guidance anywhere on AI-generated-media detection
specifically** — every conclusion in §8.4 is analogical from credit scoring and
facial recognition.

## 9. Open questions for the product owner

1. **Is there a named customer for Track B, or is it assumed?** This decides
   B versus A outright and nothing else in this ADR matters more.
2. Would Veyrnox publish a verdict about media depicting someone who is not the
   uploader? If no, the product is far narrower and far safer.
3. Does selling a face-swap tool and a swap detector from one brand help or hurt?
4. Run the fal `c2patool` test — it may make Option D substantially better, or
   rule it out, for ten minutes of work.
