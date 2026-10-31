# ADR-0305: Your wins

Status: Accepted; flag off

## Context

People need to see what they have made and what their credits bought. Home presents an all-time summary; Account opens the detailed week/all-time view. Every number must have a reproducible server definition. Time saved is excluded because there is no honest baseline. Money values, comparisons with other people, sharing, and Cinema viewing statistics are outside this feature.

## Decision

`public.read_your_wins(text)` returns one read-only projection. It is a STABLE SECURITY DEFINER function with an empty search path, executable only by service_role. An unknown or tombstoned user returns `ACCOUNT_UNAVAILABLE`. It does not provision users or write any table, ledger entry, or balance. There is no server write path for seen milestones. The GET route uses the existing account-read rate limiter, whose request accounting is unchanged.

Week means Monday 00:00 UTC through transaction time. All time has no lower boundary. Clients format server values in the active locale; they never estimate totals.

## Definitions and source evidence

- Creations are the caller's `jobs` with `deleted_at IS NULL`, `state = 'STORED'`, and `inputs->>'kind' IS DISTINCT FROM 'chat'`. Range uses `jobs.created_at`, not completion time. These are the Library predicates in `0397_editor_server_render_library.sql`, `list_user_jobs` at lines 276–301. `lib/jobState.js` identifies STORED as successful delivery. `lib/autoShort.js` records script/voice/scenes/stitch in `job_steps` (`0091_auto_short_job_steps.sql`), not child jobs. The parent becomes STORED once. `0396`/`0397` finalize one server-render job and a related Library render; the extra render record is not another job. No additional child-job exclusion is necessary.
- Types come only from `model_catalog.modality`: suffix `-image`, suffix `-video`, then `audio`, `text-to-speech`, `text-to-audio`, `audio-to-audio`; all remaining values and absent catalog rows are Other. Other stays in the total and its legend appears only when positive.
- Credits are `greatest(0, -sum(delta))` for the user's job-linked ledger entries in range, including refunds and deleted jobs. Exclude the entire job if its inputs identify chat OR any of that user's ledger rows for it starts with `debit:chat`. The current producer in `lib/chatTurn.js:215` emits `debit:chat`; no other chat debit reason is currently produced in `lib/`. The prefix also covers future suffixes. `0351_delete_user_job.sql` resets inputs to `{}`, while `0203_chat_delete_is_delete.sql` keeps jobs, so the immutable ledger reason is essential. The label explicitly says “Credits used on creations, after refunds”. Range uses ledger-entry time, so refunds this week may offset older spending, with the displayed value floored at zero.
- Published posts are distinct authored social posts with a published target. Range and first-post milestone use the earliest published target of each post. Two networks still count as one post. Views sum JSON-number `metrics.views` from `social_analytics_posts`, joined to the caller's published targets by BOTH account and platform-post id. Duplicate target references cannot multiply an analytics row. Range uses the earliest publication of that target identity. Numeric zero is available data; no numeric observations is null. Networks are the contributing target networks, sorted and deduplicated. External posts, another author's posts on the same connected account, account totals, and Cinema viewing are excluded.
- Current streak reads `checkin_streaks`: if last check-in is at least yesterday UTC, use its streak; otherwise zero. This is the rule in `0368_daily_checkin.sql:84–86`. Best streak uses distinct dates from `grant:checkin#YYYY-MM-DD` ledger reasons, grouped by date minus ordinal to find consecutive runs. Last seven cells cover today minus six through today, oldest first. Check-in dates, not grant insertion times, define these cells.
- Milestones have fixed server order: first_image, first_video, creations_10, creations_50, first_post, first_cinema_upload, streak_7. Creation milestones use current qualifying jobs (deletion can remove a reached milestone), with `created_at,id` resolving ordinal ties. First Cinema upload is the earliest ready upload's creation time: `0137_cinema_stream_uploads.sql` has `creator_id REFERENCES cinema_profiles(user_id)`; that profile key maps to `users.id`. Streak milestone time is midnight UTC on the completion date of the first seven-day run. Locked progress is capped at the target; streak progress uses the best run.

## Video made

Video made counts only newly generated video footage. Clip Editor outputs and editor server renders reuse footage and contribute **zero**, even when their output duration is known. This prevents counting the same footage again after an edit or render. They remain creations under the Library definition.

Only generation mappings that preserve the requested output duration contribute seconds. The adapters do not uniformly treat `inputs.duration_seconds` as output length: kie Veo can request eight seconds from a five-second unit, and Hailuo six from five. Those mappings and other unverified flows contribute zero rather than treating billed units as footage. This conservative scope is an explicit limitation of the metric.

| Flow | Seconds counted |
| --- | --- |
| fal Kling 2.6 text-to-video, Wan 2.5 text-to-video, Kling O1 reference video, Kling v3 pro image-to-video | `inputs.duration_seconds`; default 5 |
| kie market Kling 3.0 video, Wan 2.5 text-to-video, Kling 2.6 text-to-video | `inputs.duration_seconds`; default 5 |
| BytePlus Seedance 2.0 fast/mini/base, 2.5, 1.0 pro fast | `inputs.duration_seconds`; default 5 |
| OpenRouter `bytedance/seedance-2.0-fast` | `inputs.duration_seconds`; default 5 |
| Clip Editor (`clip-edit:v1`) | 0; `inputs.edit.output_s` measures reused footage |
| Editor server render (`concat-render`, `editor-render`) | 0; `inputs.seconds` measures reused footage |
| Auto-short, video agent, faceless reel, enhancements, Veo, Hailuo, other/unknown flows | 0; no verified output-duration mapping |

`lib/modelCapabilities.js:shapePayload` maps `inputs.duration_seconds || UNIT_SECONDS`; the listed records preserve the supported duration. `packages/adapters/byteplus.js:buildRequest`, `kie.js:clipSeconds`, and `openrouter.js:buildRequest` use the five-second default for the listed endpoints. `app/api/v1/generations/route.js` retains those inputs. Positive numeric seconds are floored per job; malformed or negative values contribute zero. Duration classification first uses the route referenced by the job's latest completed `job_attempts` record (`0367`, `0370`, `0372`). Failed or incomplete attempts do not classify output. The job's provider must match that route's supplier. Catalog dispatch reordering (`0374`) leaves this recorded route association intact.

**Historical limitation:** jobs without a completed attempt record have no stored endpoint or modality snapshot. They retain the current catalog endpoint/provider fallback, so their video seconds can change when catalog dispatch changes, including same-provider endpoint changes. Even recorded attempts reference `model_routes` rather than an immutable endpoint snapshot: direct edits to that route's supplier or endpoint could affect historical classification. Creation types still use the current catalog modality. No new snapshot or write path is introduced here.

## Cost and privileges

All calculations use set-based aggregates and window functions; no per-row procedural loop or write. Existing indexes cover the required predicates: `jobs_user_id_idx (user_id, created_at DESC)` and `ledger_entries_user_id_idx (user_id, created_at)` in `packages/db/schema/0001_initial.sql`; `social_posts_created_by_idx` in `0176_fk_lookup_indexes.sql`; and the `social_post_targets_post_account UNIQUE(post_id,account_id)` index in `0156`. Analytics primary key is `(account_id, platform_post_id)`. Cinema's `(creator_id,created_at)` index already exists. Recorded routes use the existing `job_attempts UNIQUE(job_id,attempt_no)` index and model_routes primary key. No new index is needed. All public-table references are schema-qualified, built-in functions use pg_catalog, and browser roles explicitly lose EXECUTE.

## Flags and rollout

`YOUR_WINS_ENABLED` enables the route only when exactly `true`. It is absent from production text bindings, preserving the ADR-0251 budget. Staging permits the additional binding and sets it to `false`. Mobile reads `EXPO_PUBLIC_YOUR_WINS_ENABLED === 'true'`; preview and production EAS profiles both set it to `false`. This change enables no flag.

GET `/api/v1/wins` validates identity and uses `accountReadLimit`, following check-in. Responses are no-store and contain only documented keys. Missing authentication returns 401, disabled returns 404, unavailable account returns 403, and missing configuration or RPC failure returns 502. Error logs contain only `[wins] request failed`. Check-in off removes both streak statistics and `streak_7`. Cinema availability reuses `cinemaFeatures`: content and uploads must both be available, as required by `lib/cinema/uploadApi.js`.

Clients fetch on mount and focus/foreground, at most once per five minutes per account, without polling. Results, including unsuccessful reads, are cached per account. Mobile uses the account cache helpers, cleared on sign-out/account change. Web keeps the result in account-scoped memory for the page lifetime. Failed reads hide cards, Account rows and celebrations; the full page shows “Not available yet” after the initial loading state. Responses cannot cross account boundaries. Celebration checks run on network refreshes; an existing candidate may wait for the host to become idle.

## Client-only seen state and celebrations

Web localStorage keys contain a SHA-256 of the auth id, never its raw value or email. Mobile uses the per-account cache helpers. First successful load seeds all already-reached milestones and celebrates nothing. Phone first_image and first_video are always marked seen silently because existing producers cover them; `celebrate.ts` and its callers retain their behavior. The web has no existing first-creation producer, so every milestone is eligible there.

A refresh selects only the newest unseen milestone. A candidate remains unseen until the dialog or CelebrationHost actually displays it; cancellation before display leaves it eligible for a later refresh. When displayed, the reached milestones in that response become seen, preventing a backlog of older celebrations. The limit is one displayed celebration per web page load or phone foreground. Further milestones stay eligible for a later session.

Both clients defer wins while the daily check-in dialog is open and recheck when it closes, retaining the unseen candidate. Web observes the existing native dialog; phone publishes its modal lifetime without changing check-in behavior. Phone arbitration also includes queued and displayed CelebrationHost events. Wins waits for idle and rechecks the latest successful response. Only `winsMilestone` has real 44-point “See your wins” and “Close” controls. Legacy events preserve their decorative overlay, wording and timing. Web uses the existing Modal and VeyCharacter. Vey cheers without speaking or opening chat (ADR-0265). Reduce Motion uses a still cheer pose without confetti.

## Consequences

Counts can decrease after creation deletion; credits remain spent and are still counted after refunds. Known durations undercount unsupported generation flows, by design. Five-minute caching trades immediate updates for bounded read cost. Seen state is local to the client and may reset when its storage is cleared; reseeding then avoids a flood of historical celebrations.

The migration adds no tables or indexes. Acceptance fixtures roll back, exercise the data definitions and role ACLs, and apply the migration twice. Route, client, accessibility, localization and celebration tests cover the feature without altering existing celebration producers.
