# ADR-0288: Mobile Publish inbox triage, contacts import and role gating

Status: Implemented for independent review; frozen part B work order.

## Contracts and scope

The phone uses the existing server contracts. No server, migration, flag, dependency,
or deployment configuration changes are needed. The frozen work order fixes this
ADR's provisional filename and number.

`app/api/v1/social/inbox/route.js:20-33` accepts state, kind, accountId (UUID),
assignee (UUID or `unassigned`), priority (normal/high/urgent), trimmed search
(up to 100 UTF-16 units), and a lowercased tag (up to 32 units, matching
`^[a-z0-9][a-z0-9 _-]*$`). Invalid phone filters are omitted and every value is
URI-encoded. The listing retains bounded preview text, resolved counts, members
and filterable tags, while the older `fetchInbox`/`parseInbox` contract stays intact.

Listing and filter-account requests have independent sequence counters and share
one scope generation. Only user/brand changes and unmount increment that generation.
Responses and errors must match the generation, request sequence, scope and API.
This drops stale A→B→A responses without invalidating concurrent independent reads.
A scope change clears rows, counts, members, tags, accounts, errors and filters.
Account-read failures do not change listing or plan-lock state.

`app/api/v1/social/inbox/[threadId]/route.js:52-73` accepts read, priority and tags
PATCH actions. Priority and tags bodies contain exactly two keys. Read is sent
once per opened thread and scope, only after a triage role and unread thread load.
Failure is silent: it must not interrupt reading or create a reload/retry loop.
Returning to the list refreshes counts on focus.

Thread tags follow the write contract at that route's lines 66-68: trim, discard
empty entries, reject trimmed lengths above 32 UTF-16 units, deduplicate without
case sensitivity, and allow at most ten tags. Unicode is allowed (including
`café`); 16 emoji fit but 17 exceed the route's JavaScript length limit. The server
lowercases tags. The ASCII-only list filter is a different contract and omits
Unicode tags from its choices. Contacts continue to use their existing ASCII tag
validation. This change does not alter the existing reply-attempt rules.

## Roles and writes

| Action | Roles |
| --- | --- |
| Inbox triage, assignment, priority, tags, read and notes | owner, manager, editor, reviewer |
| Inbox reply | owner, manager, editor, with a reply-capable connection |
| Contacts import | owner, manager, editor |
| Workflows, queues, autolists and SmartLink writes | owner, manager, editor |

Loading roles fail closed. A reviewer gets triage controls and a triage-only
footer; other non-reply roles see a read-only footer. A permitted reply role on
an incapable connection sees a connection-specific explanation. The composer,
held-reply controls and send handler all require a reply role.

Import checks the role inside its route as well as at its entry point: direct
navigation cannot expose a picker or writable form to a viewer or reviewer.
Picker entry, confirmation entry and the Add callback check the live role.
Confirmations capture the scope generation, scope and API; old confirmations send
nothing even after A→B→A. Ops screens clear loaded data on scope changes, ignore
late reads and write completions, and invalidate delete confirmations. Disabled
controls preserve read access; SmartLink sharing remains available.

## Contacts import

`app/api/v1/social/contacts/route.js:86-114` accepts exactly accountId, source and
contacts with externalId, name, tags, subscriptionStatus and notes. Limits are 250
contacts, 256 external-ID units, 120 name units, ten ASCII tags of at most 32 units,
and 2000 note units. External IDs must be unique within an import. Consent is
unknown, subscribed or unsubscribed.

The CSV parser ports `lib/social/contactCsv.js`, including quoted commas, escaped
quotes and multiline fields. It requires external_id and name headers and allows
tags, subscription_status and notes; CSV tags are separated by `|`. It returns
localized problem keys and row numbers instead of English exceptions. Tests pin
the web headers, limit and tag regular expression.

The picker copies a single file to cache. Before reading, the screen rejects any
non-.csv name, unknown size or size above 32768 bytes. It reads with `File.text()`.
`discardCacheCopy` runs in `finally` on success, validation failure, parse failure,
read failure and stale scope. A URI ref also permits cleanup on unmount or scope
change during a read. Filenames and content are never logged, persisted or sent to
analytics. Form and parsed contact data clear on success and user/brand changes.

`packages/db/schema/supabase/0319_social_contact_import.sql:71,78,99-100` requires
an active account and upserts contacts by account and external ID. Existing names,
tags, subscription status and notes are overwritten. Therefore every POST requires
a confirmation naming the account, count and overwrite behavior. A synchronous
busy lock prevents duplicate taps; the upsert needs no idempotency key.

## Queue account eligibility

Selectable accounts must be active with publishing enabled. Saved account IDs split
into eligible selections and visible exclusions. Named exclusions show publishing
off or disconnected; unknown IDs are represented by a count. The explanation says
these IDs will be removed on save. Only eligible IDs enter the payload, and zero
eligible selections fail with the existing account validation error.

`packages/db/schema/supabase/0307_social_team_actions.sql:84-87` rejects inactive
accounts. Blocking every save would make such a queue uneditable; silently retaining
hidden invalid IDs was the previous bug. Visible exclusion permits editing while
making the removal clear. Publishing can be re-enabled and an account reselected.
The similar web queue behavior is outside this work order.

## Mock and exclusions

The extracted mobile mock inbox maintains unread, priority and tags, handles the
three PATCH actions and priority/tag filtering, and retains resolve/assign/reply
behavior. It starts unread so the inspector can observe the count fall on opening
a thread. No inbound message simulation is added.

Removed obsolete inbox, ads and commerce “coming” copy; unused catalog keys and
Cinema's ComingToApp component remain. Excluded work includes analytics, external
network navigation, contacts account/network filters, workflow account picking,
autolist recent items, SmartLink preview/stat cards, commerce editors, developer
and team audit work, and invite/reviewer-link copying. No analytics events are added.
