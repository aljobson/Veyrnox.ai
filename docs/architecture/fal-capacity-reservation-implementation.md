# Durable-image capacity reservations — first implementation slice

The owner confirmed staging and production use separate fal accounts on
9 October 2026. Each database can therefore hold its own account policy; this
does not establish that every producer within an environment uses the pool.
The [proposed design in PR 755](https://github.com/aljobson/Veyrnox.ai/pull/755)
remains the broader rollout plan.

Migration `0238_fal_admission_capacity` replaces durable-image admission with
one transaction that serializes the user's balance, checks equal replay, locks
the local capacity policy, and commits debit/free claim, job, outbox and capacity
reservation together. The policy ships disabled, with no provider account
assigned. Merging does not apply the migration or enable live admission.

The initial policy bounds are at most two outstanding reservations, ten new
jobs per UTC admission day and 300,000 USD micro-units ($0.30) of assumed provider
exposure. Each eligible FLUX.2 Pro admission reserves 30,000 micro-units ($0.03),
and the catalog must still record that cost. The transaction pins 1024×768 into
the stored provider payload and only accepts prompt/seed from its caller.
The endpoint's one-output behavior and actual billing must be reverified before
activation; a catalog price and reservation counter are not a provider billing
guarantee. No unsupported quantity field is added to the fal payload.

Only the policy's selected model and `fal-ai/flux-2-pro` endpoint can make new
reserved admissions. Equal replay returns its existing job before checking the
paused/full policy, including legacy intents with their original payload shape.
Conflicting inputs/payloads still return conflict. A full or disabled policy
returns typed retryable 503 before any new money or allowance effect. Lost
admission acknowledgement remains `dispatch_acceptance_unknown`, requiring
same-key replay rather than a replacement key.

## Conservative release and retention

`release_fal_capacity` only updates reservation rows. It never locks or changes
jobs, balances or the pool policy, preventing a reverse lock edge against the
existing refund paths. Its bounded pass also runs before a new admission checks
capacity. Multiple concurrent passes release an eligible reservation once.

Eligible evidence is definitive dispatch REJECTED, CLOSED with no attempt token,
or ACCEPTED plus matching fal handle and STORED job state. UNKNOWN, STARTED,
accepted provider-queued work, SUCCEEDED awaiting storage and FAILED/refunded
work without definitive rejection stay held. The first slice deliberately waits
for STORED rather than adding a new verified provider-terminal receipt protocol.
Verified callback failures and orphan reservations need a later audited terminal
resolution path; there is no override, timeout release or provider resubmission.

Release preserves the daily admission/exposure totals, even for pre-claim closure
or rejection. This is stricter than the proposed return-unused-budget behavior.
Old unreserved READY/STARTED/UNKNOWN and unresolved ACCEPTED intents count against
the outstanding admission bound rather than being silently grandfathered away.
Deleting an outbox row nulls the reservation's job reference but retains its cost
and any unresolved occupancy. A parent deletion cannot reset the spend ceiling.

The new tables have forced RLS, no browser grants and no application-role writes;
service-role RPCs own admission and release. Provider keys, prompts and signed
asset URLs are absent from capacity records. Policy assignment/activation requires
a reviewed owner-approved configuration change; no live setter is added here.

## Validation and remaining gates

Validation ran against a disposable localhost Postgres 17 database, rebuilt from
all 224 migration files. CI repeats the replay and acceptance on Postgres 16.
The acceptance script tests different-user admission races, equal/conflicting
replay at full/paused capacity, the final daily budget unit, the independent daily
count limit, paid/free rollback injection, free allowance accounting, UNKNOWN
after refund and UTC-day rollover, older unreserved work, duplicate release,
STORED evidence, refunded ACCEPTED work, pre-claim closure, orphan retention,
forced RLS and browser denial. The existing dispatch acceptance suite is run
before this suite; each removes only its own synthetic outbox fixtures.

Legacy direct submissions and Auto Short steps remain outside this reservation
transaction. The independent admission pause covering those paths is not built
by this slice. Claim fencing and existing cron recovery are preserved; old
committed work is not disabled by applying a default-deny admission policy.
Do not activate production or describe this as an account-wide limit until the
other producers and rollback behavior are covered and tested.

Live migration application, policy acceptance/assignment, a further bounded
staging sample, provider billing verification, the reviewed health window and
sustained-capacity evidence remain separate rollout steps. This implementation
does not purchase credits, generate media or change any live dispatch flag.
