# fal callback and storage failure validation

The callback route is the next recovery boundary after the deployed queue acknowledgement exercise in PR #771. These checks invoke the actual route, signature verification and R2 copy code with a generated Ed25519 fixture key and isolated network responses. They make no live provider, database or storage requests and do not change any deployment.

| Failure | Required local observation | Evidence |
| --- | --- | --- |
| Callback before handle mapping | 409 before inbox consumption; mapped redelivery stores once; terminal duplicate has no storage effect | Existing signed callback test |
| Job lookup outage | 500 before inbox consumption | Existing lookup test |
| Source download outage | 500 with SUCCEEDED job and unfinished inbox; redelivery stores once | Existing source test |
| R2 PUT outage | 500 before registration; retry uses the same object key and stores once | Added R2 write test |
| Registration outage before commit | Object already copied; 500 with unfinished inbox; retry overwrites the same key and registers once | Added registration test |
| Registration commits but acknowledgement is lost | First response 500 with STORED job; redelivery completes inbox without another copy or asset registration | Added lost acknowledgement test |

The fixture job lookup now respects state filters. This matters when registration has committed: a STORED job must not be returned by a SUCCEEDED-only query. Otherwise a mock can incorrectly permit another storage copy on redelivery.

Run `node --test tests/falCallbackRecovery.test.mjs tests/falWebhook.test.mjs tests/falWebhookSignature.test.mjs tests/r2Copy.test.mjs`. Record the result with the PR revision.

These are local failure tests, not deployed staging acceptance or proof of fal redelivery. Before closing the rollout gate, exercise the deployed callback/storage boundary against dedicated staging fixtures with an expiring allowlist and controlled dependencies, retaining normal public signature enforcement. Record delivery status, inbox processing time, job state, deterministic object key, asset count and ledger reconciliation. Any live generation needs a bounded provider budget. Do not replace fal trust keys, expose an unsigned callback endpoint, reset terminal jobs or remove financial evidence.

Admission transaction failures, provider transport uncertainty, sustained capacity measurements and the clean monitoring window remain separate requirements. Production activation remains pending their reviewed evidence.

## Isolated handler boundary

`lib/falWebhookHandler.js` exports `createFalWebhookHandler`. The public route constructs it with no overrides, using the real fal verifier and configured database/storage adapters. Request headers and payloads cannot select exercise dependencies. The extracted handler retains the Auto Short fallback.

An operator exercise can construct a separate handler with instance-local RPC, HTTP, storage-copy and verification dependencies without changing global fetch, process environment or public trust keys. Deployment code must constrain fixture identity and staging origin before invoking it; this factory itself is not a staging authorization guard. Never wire request data into the factory or export an exercise endpoint from the public application.

The added tests verify independent handler instances and reject an unsigned public request before any I/O. This prepares the deployed controlled exercise; no exercise worker has been deployed by this change, and the deployed callback/storage gate remains open.
