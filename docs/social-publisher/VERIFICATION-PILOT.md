# YouTube verification pilot

This change supplies a tester path for recording the production Google OAuth
client before opening Publish to the public. It does not activate that path.
`PUBLISH_ENABLED` remains false, `PUBLISH_TESTER_AUTH_IDS` is empty and
`PUBLISH_YOUTUBE_VISIBILITY_ENABLED` remains false on production.

## Access boundary

Populate `PUBLISH_TESTER_AUTH_IDS` only with comma-separated Supabase Auth UUIDs
for owner-designated **Veyrnox** testers. The Google account used to connect a
YouTube channel is separate from the Veyrnox login. An email address is not an
allowlist entry. Determine the tester's verified Auth UUID before configuring
access; do not copy an ID from client-supplied request headers.

When an allowlist exists, the Publish and callback HTML shells can render, but
contain no account data. Every social API first verifies the existing ES256 JWT,
then compares its verified subject with the server allowlist. Other users receive
`publish_not_open`; missing or invalid JWTs remain unauthorized. The menu link
appears only after an authenticated access check. The existing per-network release
gate still restricts production to YouTube. No OAuth state, token encryption,
account entitlement, database ownership or row-security checks are bypassed.

Removing a tester stops future API access. It does not revoke the tester's
Google grant or cancel already queued posts. Use the supported disconnect and
cancellation operations first if those actions are wanted.

## Visibility rollout

1. Merge this preparation PR only after checks pass; default settings stay off.
2. Apply migration `0241_social_youtube_visibility` through the existing
   apply-migrations workflow with the owner's production approval.
3. Confirm the deployed Worker understands `provider_state.youtube_visibility`.
4. Enable `PUBLISH_YOUTUBE_VISIBILITY_ENABLED` for the intended environment.
   Configure the approved tester UUIDs while leaving `PUBLISH_ENABLED=false`.
   Enable the analytics sweep only when its existing prerequisites are verified.
5. Verify a non-tester cannot connect, read accounts or create a post. Confirm
   the tester can complete the production client's consent flow.
6. In the composer, YouTube visibility defaults to Private; Unlisted and Public
   are explicit alternatives. The selection applies only to YouTube. Old clients
   and previously queued posts with no visibility retain their public behavior.
7. Obtain approval for the exact channel, existing video, text and visibility
   before sending Post now or Schedule post. No upload is authorized by applying
   the migration or allowing a tester. Record actual provider visibility and
   processing result, not just a successful queue response.

The additive service-only RPC calls the existing owner/media validation and
idempotent creation function in the same transaction, then writes visibility
only on newly created YouTube targets. An idempotent replay cannot change it.
The Worker retains visibility through quota deferral, expired-session restart,
chunk progress and processing. Unknown persisted values fail rather than
falling back to public.

Do not roll back to Worker code predating this visibility support while private
or unlisted targets are pending: old code always requests public uploads.
Disable new access and inspect/cancel queued targets through supported operations
before such a rollback. Turning Publish off does not stop its recovery sweep.

## Recording and release

The owner has designated a Google sign-in account privately for the demo;
its actual YouTube channel has not yet been confirmed. The existing blue-cube
Library video can be used without another generation charge, once its destination
and visibility are approved. Google requires an English recording showing actual
consent, the app name and production client ID, and usage of both requested scopes.
The recording URL itself must be accessible to reviewers (Unlisted in YouTube
Studio). No recording, Google consent or YouTube upload has been performed by
this change.

Keep public activation PR #749 draft until the applicable verification and
acceptance gates are met. See the production readiness record and
[Google's verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
