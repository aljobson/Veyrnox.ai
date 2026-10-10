# One-image signed provider retry evidence

The owner explicitly approved deploying and running PR #800 after green CI and staging account/headroom checks, bounded to one FLUX.2 Pro image, two staging credits and approximately $0.03 of fal usage. The live exercise passed on 2026-10-10 using source commit `feb0a07a1e89f4cbe3a804865961067e8360d443`. No production activation or credit purchase occurred.

## Preflight and identity

[CI run 38040004318](https://github.com/aljobson/Veyrnox.ai/actions/runs/38040004318) passed, including eight Workers-runtime tests. [Staging health run 38041018871](https://github.com/aljobson/Veyrnox.ai/actions/runs/38041018871) passed before fixture admission. Database dispatches and held reservations were zero; capacity policy remained disabled.

Agent Reach's OpenCLI Chrome backend read the logged-in aljobson fal account. Its request history contained the existing staging provider handle `01a1225e-323d-7032-91e4-7f32d375ab39`, matching staging database evidence. Account headroom was zero active requests against a limit of ten, with $4.24 available. The relay pinned the account identifier read from the account profile; no API key or existing application tenant secret was retrieved. The existing application's signature verifier subsequently accepted the forwarded callback independently.

Dedicated fixture job: `22ae92d1-e388-417a-b3a3-84f6ee50680c`. Provider request: `01a1251f-452d-7dc1-bbc0-41c51f3eb53a`. Dedicated model `signed-retry-fixture-90f6c5a8` was inactive before provisioning committed. Application schema recovery was paused only during the exercise; ordinary admission, queue publication and outcome activation remained disabled.

## Observed transport

Exactly one job reference was published to the real staging queue. The consumer logged one submitted job, zero failed/retried/ignored jobs, one claim RPC and one record RPC. Its database dispatch retained a single attempt token and ACCEPTED provider handle, with projection recorded at `09:22:49.387845Z`.

| UTC timestamp | Observed evidence |
| --- | --- |
| 09:22:55.469 | First callback received; real Ed25519/JWKS and tenant verification passed, persisted mapping matched, and `REJECT_ONCE` was logged at 09:22:55.771. This code branch returns deliberate 503 before application invocation. |
| 09:22:56.447 | Separate provider callback received; real signature verification passed again and `FORWARD` was logged at 09:22:56.598. |
| 09:22:58.270 | Application inbox event processed. |
| 09:22:58.356 | Native staging application service binding returned 200, recorded by the relay. |

The two ingress timestamps were 978 milliseconds apart. No operator replay or fabricated signature was sent. Counts-only tails retained IDs, decisions, timestamps and application response status; callback bytes and signature headers were not retained. The 503 is established by the verified `REJECT_ONCE` decision and its fixed return branch; an independent provider dashboard delivery-status export is not included.

## Stored and financial result

The job reached STORED, correlated to the same ACCEPTED dispatch/provider handle. Database evidence contains one processed fal inbox event and one asset row: JPEG, 105346 bytes, SHA-256 populated, with a deterministic provider-scoped object key. One original debit of two credits remains, no refund exists, and the fresh fixture balance is eight. Normal `release_fal_capacity(25)` released exactly one reservation with reason STORED at `09:24:04.400151Z`; its recorded cost was 30000 micro-USD.

The fal billing dashboard changed from $4.24 to $4.21 credit balance, total period cost from $39.20 to $39.23, and FLUX.2 Pro usage from 15/$0.45 to 16/$0.48 processed megapixels/cost. These matching aggregate deltas support the bounded $0.03 charge; they are not a per-request invoice export.

An independent object HEAD and authenticated Library inspection were not measured. The fixture identity had no supported browser session; another user's session was not borrowed. The asset row and STORED state establish the application's successful storage path, without claiming those additional checks.

## Restoration

The ordinary consumer was redeployed from its standard entry point with its complete original variables and secret bindings. Temporary approval/job/user/model/expiry variables and the cross-script DO binding were removed. Complete application and consumer binding arrays, plaintext variables and cron schedules matched the captured baseline. Final versions were:

- Application: `d0cfb885-54ce-4dbc-9499-5a0d296c6dd0`, schema recovery restored true; other activation flags remain false.
- Consumer: `1fb329cf-a013-4da9-abce-9739cdf31b4d`, queue consumer disabled.
- Dedicated relay: `3a33d745-09e2-49cf-b80d-22bed7f36052`, plan disabled; workers.dev and preview exposure both false. Its SQLite namespace and immutable ID/fault record are retained.

An initial relay upload used a non-ISO expiry value; it failed the expiry guard and could accept no test callback. It was replaced with an ISO timestamp before consumer deployment or queue publication. The enabled relay version used for the actual exercise was `ef648312-33f7-4d78-b56e-571a21e4a3c3`; the exercise consumer was `512a03f3-fdd9-4853-9aef-1b9059a0b15f`.

[Final health run 38041323437](https://github.com/aljobson/Veyrnox.ai/actions/runs/38041323437) passed: primary and dead-letter queue approximate backlog zero, all thirteen recovery counts zero, no unhealthy tasks, all five reconciliation drift counts zero. Direct database verification found zero held reservations, zero READY/STARTED/UNKNOWN dispatches, disabled capacity policy and an inactive fixture model. Financial rows and stored asset evidence remain.

This establishes one real signed provider retry through the deployed staging application. Sustained throughput, terminal callback deduplication under live repeated success deliveries, a 24-hour clean window and production-account headroom remain separate gates. Production and staging use separate fal accounts; this evidence does not authorize production activation.
