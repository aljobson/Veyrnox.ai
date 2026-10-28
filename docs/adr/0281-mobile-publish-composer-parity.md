# ADR-0281: Mobile Publish composer parity, logos and post roles

Status: Proposed (frozen part A work order; independent inspection pending)

The phone composer now shows creation thumbnails, a chosen-media preview, and one
caption preview per effective destination network, including queue accounts. It
also hides actions the current plan, flags, or brand role cannot use. This is a
phone-only change; it changes no server route, feature flag, migration or dependency.

## Gates

The web's `app/veyrnox/app/publish/page.js:161,277` defines paid as
`!plansEnabled || planTier === 'publish'`, and enables multi-account and scheduling
for paid users. Queues and presets additionally require their own flags. The
phone uses the same formulas through `hasPublishPlan`. Free users select one
account, post now, and can open `/publish` to see the store plan card (ADR-0109).
There is no web checkout link or phone price.

The web passes `variantsEnabled && paid`. The phone deliberately requires
`plansEnabled && planTier === 'publish' && features.variants` instead:
`app/api/v1/social/posts/route.js:184-189` refuses platform variants without the
Publish entitlement and returns `variants_not_configured` when plans are off.
Plans-off and variants-on are independent, reachable settings. Hidden controls
cannot contribute `networkText`, `youtubeVisibility`, or `scheduledAt` to a post.
YouTube visibility is independently gated by the accounts response flag, matching
`Composer.js:345,399-409`. Existing confirmation, idempotency, queue reservation,
and refusal handling remain in place.

## Images and previews

The eleven web `NetworkLogo.js` paths are Simple Icons 11.0.0 (Bluesky 12.4.0),
CC0-1.0. A temporary Node script outside the repo used the already installed
canvaskit-wasm to draw each path at four times its 24×24 viewBox onto a transparent
96×96 surface with white fill. PNGs use theme textPrimary as their tint, just like
menu icons. No SVG renderer or new package is installed. Names remain beside
decorative images and accessibility text uses the network's display name.

Job asset links expire after fifteen minutes (`src/lib/media.ts`). Links stay in
mounted component state, are invalidated on user/brand/API changes, and are never
persisted or logged. Image disk caching is disabled. Failed asset requests,
including synchronous throws, leave neutral placeholders. The grid never starts
video playback. The chosen video uses InlineMedia; network video previews are
muted first frames without controls or autoplay, matching the web preview.
Uploads use a placeholder and are omitted from network media previews.

## Roles, scope and post actions

`usePublishRole` reads accounts per scope, starts at null, fails closed to viewer,
and ignores late answers after changes of user, brand or API. Composer and new
approval write controls require owner, manager or editor.

Post reschedule/cancel require a scheduled post with every target still pending;
cancel also requires updatedAt. Restore requires canceled, every target pending,
and updatedAt. Owner, manager or editor is required for each. Other roles see
Read only; started targets show Schedule locked. The existing missing-version
message stays. The server remains authoritative, including 409 POST_STARTED.

Server follow-up, not implemented: `get_social_post` in migration 0352 could
return `can_reschedule`, `can_cancel`, and `can_restore` from the calendar's rule
in 0311. The phone cannot currently see attempts or claims, so pending target
status is only an approximation of the complete server condition.

Only owners see Connect/Disconnect. Account loads and destructive confirmations
carry a generation, user/brand scope, and API identity because the DELETE route
revokes an account by id irrespective of the brand header. Scope changes clear
old data and invalidate outstanding confirmations and completions.

Calendar requests allowlist status and PHONE_CATALOGUE network filters, encode
query values, and invalidate each pagination generation on scope, range, filter,
or API change. A stale page cannot request another page or replace current data.
Times remain in the device time zone.

## Scope and verification

New text lives in publishParity, with all ten app locales and a dynamic YouTube
fixture. Existing assertions are preserved; only the frozen fixture updates were
made. Tests use this checkout's installed `test-renderer` (the existing screen
test convention), rather than adding the absent `react-test-renderer` dependency.
The agreed proof is TypeScript, the full Jest suite, generated English registry
check, and app localization check. Simulator light/dark tint and free-plan chip
inspection belongs to the independent inspector.

Left out: native date/time picker, upload deep links, post reuse, drafts thumbnails,
post search, analytics/best-time, calendar list/month cards/drag rescheduling,
store-management buttons, and all part B inbox/contact/ops changes. Shared upload,
media-selection, and ComposeExtras components are unchanged.
