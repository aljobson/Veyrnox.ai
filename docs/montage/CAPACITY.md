# Video agent: capacity design for gate G6 (written and decided 2026-10-08)

Answers [RUNBOOK-production.md](RUNBOOK-production.md) gate G6: "queue, more machines, or a waiting message". Background:
[ADR-0074](../adr/0074-openmontage-video-agent.md), [SPEC](SPEC.md). Checked against main at `efe273e8`, the runner repo at `daf6867`
and the staging runner's live settings (read 2026-10-08 20:30 UTC).

**Updated 2026-10-08 21:45 UTC:** section 5 holds what the machine measured over four real runs, and records that the staging
runner moved to 2 dedicated CPUs and 8 GB at 21:35 UTC. Where sections 1 and 4 speak of the shared machine, section 5 is the later
word. An earlier version of section 5 said the shared machine sustains "about 4 runs an hour"; that was the worst case, not the rule.

## Decision (owner, 2026-10-08: "approve")

What was put to the owner and approved:

1. **A busy runner is refused before the debit**: "nothing was charged, try again". On main since #651.
2. **Capacity is added when a measured trigger is hit**, not before.
3. **No queue yet.** A queue turns refusals into waits and adds no throughput.
4. The trigger as proposed: two or more runs started within one hour, on three days out of seven. It was worked out for **one slot**.

### What changed while the proposal was being read

The proposal described one slot, which was true when it was written. Since then:

- **The runner takes three runs at once**, not one (runner `096aaae`, 19:04 UTC; `RUNNER_MAX_CONCURRENT = "3"` on staging). Its own
  comment says "a starting guess: not load-tested". This is the cheap step this design would take first anyway (more on one machine
  before more machines), and it needs no routing. It moves the trigger in point 4: with three slots the same rule gives a different
  number. **That number was proposed here and is withdrawn:** it will be set from the first three-at-once run on the new machine (section 5).
- #651 also limits each account to one video in the making at a time.
- #652 and runner `daf6867` close the hole this design found: a start that was never confirmed is now cancelled before the refund, and
  a cancel that reaches the runner before its run is remembered, so the run is refused.

## 1. Use cases and constraints

### In scope

- **User** approves a plan while a slot is free, and the run starts at once.
- **User** approves a plan while every slot is taken, and is told so without being charged.
- **Service** frees a slot when a run finishes, fails, is cancelled or hangs.
- **Service** never holds credits for work that has not started.
- **Service** leaves enough of a record to decide capacity from numbers.

### Out of scope

- Priority between users, or paying to skip the line.
- Making a run faster or cheaper (gates G1 and G3).
- Brief moderation (G5), alert destinations (G7), more than one region.

### Constraints the code and the rules already set

- Every debit has a refund path, the ledger is append-only, and one plan buys one run (the idempotency key comes from the plan).
- `sweep_stuck_jobs` refunds any job still `DEBITED` after **15 minutes** (migration 0099). A job cannot wait in that state for longer.
- A run is never retried: each one spends up to its ceiling (`lib/montage.js`).
- The runner keeps its runs **in memory, per machine** (`runner/runs.py`). `/status`, `/cancel` and replay detection only know the
  runs on the machine that answers.
- The runner address is a constant, every call is signed, and a new Worker secret means the secret-edit procedure.
- A change to the money path needs an ADR update, an acceptance test and a flag.

### Measured

| Fact | Value | Source |
|---|---|---|
| Time per run, approve to stored | 215 to 317 s over four stored runs (245 s for the first, running alone) | staging `jobs`; SPEC sections 6 and 9 |
| Runs at once per machine | **3** on staging since runner `096aaae` (was 1). Not load-tested | staging runner settings |
| Machines | 1: 2 dedicated CPUs and 8 GB since 2026-10-08 21:35 UTC (before that, 4 shared CPUs and 4 GB) | staging runner settings |
| Runner's own limit on a run | 30 minutes | runner `fly.toml`, `RUNNER_RUN_TIMEOUT_SECONDS` |
| Worker's lost-run refund | 45 minutes | `lib/montage.js`, `TIMEOUT_MINUTES` |
| Idle machine exits after | 10 minutes; the next signed request starts it | runner `fly.toml` |
| Worker waits for the runner | 20 s per call | `lib/montageRuntime.js` |
| Most a run can spend | $2.50 at fal and $2 of tokens; $13.50 with three in flight | runner `fly.toml` |
| Price | 165 credits, $5.45 at the $0.033 floor value | SPEC pricing worksheet |
| Plan ticket lifetime | 30 minutes | SPEC section 4a |
| A refusal after the debit (the old path, still the fallback) | refunded in 21 s; two ledger rows and a failed job in the Library | SPEC section 9 |

### Assumptions (demand is unknown before launch)

- Approvals arrive independently of each other. A launch post makes bursts worse than that, so the figures below are floors.
- The busiest hour carries 15% of a day's approvals.
- A refused user does not retry at once. Retries raise the load further.
- **A run takes 245 s whether it runs alone or beside two others.** One pair has been measured: 244 s and 317 s (section 5). How
  heavy the cut is matters as much as the company a run keeps.

### Usage

One slot finishes at most 3600 / 245 = **14.7 runs an hour**. Offered load = approvals per hour x 245 / 3600. A slot is one run in
progress, wherever it runs. Share of approvals refused in the busiest hour (Erlang B, refused requests are lost):

| Approvals in the busiest hour | About per day | 1 slot | 2 slots | 3 slots |
|---|---|---|---|---|
| 1 | 7 | 6% | 0.2% | under 0.1% |
| 4 | 27 | 21% | 2.8% | 0.3% |
| 10 | 67 | 40% | 12% | 2.7% |
| 15 | 100 | 51% | 20% | 6.5% |

Load that keeps refusals under 10% in the busiest hour, **where the machine has the CPU and memory for it**
(section 5):

| Slots | If a run takes 245 s | If sharing the machine doubles it to 490 s |
|---|---|---|
| 1 | 1.6 approvals an hour, about 11 a day | 0.8 an hour, about 5 a day |
| 3 | **18.7 an hour, about 124 a day** | 9.3 an hour, about 62 a day |
| 6 | 55 an hour, about 368 a day | 28 an hour, about 184 a day |

What a queue would do on one slot instead (mean wait before the run starts, fixed run time): 46 s at 4 an hour, 4.3 minutes at 10 an
hour, 16 minutes at 13 an hour, without limit at 14.7. The tail is several times the mean.

Money: a refusal before the debit costs nothing. A lost sale forgoes 165 credits against a cost of up to $2.72. Machine time is a few
cents a run (runbook). The real cost of another slot is exposure: each one is another $2.50 and $2 that can be in flight at the same time.

## 2. High-level design: refuse before the debit

```mermaid
sequenceDiagram
    participant P as Page
    participant W as Worker (generations route)
    participant D as Postgres
    participant R as Runner (one machine, 3 slots)
    P->>W: Approve (plan ticket, idempotency key)
    W->>W: check the ticket
    W->>D: replay of this key? a video already in the making?
    W->>R: POST /status (signed)
    alt every slot taken, or no answer
        R-->>W: busy true
        W-->>P: 409 video_agent_busy + Retry-After (nothing charged)
    else a slot is free
        R-->>W: busy false
        W->>D: ledger_debit (job DEBITED)
        W->>R: POST /run
        R-->>W: 202
        W->>D: step SUBMITTED
        R->>W: signed callbacks (upload_url, completed or failed)
        W->>D: job STORED, or FAILED and ledger_refund
    end
```

This is what main does since #651. The `/status` arrow is there because of one number: with one slot, 6% to 40% of approvals met a
busy runner (table above), and each of those was a debit, a failed job and a refund.

## 3. Core components

### Use case: every slot is taken

1. The page sends Approve with the plan ticket and the key the ticket names.
2. The route checks the ticket (`checkPlan` in `lib/montageGate.js`).
3. `checkCapacity` looks for a job with this user and key. If one exists this is a replay: the remaining checks are skipped and
   `ledger_debit` answers it as the replay it is.
4. It looks for a video this account already has in the making (`DEBITED` or `SUBMITTED`). If there is one:
   `409 {error: "video_agent_in_progress"}`.
5. It calls the runner's `/status`. The runner answers `{busy, active, max}` from its table of live threads.
6. Busy: `409 {error: "video_agent_busy", retry_after_seconds: 120}` with a `Retry-After` header. No job row and no ledger row.
7. No answer, or a malformed one: `503 {error: "video_agent_offline"}`. Nothing charged.
8. The page shows the message. Pressing Approve again works with the same ticket for its 30 minutes.

No schema change. The part that is not obvious: **check then act is not atomic.** Two approvals can both read `busy: false` for the
last slot. The loser's `/run` gets `429 montage_busy` and falls through to the old path: debit, fail, cancel, refund.
The window is the time between `/status` and `/run`. Accepted.

### Use case: a slot is freed

| Event | What frees the slot | When |
|---|---|---|
| Run completes or fails | its thread ends; `/status` counts one fewer | at once |
| Worker cancels | `/cancel` sets the run's stop flag | seconds |
| Run hangs | the runner stops the agent and reports `timeout` | **30 minutes**; the Worker's sweep refunds at 45 if no report arrives |
| Machine dies | the in-memory table is gone; all slots free on restart | on restart; every run it held is refunded by the sweep at 45 minutes |

With three slots a hung run costs a third of the capacity for up to 30 minutes. With one it refused everyone. A machine death now
ends up to three runs at once: three refunds, and fal bills the clips that finished.

### Use case: the service leaves a record

Started runs are `jobs` rows, so runs started per hour can be read today with no new code. A refusal before the debit leaves no row.

## 4. Scale the design

One change at a time, each only when its trigger is seen. The rule behind every trigger is the same: **add capacity when the
busiest hour refuses more than 10% of approvals on three days out of seven.** Until refusals are counted, it is read from runs started.

| Stage | State | Trigger (evidence) | Change | What it costs |
|---|---|---|---|---|
| 0 | replaced by #651 | n/a | Refuse after the debit | A debit, a failed Library entry and a refund per busy approval |
| 1 | **on main** (#651) | The first table in section 1 | Refuse before the debit | No fairness: whoever presses first wins. The user must come back. A fixed 120 s hint against 245 s runs |
| 2a | **on staging**, on 2 dedicated CPUs and 8 GB since 21:35 UTC (runner `096aaae`, `0e7477f`); three at once not yet tried | With one slot: two or more runs started within one hour, on three days out of seven (the approved trigger) | Three runs on the one machine | Runs share the machine's CPUs and memory (section 5). $13.50 in flight at once. Up to nine fal clips and three agent sessions in parallel. One machine death ends three runs |
| 2b | not built | To be set from the first three-at-once run on the new machine (section 5). The earlier proposal of 17 or more runs started within one hour is withdrawn | A bigger machine first, then machines addressed one by one, see below | A list of machine ids to keep current. More in flight at once. Needs G8 |
| 3 | not built | 2b is in place, refusals are still above 10% in short bursts, and the machines are idle most of the day. Or users must be able to leave the page | A bounded line, see below | Credits held for work not started, or a debit that can fail later. New states in the money path. ADR, acceptance tests, a 24-hour reconcile soak |

### Small improvements inside stage 1

1. Done (#652, runner `daf6867`): a start that was not confirmed is cancelled before the refund, and the runner remembers a cancel that
   arrives before its run.
2. Have `/status` report how long each live run has been going, so the hint is honest: 245 s minus the oldest run's age, never under 30 s.
3. Let the page retry by itself while the tab is open and the ticket is valid.
4. Count refusals (reason: busy, offline, lost the race), so lost sales are known and not estimated.

### Stage 2b: why a second machine is not `fly scale count 2`

With two machines behind Fly's proxy and the runner as it is:

- `/status` answers for whichever machine the proxy picks. "Free" on one says nothing about the other, and `/run` may land on the other.
- `/cancel` on the wrong machine does not stop the run. Since runner `daf6867` that machine remembers the cancel for 15 minutes, which
  does nothing for a run already going elsewhere. The Worker refunds and the run keeps spending.
- The proxy cannot see a busy machine: `/run` answers 202 at once, so its request limits do not help.

```mermaid
flowchart TD
    P[Page] --> W[Worker: generations route]
    W -->|status, run, cancel: one named machine| A[Runner machine A, 3 slots]
    W --> B[Runner machine B, 3 slots]
    W --> D[(Postgres: jobs, job_steps with the machine id, ledger)]
    A -->|signed callbacks| H[Worker: webhook]
    B --> H
    H --> D
    A --> S[(R2: final.mp4)]
    B --> S
```

Design: the Worker names the machine. A Worker var lists the machine ids. The capacity check asks each in turn with Fly's
`fly-force-instance-id` request header (Fly's dynamic request routing: it forces one machine, with no fallback) and takes the first that
is free. `/run` goes to that machine, the id is stored with the step, and `/cancel` and the sweep use it. Needs a column for the id
(a migration), the runner returning its own id, and a test that a cancel reaches the right machine. To check on Fly first: that a forced
request starts a stopped machine.

Rejected for now: a machine per job through Fly's Machines API (ADR-0074's first sketch). It scales further but puts a Fly API token in
the Worker. A fixed pool needs no new secret.

### Stage 3: what a queue would need

- A place to wait that is not `DEBITED` (the stuck-job sweep refunds at 15 minutes), or a place in line with the debit taken only when
  the slot opens (then the balance or the 30-minute ticket can fail at that moment).
- A dispatcher on the completion callback, with the five-minute cron as the fallback.
- A bounded depth. Past it, refuse as in stage 1. An unbounded queue is the failure, not the fix.
- Position and an estimate for the user, and a cancel-while-waiting with its refund.

## 5. What the machine measured, and the move to dedicated CPUs

Read from Fly's own metrics for the staging runner. No run was made for this section.

**Corrected 2026-10-08 21:45 UTC.** The first version of this section rested on one run and treated its 220 CPU-seconds as typical.
It said the shared machine sustains "about 4 runs an hour" and predicted that two runs at once would take 16 minutes. Three more real
runs finished the same evening. Two of them overlapped, and they finished in 4 and 5 minutes with nothing throttled. The first run was
the heaviest of the four, not the typical one. The owner's choice below was made on that first version.

### Four real runs on the shared machine

| Job (start, UTC) | Ran | Approve to stored | CPU-seconds | Peak memory | Burst balance |
|---|---|---|---|---|---|
| `647470d0` (18:00) | alone | 245 s | 220 | 1,371 MB | 200 down to 42 |
| `2ce20f09` and `83a9b016` (21:20, 5 s apart) | together | 244 s and 317 s | 100 for the pair | 1,304 MB | 226 down to 214 |
| `9e4b021a` (21:29) | alone | 215 s | 107 | 2,003 MB | 259 down to 210 |

The machine idles at about 320 MB. So a run needs **50 to 220 CPU-seconds** (about 107 on average over the four) and **1.0 to 1.7 GB**.
Nearly all the CPU is the cut at the end; the first minutes wait on fal at under 0.2 CPUs. None of the four was throttled.

### How a shared machine's CPU is rationed

From Fly's "CPU performance" page and the machine's own metrics:

- Its sustained quota is **0.25 of one CPU** for the whole machine (`fly_instance_cpu_baseline` read 0.25).
- Above that it spends a burst balance. The balance earns 0.25 CPU-seconds per second the machine is up (measured: 149 in 600 idle
  seconds), earns nothing while the machine is stopped, and starts at about 200 after a deploy (seen five times). Highest seen: 853.
- At zero, the machine is held to 0.25 CPUs until the balance recovers.

### What that meant for three slots on the shared machine

- **Sustained ceiling: 0.25 x 3600 / CPU-seconds per run.** 4 runs an hour if every run is as heavy as the first, about 8 at the
  average of the four, 18 if all are light. Not the 14.7 an hour per slot of section 1, and not a flat 4 either.
- **Memory was the nearer limit.** Three runs like `9e4b021a` at the same moment need about 5.4 GB. The machine had 4 GB (3.9 usable).
- **Heavy cuts landing together** were the CPU risk. If every run is as heavy as the first (a one-second simulation that reproduces
  that run, 232 s against 245 s):

| Case, every run as heavy as `647470d0` | Balance at the start | Last run finishes after |
|---|---|---|
| One run right behind another | 50 | 11 minutes |
| Two at once | 200 | 16 minutes (the measured pair, which was light, took 5.3) |
| Three at once, after a deploy | 200 | 30.5 minutes: past the runner's 30-minute limit, with about $7 already spent at fal |
| Three at once | 650 or more | 5 minutes |

These rows are arithmetic for the worst case, not tests. One run in four was that heavy.

### The three-at-once test was not run

The owner gave a go for it while the runner was on the shared machine. It needs three signed-in accounts (one video per account at a
time); staging has three with 165 credits or more, and signing in is the owner's. On the shared machine its likeliest failure was memory.

### The options put to the owner

| Option | Effect | What it costs |
|---|---|---|
| A. Dedicated CPUs: a Fly `performance` size (full quota, no balance) | About 32 runs an hour by CPU even if every run is heavy. Three heavy cuts at once finish in about 7.6 minutes | $0.030 of machine time a run on `performance-2x` with 8 GB in Amsterdam, against $0.009 on the shared machine (Fly's price page, read 2026-10-08: $0.00003606 a second while the machine is up, and a run keeps it up about 14 minutes) |
| B. Keep the machine and set the slots back to 1 | One at a time; 4 to 18 an hour by how heavy the cuts are | A heavy run right behind another is slow. Section 1's one-slot refusal figures apply |
| C. Make a run need less CPU (720p output, a faster encode setting) | In proportion | Output quality: a product decision |

### Decision, and what was done

**Decision 2026-10-08 (owner: "A"): dedicated CPUs.** The case put to the owner overstated how often the shared machine would fail.
What still holds: the change costs about 2 cents a run more and removes two failures that each cost about $7 at fal when they happen
(three heavy cuts together, or three runs' memory in 4 GB).

**Applied on staging 2026-10-08 21:35 UTC (owner: "apply A"):**

- `fly scale vm performance-2x --vm-memory 8192` on the running image (release v17), with no video-agent job in flight.
- The machine reads performance, 2 CPUs, 8192 MB. Its health check passes, all 21 lockdown checks pass, and
  `fly_instance_cpu_baseline` reads 2.00 (it was 0.25).
- The runner's `fly.toml` on main says the same (runner `0e7477f`), so the next deploy keeps it. Slots stay at 3.

**Not done yet:** a real run on the new machine, three at once, and production. Production has no runner; rollout step 1 creates it
from the runner's `fly.toml` as it now is.

## Open questions and next measurements

1. Applied on staging: `performance-2x`, 8 GB, three slots (section 5). The stage 2b trigger is set after the first three-at-once
   run on the new machine.
2. **One run, then three at once, on the new staging machine.** Three at once costs about $7 at fal and $1.30 in tokens and needs
   three signed-in accounts and the owner's go. Record each run's time, the machine's peak memory, and any refusal from fal or Anthropic. It can be three of
   G3's ten runs.
3. Staging: `/status` against a machine that has exited. If it takes longer than 20 s, a user who returns after 10 quiet minutes sees
   "can't be reached".
4. G3's ten runs: record the spread of run times (median, p95, longest) and of CPU-seconds per run. Section 5 rests on four.
5. Staging: two approvals from two accounts at the same moment with one slot left. Confirm the loser is refunded exactly once.
6. After step 9 of the runbook: runs started per hour, weekly. That is the trigger for stage 2b.

---

The four-step method (use cases and numbers, simplest design, core components, scale one bottleneck at a time), doing more on one
machine before adding machines, and the back-pressure rule for queues follow the
[System Design Primer](https://github.com/donnemartin/system-design-primer) by Donne Martin (CC BY 4.0). Not from the primer: this
project's ledger, signed-callback and flag rules, Fly's request routing, and the Erlang B and fixed-service queue formulas, which are
standard queueing theory.
