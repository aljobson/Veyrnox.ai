# ADR-0293: Mobile Publish ops gates follow the brand

Status: Implemented for independent review against the frozen work order at 152767aec.

## Role contracts

The server remains authoritative. Phone gates use the existing page parsers,
`usePublishRole`, `canManage` and `rolesFor`; no second role table is introduced.

| Surface / action | Allowed roles | Server contract (paths relative to this repository) |
| --- | --- | --- |
| Ads save / delete | owner, manager, editor | `app/api/v1/social/ads/route.js:40,42` |
| Commerce save / archive | owner, manager, editor | `app/api/v1/social/commerce/products/route.js:20,22` |
| Contact edit | owner, manager, editor, reviewer | `app/api/v1/social/contacts/route.js:73` |
| Developer keys read / create / revoke | owner, manager | `app/api/v1/social/developer/keys/route.js:36,58,83` |
| Developer webhooks read / create / revoke | owner, manager | `app/api/v1/social/developer/webhooks/route.js:15,17,19` |
| Developer logs | owner, manager | `app/api/v1/social/developer/logs/route.js:20` |
| Team management | owner, manager, subject to member and invitation restrictions | `packages/db/schema/supabase/0403_social_team_non_member_guard.sql:19-23,40-44`; `0305_social_team_roles.sql:102` |

An owner may revoke any pending invitation. A manager may revoke a pending
invitation only when its role is not manager. `canRevoke` mirrors that RPC rule;
`canManage`, `rolesFor`, and existing team messages are unchanged. Invitations
validate the selected role before opening confirmation and again before sending.
Team reads also replace an unavailable invite role with editor.

## Existing parity retained

ADR-0288 already shipped the role and scope gates for workflows, queues, queue
edit, autolists, autolist edit, SmartLink and contact import. Their existing
`usePublishRole` / `canPublish` checks and inline counters stay untouched and are
pinned by `publishOpsRoles.test.tsx` and the existing contact import tests.
The write roles match `app/api/v1/social/workflows/route.js:61,81`,
`queues/route.js:14,16`, `autolists/route.js:60,78`, and `smartlink/route.js:54`.

ADR-0288 also shipped all seven inbox filters (account, state, kind, search,
assignee, priority, tag), priority display and PATCH, mark-read once after the
triage role loads, and removal of the stale coming/read-only banner. The list's
scopeGeneration, listingSeq and accountsSeq remain intact. Existing
`publishInboxListScreen.test.tsx`, `publishInboxTriage.test.tsx` and
`mockInbox.test.ts` assertions remain; this work adds coverage rather than
rebuilding those behaviors. The thread now holds a null role while loading,
exposes no writes or role footer until it resolves, and uses the existing triage
boolean for notes. Suggestions receive viewer while the role is unknown.

## Scope and read ordering

`usePublishScope` increments a generation on user change, brand change and
unmount. Its guard captures that generation, `publishScope()` and the API client;
a completion must still match all three. The generation detects A → B → A.
Separate per-key read counters make the newest read authoritative within a scope
without invalidating mutations or reads for another key. Successes, errors and
refresh completion are guarded alike, including reads after mutations.

Ads, commerce and contact edit start with canEdit false. Scope resets immediately
clear page data, writable state, forms, errors and busy state, then trigger a new
read. Failed reads remain read-only. Ads dates render as text for nonwriters
because the shared WhenPicker has no disabled interface; writable dates retain
the existing picker. Commerce still requires both canEdit and editable.
Saves check a live permission ref and own a synchronous token. Only that token
and a valid scope may clear busy; an old save cannot unlock a new save or navigate
back. Delete/archive confirmations check a live permission ref, their original
scope, single-use state and a synchronous running lock.

Team resets clear data, invitation email and role, open controls, notices, errors,
busy/refresh state and the one-time invitation link. Confirmations retain their
opening scope guard; their completions cannot mutate the next brand's screen.
The bearer link lives only in component state and clears on scope change/unmount.

Developer first resolves the role through the accounts endpoint. Loading renders
a spinner; other roles see the intro and existing dev.err.role text, announced
with useAnnouncement. No developer component mounts and no developer endpoint is
requested for a non-owner/non-manager, since every such endpoint would refuse it.
Authorized components use the shared guard for reads and mutations. Scope resets
clear lists, form fields, notices, busy state, and the one-time API key or webhook
signing secret. Secrets remain in component state only and clear on unmount.
Logs use one read key across searches and status changes, so an earlier search
cannot land under a newer filter.

## Mock and verification

The inbox mock now keeps assignedId alongside the displayed email. Assignee
filters accept unassigned or a member ID. Search matches participant name,
subject or any message body, case-insensitively, as in
`packages/db/schema/supabase/0309_social_inbox_workflow.sql:86-87`. Account filters
remain a screen/query test: the mock's acc-1 IDs are not UUIDs. Existing resolve,
assign, reply, priority, tags and mark-read behavior remains covered.
The sole mock-server change returns viewer dashboard flags and no accounts for
the Agency brand, before the default owner response; devMockParity pins it.

The three new gate suites cover role/loading/error states, scope resets,
A → B → A confirmations, overlapping reads, save tokens, invitation-role changes,
and secret lifetime. Existing suites add assignee/search queries, mock filters,
loading footer and the revoke matrix. The agreed proof is TypeScript, the full
Jest suite, English registry check and app i18n check. The builder's advisory
report records actual results and any environment-blocked simulator checks.

## Non-goals

No server, flag, migration, wrangler or package changes. No new strings. No
commerce variants/discounts/collections editing, calendar drag, best-time heatmap,
inbox analytics, network links, contacts account/network filters, workflow account
picker, autolist recent items, SmartLink preview/stats, pending invite/reviewer
link copying, actor role display, MEMBER_EXISTS/INVITE_EXISTS mapping, developer
route filter/live refresh/CSV, approvals list changes or contacts list changes.
Unused inbox.readOnly and inbox.replyOnWeb catalog keys remain as in ADR-0288.
