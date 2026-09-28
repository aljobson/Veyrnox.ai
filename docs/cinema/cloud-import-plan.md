# Personal cloud imports

Status: product scope agreed; metadata adapters implemented and tested. OAuth, durable import jobs, transfer workers and picker UI remain unimplemented; no cloud import is enabled.

Creators can import videos from Google Drive, Dropbox and Microsoft OneDrive,
including personal OneDrive accounts. Device uploads remain available. Selecting
an item imports a private copy into Cinema's managed video pipeline; the source
file is never moved, changed or deleted. There is no automatic folder sync.

## Creator experience

1. Choose Upload from device, Google Drive, Dropbox or OneDrive.
2. Authorize the chosen provider and select a video.
3. Review filename, size and destination draft before starting the import.
4. See importing, processing, ready or a recoverable error.
5. Disconnect provider access independently of removing the imported Cinema video.

Explicitly explain that disconnecting stops future access, whereas removing a
Cinema video removes only the imported copy. Publishing continues to require the
existing review process. Never require a publicly shared source link.

## Provider adapters

- Google Drive: Google Picker with `drive.file` where supported. Register the
  application, enable Picker/Drive APIs, restrict the browser API key, and
  configure approved staging and production origins separately.
- Dropbox: Chooser can supply a selected-file direct download link, expiring
  after four hours. Treat that link as a credential. Re-selection is required
  when it expires; a Chooser selection must not be labelled a persistent account
  connection. Persistent access, if implemented, needs a separate OAuth flow.
- OneDrive: use Microsoft's supported picker and delegated authorization for
  consumer accounts. Validate the exact required permissions in a test app;
  do not describe broad read access as selected-file-only permission. Work/school
  accounts require separate validation of tenant consent policies.

## Shared implementation requirements

- Verify the live creator role and ownership of the private draft for every
  import, retry, status read and cancellation.
- Use short-lived, single-use authorization state bound to the signed-in user,
  provider and approved return origin; verify popup origin and source. Use PKCE
  where the provider's flow supports it.
- Keep durable credentials encrypted server-side. Never log tokens, download
  URLs or file contents. Picker tokens, where required in-browser, stay only in
  memory. Clear access on disconnect and revoke at the provider when supported.
- Reserve a durable import and quota slot before transferring bytes. Bind its
  idempotency key to owner, draft, provider item and source revision. Detect
  changes to the selected file; do not silently import a different revision.
- Import through a bounded background transfer, not a long synchronous API
  request or a full video buffer. Reuse the existing 2 GiB/10-minute limits and
  private Stream processing checks. Define range retries and lease ownership.
- Resolve download locations from trusted provider responses. Validate redirects,
  reject private/local addresses, and never forward credentials across origins.
  Do not expose a generic fetch-any-URL endpoint.
- Reuse Stream signed webhook verification, reconciliation, provider-first
  deletion and replacement rules. Cancellation must retain capacity until any
  allocated provider resource has confirmed cleanup.
- Protect provider grants and import records with forced RLS, narrow RPCs,
  retention rules and audit events. Follow the protected migration workflow.
- Ship behind separate provider flags. Missing app configuration must show a
  clear unavailable state; buttons must never simulate successful connections.

## Delivery and acceptance

Implement the import state machine and quota/cleanup contracts, then adapters
for all three providers and the creator picker UI. Register provider apps and
complete live staging consent tests before enabling each adapter.

Test cross-account denial; OAuth state replay; popup origin rejection; revoked
and expired access; file changes; unsupported/oversized media; duplicate import;
interrupted transfer; provider redirects; processing failure; removal and
replacement. Verify the original file remains unchanged and private. Include a
personal OneDrive account in acceptance, not just a Microsoft 365 tenant.

## Provider references

- [Google Picker](https://developers.google.com/workspace/drive/api/guides/picker)
- [Dropbox Chooser](https://docs.dropboxapi.com/dropbox-api/docs/pre-built-components/chooser)
- [OneDrive File Picker](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/)

## Implementation progress

`lib/cinema/cloud/selection.js` verifies selected-file metadata at fixed Google,
Dropbox and Microsoft API endpoints and normalizes a source revision fingerprint.
It is not wired to a public route. Integration must first bind a provider grant
to the authenticated creator and reserve quota for a durable import.

The Dropbox adapter uses an OAuth grant and file ID, not a Chooser link. The
connection implementation must disclose the actual read permissions; a selected
file in our UI does not narrow an OAuth grant at the provider.
