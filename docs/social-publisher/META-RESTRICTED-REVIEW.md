# Restricted Facebook and Instagram Publishing review

Local preparation only. No deployment, activation, Meta configuration change or resubmission performed.

Use the existing veyrnox.ai/app/publish flow. A server-only exception opens Facebook
and Instagram connection, consent callback, connected-account readiness and post
admission for exact middleware-verified Supabase Auth UUIDs. It does not depend on
an invitation URL, client input, email suffix or a brand owner's allowlisted identity.
It does not enable other extended networks. Normal plans, Page selection, brand
permissions, OAuth state, rate limits, token encryption and media validation remain.
Scheduling continues through the same plan entitlement and delivery engine.

## Future configuration — requires separate authorization
- Keep production PUBLISH_RELEASED_NETWORKS unchanged: youtube,linkedin,twitter,tiktok.
- Keep the general extended-network gate unchanged.
- PUBLIC_HOST must be https://veyrnox.ai and PUBLISH_ENABLED must be true.
- Set server-only META_REVIEW_AUTH_IDS to explicitly authorized review-user UUIDs.
  No UUIDs have been selected or installed by this change. Never use NEXT_PUBLIC.
- Set META_REVIEW_ENABLED=true only after separately approving deployment/activation.
  Missing/false flag or empty/malformed allowlist fails closed.
- Verify the production Meta app credentials, existing provider-approved callbacks,
  media transport, Meta tester eligibility and each review account's Publish Plan.
  This path does not grant Meta advanced permissions or bypass provider approval.
- Verify allowlisted user: Connect both providers, actual consent return, Facebook
  Page selection, matching connected identities and composer destinations.
- Verify ordinary user: Coming soon for both; direct connect/callback/post requests
  stay rejected. Recheck brand switching does not inherit owner review access.
- Obtain separate approval for exact public test posts. Capture full login/consent,
  Post now and scheduled publication through to matching Facebook/Instagram posts.
  A queued or scheduled status alone is insufficient evidence.

## Revocation
Disable META_REVIEW_ENABLED or remove the UUID to block new connections, callbacks
and post admission. Previously admitted scheduled posts continue through the normal
engine; deliberately cancel those before retiring the review period if necessary.
This is an admission gate, not retroactive queue cancellation. Public Meta release
requires a separate decision after approval. Do not submit Request again as part
of preparing or activating this path.

## Local verification
Focused tests cover reviewer versus ordinary identities, exact opt-in, host binding,
both Meta networks, configuration readiness, post admission and unchanged media rules.
On 29 October, local browser checks passed using actual Publishing/connect/callback
components with synthetic authentication, database and provider responses: reviewer
controls, Facebook Page choice, Instagram return, both custom-time schedules, Post now,
past-time rejection, ordinary-user blocking, disabled-review blocking and Free-plan
scheduling restrictions. This is not a live provider or full Next middleware pass.
66 focused route/regression tests passed, including reviewer-only admission through
the real post writer for both platforms and both publishing modes. The public release
list remains unchanged. No dependency installation or deployment was performed.
Live provider consent and actual scheduled delivery on veyrnox.ai remain unverified
until separately authorized deployment/activation and exact test posts. Local fixture
screens must not be used as Meta review screencasts.
