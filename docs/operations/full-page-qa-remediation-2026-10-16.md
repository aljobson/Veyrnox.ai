# Full-page QA remediation — 16 October 2026

This change follows the production audit of all 81 page templates and 169
sitemap URLs. Page rendering and feature configuration checks do not substitute
for successful provider generation, purchases, or outbound social delivery.

## Remediation

| Finding | Result |
| --- | --- |
| Fixed video outputs described as five-second clips | Shared customer-facing pricing units describe actual output lengths; internal billing is unchanged |
| Missing public audio durations | Model facts and prices include adjustable ranges, defaults, fixed lengths, speech limits, and source-dependent output |
| Transform-first Chat defaults | Open prompt-generative models are preferred; transformations remain selectable |
| Free and singular credit copy | Free generations say Free; credit and model nouns agree with the count |
| Demucs details unavailable | Active, ungated stem separation has a detail page and Tools entry |
| Source-driven transforms still show a five-second selector | Create, Chat and landing quotes describe uploaded-source duration and caps; internal billing units are unchanged |
| Paid Publish plan flashes Free | Neutral loading and explicit retry replace the false entitlement state |
| Inbox mobile overflow | Chart scrolling is contained within the viewport |
| Queues and RSS show premature owner controls | Sign-in, account identity, loading and explicit write roles gate editable surfaces |
| Activity silently truncates history | Compound keyset pagination plus readable action labels; explicit limited-history notice until migration 0328 is present |
| Activity cursor loses its positive UTC offset in the Worker adapter | URL-safe opaque transport preserves microseconds; narrowly validated legacy JSON cursors remain supported |
| Manual reports imply automatic delivery | Delivery copy follows report cadence |
| MFA displays a false initial failure | Loading, loaded and failed states are distinct |
| Signed-out Library appears empty | Account loading and sign-in requirement are explicit |
| Persistent browser credentials readable by scripts | Refresh credentials use a Secure HttpOnly host cookie; access tokens live only in memory; see ADR-0102 |
| API traffic lacks general edge screening | Separate API and session quotas precede application work; existing account limits remain authoritative |
| No branded runtime recovery | Root and Veyrnox error boundaries provide retry and safe navigation |
| Inconsistent error shapes | Client parsing accepts structured and legacy errors; existing route contracts are documented without breaking external clients |
| Large initial gallery document | First render is limited to 12 templates, with accessible progressive loading |
| Incomplete page inventory and browser coverage | Inventory covers every source template; read-only desktop, mobile and authenticated sweeps produce per-page results and accessibility/performance checks |
| No history-aware secret scan | Pinned, checksum-verified Gitleaks scans full history with reviewed exact false-positive fingerprints |
| Disabled provider-balance watch | The monitor runs by default and reports missing configuration rather than silently skipping |
| Staging content scan unhealthy | Missing OpenAI credential is explicitly diagnosed; the unhealthy check remains active until the credential is supplied |

Public HTML retains private/no-store caching because each response carries a
fresh CSP nonce. Reusing that response across visitors would weaken the existing
security design. Gallery payload reduction and explicit browser performance
budgets address measurable performance without weakening CSP.

## Database rollout

Migration `0328_social_activity_pagination` is additive and service-role-only.
It preserves brand membership, role and plan checks. A fresh isolated database
replay passed all 308 migrations, and acceptance tests retrieved 123 tied events
without duplication, source collisions or foreign-brand data. Repeated apply is
safe. Staging application and ACL readback passed on the approved AI staging
project. Production application follows ADR-0023's protected workflow on main.

## External prerequisites

- A new owner-approved OpenAI key was created through secure setup, saved only
  to an ignored staging env file, and provisioned on the staging Worker.
  A non-billable API check and fresh successful scanner heartbeat passed.
  Existing staging dependencies remain present; no production key was copied.
- Provider monitoring credentials are now configured as repository Actions
  secrets. The owner copied each new key directly into the secure terminal
  prompt; values were not retained in this report. The dedicated fal key has
  only `billing:usage:read` and a 90-day expiry. The dedicated KIE key permits
  only Z-Image, with saved hourly, daily and lifetime caps of one credit each;
  zero means unlimited and was deliberately not used. The OpenRouter management
  key has a 90-day expiry and administrative privileges, not read-only scope.
  Both expiring keys are due for rotation before 14 January 2027. All three
  actual balance reads passed after owner top-ups in
  [provider monitoring run 38938791829](https://github.com/aljobson/Veyrnox.ai/actions/runs/38938791829).
  Hourly monitoring remains enabled; no threshold was lowered to obtain a pass.
  See [the provider runbook](provider-balances.md). No provider key was added to
  the application Worker.
- The authenticated nightly staging sweep requires staging `E2E_EMAIL` and
  `E2E_PASSWORD` secrets. Anonymous results are retained independently, and
  missing authentication is reported explicitly rather than counted as a pass.
- Production migration 0328 completed after explicit owner approval through the
  protected [apply-migrations run](https://github.com/aljobson/Veyrnox.ai/actions/runs/38909212682).
  The production ACL readback confirms service-role-only execution and an empty
  search path. The legacy limited-history notice is no longer shown.

## Acceptance boundaries

The production retest must include every concrete sitemap URL, all route
templates, desktop and mobile rendering, account restoration after reload,
token-free persisted metadata, all Create model configurations, Publish plan
loading and inbox width, Activity availability, and console errors. Valid-token
shared pages and administrator interiors require suitable fixtures/access;
controlled rejection is recorded separately. Purchases, social posts, account
connections, security enrolment and destructive actions are not implicit page
smoke tests. The dedicated `/m/*` sample prototypes, local-only enhancement
preview, and parameterized editor review remain intentional product boundaries.

## Release-candidate verification

- Full Node suite: 3,900 passed, zero failed, one existing skip.
- Security type checking and client boundary scan: passed (546 modules).
- Full ESLint: zero errors; 109 existing warnings.
- Production Webpack build: passed. The temporary checkout uses an external
  node_modules symlink that Turbopack cannot traverse; CI builds without that
  temporary-checkout constraint.
- Fresh database replay and Activity acceptance: passed as described above.
- New browser-session helpers: 96.47% line, 83.08% branch coverage.
- New pricing helper: 97.96% line, 89.83% branch coverage.
- Independent media, Publish, edge and session security reviews: no remaining
  critical, high or medium findings after the reported fixes.

## Production acceptance baseline

The [main remediation deployment](https://github.com/aljobson/Veyrnox.ai/actions/runs/38909213010)
and [sitemap follow-up deployment](https://github.com/aljobson/Veyrnox.ai/actions/runs/38910182209)
succeeded, including live smoke tests and preservation of existing secret bindings.
The live `479f5be2` release was verified before and after a complete 5.4-minute sweep:

- Desktop: 233/233 URLs passed. Mobile: 233/233 URLs passed.
- All 81 templates and 170 sitemap URLs were covered, including Demucs.
- Per viewport: 214 render/layout/performance/accessibility checks, 12 protected
  administrator gates, and seven controlled missing-fixture paths.
- No document overflow, uncaught exceptions, or serious/critical accessibility
  findings. Accessibility snapshots use reduced motion, with bounded actions.
- Maximum navigation TTFB: 1.37 seconds desktop, 1.23 seconds mobile.
- Gallery first render: 13 images and 108,641 HTML bytes; progressive loading works.
- Signed-in checks covered 30 Studio/Publish/account surfaces on desktop and
  mobile, including restored balance/assets after reload, neutral MFA loading,
  correct paid plan, and contained mobile inbox chart scrolling.
- Six unauthenticated auth-boundary probes returned the expected 405/403/401
  responses without exposing credentials or setting cookies.
- All 32 eligible model details and 21 hydrated audio/video configurations were
  inspected without spending credits. Invalid audio durations are rejected.

Those hydrated checks identified the source-duration follow-up recorded above.
Its release candidate passes 3,910 tests (zero failures, one existing skip),
the production build, type checking and client boundaries (547 modules).
The final follow-up PR records its own deployment and repeated live sweep.
No purchases, real generations, outbound posts, security enrolments or destructive
actions are implied by these read-only page results. Administrator interiors and
valid-token shared workflows still require suitable access/fixtures.

## Activity transport follow-up

The first post-migration production pagination interaction exposed an adapter
transport defect: OpenNext reconstructs a decoded query without escaping its
values. A timestamp's `+00:00` became ` 00:00`, so the route rejected the next
cursor with HTTP 400. SQL pagination and timestamp precision were correct.

The shared client/API helper now uses bounded, validated base64url cursors and
preserves the database's six-digit timestamp precision. Existing JSON clients
are supported with a narrowly validated positive-offset repair. Regression tests
execute the installed adapter's actual reconstruction function; standalone
Cloudflare runtime verification also passed. This candidate passes 3,918 tests,
the production build, type checking, scoped lint and 548-module boundary checks.
No SQL, billing or authorization behavior changes. The follow-up PR records the
actual deployed pagination interaction and subsequent live page checks.

## Extended non-billable feature QA

The owner requested a final feature-wide pass after provider monitoring became
healthy. The owner explicitly selected **non-billable generation tests**. No
isolated social delivery destination was designated, so this pass must not be
described as real provider generation or outbound social delivery acceptance.

The authenticated production test account was signed in through the normal
browser flow, including Turnstile, without resetting its password or changing
entitlements. Its observed baseline was 966 credits and seven Library assets.
The active Publish Plan and its actual Activity history loaded successfully;
the account has one recorded Activity event, so this does not prove multi-page
production history. The separate disposable database suite exercises 123 tied
events, keyset precision, source collisions and brand isolation.

Confirmed follow-up defects and their regression coverage:

- Full or selectively blocked browser storage could retain a readable legacy
  session after logout. Independent best-effort operations now remove the old
  record before writing the small logout marker; in-tab memory remains
  authoritative when persistence fails. Cross-tab logout and recovered storage
  have dedicated regressions. Fully denied storage combined with an offline
  network cannot preserve new logout intent across a complete reload; this
  physical persistence limitation is not reported as solved.
- Chat source-only models required irrelevant text, and Demucs also inherited
  that restriction in Create. Prompt guards now follow the model contract while
  text-generative audio, speech and topic requirements remain enforced.
- Studio and Chat discarded source-slot roles. Both now send explicit owned
  Library/upload assignments. Declared optional end frames are visible, and
  image/audio/video Library pickers use the corresponding MIME filters. Consent,
  source limits, ownership, quotes and per-request idempotency remain unchanged.
- Edited Oddling traits could conflict with an inherited preset's immutable
  visual instructions. Exact inherited preset canon is reconciled only for
  edited visual categories, retaining identity and unrelated details; custom
  user-authored canon is left untouched.

Browser feature tests use fully intercepted synthetic auth, generation, upload,
polling and asset routes, with unmatched writes blocked. Playback and download
checks prove the UI handles fixture media, not actual provider completion,
generated-media quality or measured provider output duration. No public social
posts, connected-account changes, purchases, security enrolments or destructive
account actions are part of this pass.
