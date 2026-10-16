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

- The existing staging OpenAI key was not present in the staging Worker,
  Actions metadata or approved local env-file locations. The owner selected
  reuse; its storage location is still required. No production key was copied.
- Provider monitoring needs `FAL_BILLING_KEY`, `KIE_BALANCE_API_KEY`, and
  `OPENROUTER_MANAGEMENT_KEY`. These read-only billing credentials were absent.
  A code deployment cannot create or recover these provider credentials.
- The authenticated nightly staging sweep requires staging `E2E_EMAIL` and
  `E2E_PASSWORD` secrets. Anonymous results are retained independently, and
  missing authentication is reported explicitly rather than counted as a pass.
- Production migration 0328 requires owner approval in the protected
  [apply-migrations run](https://github.com/aljobson/Veyrnox.ai/actions/runs/38909212682).
  Until then, Activity explicitly identifies its limited history.

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
