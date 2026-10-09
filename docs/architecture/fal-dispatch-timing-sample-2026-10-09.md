# Bounded staging fal timing sample — 2026-10-09

Ten owner-approved FLUX.2 Pro jobs completed through staging durable dispatch,
provider callbacks and storage. All ten jobs reached `STORED`; all dispatch
rows reached `ACCEPTED`, with distinct attempt tokens. This supplies successful
handler timing evidence for the [capacity review](fal-dispatch-capacity-readiness.md).
Production queue activation remains blocked on its outstanding gates.

## Scope and execution

The approved limit was ten images, at most two committed jobs in flight,
twenty staging credits and approximately $0.30 provider usage. No credit
purchase or production activation was authorized or performed. The normal
authenticated Create UI was used, with one single job, four pairs and a final
single job; each group completed before the next was admitted.

Model `flux-2-pro` maps to `fal-ai/flux-2-pro`. The adapter sends prompt and
optional seed, relying on the provider's `landscape_4_3` image-size default.
The [provider API documentation](https://fal.ai/models/fal-ai/flux-2-pro/api)
still lists that default. The code assumes 1024×768 and one output per job;
these are payload/default assumptions, not dimensions independently measured
from stored files. The sample did not send an explicit 1024-square size.
No uploaded media was used.

Admissions ran from 17:38:34.633150 to 17:42:06.188878 UTC. The final
database read at 2026-10-09 17:42:52.637503+00 confirmed all ten stored outcomes,
one ledger debit of two credits per job, and balance 826 → 806.
The Library displayed all ten new outputs as DONE and 21 total assets.

## Measured timings

Durations below are seconds except where milliseconds are specified.
Database intervals use `jobs.created_at` as admission, dispatch
`started_at` as claim and `resolved_at` as accepted evidence. Storage uses
`jobs.updated_at` observed while the job was STORED; it is not a separate
immutable storage-event timestamp.

| Measure | Samples | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Admission → claim | 10 | 3.561 s | 1.851 s | 4.879 s |
| Admission → accepted evidence | 10 | 3.855 s | 2.267 s | 5.195 s |
| Admission → observed STORED update | 10 | 13.412 s | 12.614 s | 16.171 s |
| Consumer function elapsed | 10 | 768.5 ms | 403 ms | 1,062 ms |
| Platform invocation wall time | 10 | 770.5 ms | 408 ms | 1,069 ms |

Ten consumer tail records each reported platform outcome `ok`, no exceptions,
one submission, and zero failed, retried or ignored items. Batch size was one.
The ten batches made forty dispatch RPCs:

| RPC | Calls | Median batch total | Minimum batch total | Maximum batch total |
| --- | ---: | ---: | ---: | ---: |
| `recover_fal_dispatch` | 20 | 304 ms | 166 ms | 558 ms |
| `claim_fal_dispatch` | 10 | 85 ms | 69 ms | 212 ms |
| `record_fal_dispatch` | 10 | 89 ms | 80 ms | 239 ms |

Recovery totals combine initial and post-attempt calls within each batch.
They cannot establish an individual recovery-call latency distribution.
Consumer elapsed includes submission and database waits, excluding queue
scheduling and callback/storage work.

### Job trace

| Staging job | Claim delay | Accepted delay | STORED update delay |
| --- | ---: | ---: | ---: |
| `ed9c492a-4ef1-48f3-bfd6-d820b5ae5d79` | 1.851 s | 2.267 s | 12.942 s |
| `b79e02ba-9145-4ecd-8487-1322e1428818` | 2.401 s | 2.818 s | 15.084 s |
| `9ed95655-1ce6-42b4-87f3-ddf30c03a313` | 3.567 s | 3.956 s | 13.497 s |
| `ce67f70e-fa71-4002-aded-4cf86f28fde1` | 3.994 s | 4.153 s | 12.614 s |
| `a6c00a77-93bc-4d4f-9b90-f160e0932747` | 4.722 s | 4.875 s | 15.039 s |
| `eb7648f9-ccea-4488-ae60-f7f105c60e38` | 4.879 s | 5.195 s | 14.447 s |
| `b614b8ee-c67a-4205-a77e-dfa75b93c206` | 3.556 s | 3.948 s | 12.917 s |
| `d1d161fa-69a9-4b23-8e94-97cb062df92c` | 2.838 s | 3.165 s | 13.327 s |
| `60d320af-70c9-4ded-8df3-4cbee5e4da2c` | 3.639 s | 3.763 s | 16.171 s |
| `2f2046e0-6004-4234-9a1f-b1c542a474d5` | 2.680 s | 3.038 s | 13.110 s |

## Cost and provider headroom

The twenty-credit staging budget was fully used, with exactly one debit per
job and no refund or duplicate ledger entry. No further jobs were admitted.

Chrome's owner-designated fal account showed a concurrency limit of ten,
zero active requests before and after the sample, and a 30-day peak of two.
These are account snapshots, not a reservation for this application's future
accepted-running work.

The observed account balance changed from $5.58 before the sample to $4.98
afterwards. This $0.60 account-wide decrease is not isolated sample billing.
The current billing-cycle usage table lists thirteen FLUX.2 Pro processed
megapixels, $0.03 per unit and $0.39 total, alongside usage from other models.
At the expected one billed megapixel per job, the sample cost is $0.30, but a
per-request billing export was not captured to independently reconcile that
estimate. Do not report the balance difference as ten-image cost.

## Restoration and health

Only staging flags were temporarily enabled, with other bindings inherited.
After the final STORED result:

| Service | Enabled version | Restored disabled version |
| --- | --- | --- |
| Staging app | `3cfa112d-8b86-46a3-b9bc-1091f225ff65` | `9311a5c0-fbb2-4e93-bc75-6578c5e4d38a` |
| Staging dispatch consumer | `7284b03b-2dee-4c30-b746-fa193638ba7d` | `ded6799a-956c-494c-93a7-7e6e063912cc` |

Read-back confirmed app durable-dispatch and queue flags false, consumer flag
false, and both schema flags still true. Source queue and DLQ peeks returned
empty. All recovery counters were zero with no unhealthy tasks; all five
reconciliation drift counters were zero at the final database read.
Production configuration was untouched.

## Limits and next gate

Every observed admission-to-claim delay was below the proposed ten-second
bound. Ten successful, lightly paced samples do not establish a robust p95,
sustained drain, eligible READY contention, duplicate amplification under load,
or accepted-running capacity under mixed models. No concurrency increase or
broader admission is justified by this sample alone.

The earliest review of the restarted clean recovery window remains
2026-10-10 16:41 London, conditional on continuous recovery and reconciliation
health. These point-in-time checks do not prove a continuous 24-hour window.
Production still requires that evidence and a workload-specific capacity and
cost review before an explicitly authorized activation.
