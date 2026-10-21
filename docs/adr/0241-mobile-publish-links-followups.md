# ADR-0241: Mobile team invitation entry and approval variants

Status: Proposed; implemented locally for independent review, not published.

Amends ADR-0203, ADR-0238 and ADR-0239. Implements the frozen publish-links work order, including Revision 2.

## Team invitations

The existing team-invite screen gains a paste entry and a Publish menu row. Paste accepts only absolute HTTPS URLs on veyrnox.ai, www.veyrnox.ai or the configured API origin, with no credentials or non-default port and exactly one valid token after /social/team/invite/. The parsed token and pasted input remain in component memory. The existing fetchInvite and acceptInvite calls send the token only to API_BASE; there is no new server route or public projection change. The inviter is not exposed.

The screen labels the role and expiry, distinguishes open, accepted, withdrawn, expired and closed invitations, and reports repeat acceptance separately. Accepted and revoked status take precedence over a past expiry. Token-bound hook state resets before rendering a different invitation. Stale reads and accepts cannot change the current invitation or selected brand; Accept is gated until the current read succeeds.

Bearer links are not saved to storage, caches, logs, the clipboard, notifications or analytics. Crash URL scrubbing removes the token segment from the invitation and review API paths and web paths, including HTTP/navigation breadcrumbs and event request URLs. Authenticated /api/v1/social paths remain unchanged. Signed-out users are redirected by the existing app layout to sign-in and the invitation link is deliberately dropped. They must tap the link again after signing in; there is no persisted return-to.

## Association and native build requirements

AASA now includes /social/team/invite/*. iOS needs no native rebuild for this association change: associatedDomains already includes applinks:veyrnox.ai. It takes effect after deployment and Apple's CDN refresh. Updated screen code still needs normal app delivery. Universal links activate on a tap, not a server redirect; the /auth/mobile redirect pattern is not used.

Android has one additional intent-filter data entry and requires a new native build. ANDROID_SHA256_FINGERPRINTS remains empty, so assetlinks.json still returns 404. Default verified opening also requires the owner to set the signing fingerprints (ADR-0106). Until then Android opens the browser; the in-app paste entry provides access.

## Approval requests

Approvals reuse the composer fields, cleaning and extracted code-point length check. Only chosen networks' nonempty variants are sent; YouTube defaults to private and is included only when chosen. Behaviour change: before this, approval posts to YouTube were published as public, because no visibility was sent. They now default to private unless the requester picks Unlisted or Public. A YouTube approval draft's signature, and so its idempotency key, changes once. Plain drafts retain the existing seven-field body and signature. Sorted variants and visibility extend the signature when present, giving changed content a new draft key. The existing createDraftKeys(appStorage) account-scoped cache remains in use.

Confirmation keeps the original body and appends each variant's first 60 code points and the labeled YouTube visibility. A variant entitlement/configuration refusal clears and hides variant fields for the current brand and explains that the main text is used. No automatic resend occurs: the person must send and confirm again. Visibility remains available because the approvals endpoint does not gate it. Brand changes reset variants, availability and visibility (to private); late refusals from another brand cannot disable current variants. No caller-plan pre-read is used because approval entitlements belong to the brand owner.

Review-link parsing/pinning, sharing, the created-links screen and approvals list are unchanged. There are no route, migration, flag, dependency or analytics changes.

## Verification scope

Unit tests cover validation, typed errors, state precedence, confirmation text, signature compatibility, token redaction, associations and async hook races. The required mobile proof is TypeScript, the complete Jest suite and the generated English registry check; server verification is the mobile association test and root npm test.

The screens were not run on a device or simulator. No native build, deployment, publication, commit or push was performed. This ADR deliberately uses the frozen work order's placeholder number; final numbering belongs to integration review.
