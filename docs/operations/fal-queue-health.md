# Staging fal queue diagnostic

Owner: the staging operator. This complements the database [recovery health
monitor](recovery-health.md): Cloudflare dead-letter arrivals and queue backlog
can require attention even when a Worker invocation has platform `outcome=ok`.

Run `fal-queue-health-staging` manually from Actions on the current `main`.
The `fal-dispatch-staging` environment requires owner approval and supplies its
existing `CLOUDFLARE_API_TOKEN`. The job checks the current main revision before
passing that secret to the diagnostic. It requires no Supabase or fal secret,
dependency installation, deployment, or feature flag change.

The script uses only GET queue metadata and GET queue metrics for the fixed
staging account and its two queue IDs. A separate monitoring token can use
account-scoped **Queues Read**. The existing protected deployment token also
has sufficient access. See Cloudflare's [Get Queue Metrics API](https://developers.cloudflare.com/api/resources/queues/methods/get_metrics/).
No messages are read, leased, acknowledged, purged, published or redriven.

| Exit | Meaning | Operator action |
| --- | --- | --- |
| 0 | No threshold breached in the metrics snapshot | Continue acceptance checks; this does not prove continuous health |
| 1 | Any DLQ backlog, or source backlog with oldest age at least 300 seconds | Investigate queue delivery and database dispatch evidence |
| 2 | Missing token, access/transport failure, malformed metrics, wrong queue identity, or unknown source backlog age | Restore visibility; do not interpret missing monitoring as healthy |

The five-minute source threshold is an initial staging investigation threshold,
not a measured latency percentile or production SLO. Cloudflare describes these
metrics as best effort and approximate. Its oldest timestamp is zero when
unknown; positive source backlog with that value fails closed. Empty backlog
with a zero timestamp is valid. DLQ backlog remains actionable without an age.
Clock skew up to five seconds is tolerated; larger future timestamps are unreadable.
Results across the two queues are independent snapshots, not a transaction.

Output contains only fixed queue names, counts, ages and static diagnostic text.
API error bodies and transport exception details are suppressed. If one queue
is unreadable, the other queue's incident remains in the report and exit 2
identifies incomplete monitoring. The redacted report appears in the Actions
log and job summary.

During triage, inspect `generation.dispatch_queue_batch` application fields
(`ok`, `retried`, `failed`, `ignored`, `submitted`) alongside database UNKNOWN
and overdue counts. Platform invocation success alone cannot establish dispatch
success. Respect the immutable STARTED attempt fence: never reset an UNKNOWN
attempt, automatically resubmit provider work, purge references or mutate the
ledger as a response to this diagnostic. Reconcile provider acceptance and
stored assets before deciding whether a reference needs operator action.

This workflow has no schedule, issue creation or paging integration. Scheduled
coverage, an operator notification destination and tested alert delivery remain
rollout gates. A manual clean snapshot does not satisfy the 24-hour clean
reconciliation requirement or authorize production activation.
