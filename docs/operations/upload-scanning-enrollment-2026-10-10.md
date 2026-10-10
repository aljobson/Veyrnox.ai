# Upload hash matching: integration and enrollment review

Prepared 10 October 2026 for roadmap D1 and the owner's request to prepare integration/enrollment requirements. This is a proposal for review. No account application, external contact, terms acceptance or provider activation has occurred.

## Provider evidence and recommendation

Recommend an IWF Image Intercept eligibility inquiry first, because its [current service page](https://www.iwf.org.uk/our-technology/image-intercept/) advertises both image and video matching for eligible smaller platforms. It offers a free version up to one million monthly checks, subject to application review. Exact video formats, runtime, matching coverage and test contract still need written confirmation. This is a candidate, not an approved or tested integration.

Its inspected form requests applicant name/role/department, business email/phone/country, entity/website, trading date, employee count, addresses, registration number/certificate link, group structure, UK service, legal-scope assessment, other countries, UGC support and monthly upload volume. Do not guess legal scope. Fill these from owner records before submitting.

The separately licensed [IWF Hash List](https://www.iwf.org.uk/our-technology/our-services/image-hash-list/) is an alternative for a self-operated matcher, not a ready-to-use upload API. [Full membership](https://www.iwf.org.uk/membership/how-to-join/) requires a registered, publicly listed organization trading over twelve months, more than two unrelated full-time employees and appropriate security processes. [Fees](https://www.iwf.org.uk/membership/fees/) range from £5,000+ to £100,000+ annually by sector/size. Do not assume those membership conditions or costs are the Image Intercept eligibility contract.

PhotoDNA is an image-only fallback candidate. Microsoft's [service page](https://www.microsoft.com/en-us/photodna/CloudService?oneroute=true) describes qualification and third-party vetting. Its linked [application portal](https://myphotodna.microsoftmoderator.com) could not be inspected by the research tool; the information checklist below is our preparation list, not a verified copy of its form.

The [Microsoft FAQ](https://www.microsoft.com/en-us/PhotoDNA/FAQ) states that the Cloud service currently handles images only. Approved subscribers receive REST access after vetting. It offers benign integration images that simulate a match. Request those fixtures and documented video options during enrollment; image approval alone cannot close the video requirement. Known-hash detection also does not establish that previously unknown material is safe.

The [documentation](https://www.microsoft.com/en-us/PhotoDNA/Documentation) puts transaction examples and sample responses in the subscriber API portal. Implement the real adapter only against the approved account's documented contract. Endpoint URLs, exact authentication headers, formats and response schemas remain unconfirmed; do not invent them from older Content Moderator examples.

The [terms](https://www.microsoft.com/en-us/photodna/termsofuse) incorporate Microsoft subscription/service terms, limit the purpose of use, permit usage audits and identified aggregate reports to NCMEC, and leave the customer's reporting obligations intact. Free usage has transaction limits; high-volume usage can be charged. No SLA is offered. Owner/counsel must review the operative agreements and confirm actual quotas and pricing before activation.

Cloudflare's [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/) compares content served through its website cache, then notifies the operator and attempts blocking. That documented placement does not establish pre-storage scanning of private R2 uploads or Cinema transfers. It can be considered additional coverage after a separate terms review; it does not satisfy D1's ingest exit check.

## Enrollment packet to prepare

| Information | Owner-supplied or confirmed value |
|---|---|
| Registered operating entity, registration number/certificate link and jurisdiction | To confirm; do not infer from the GitHub account |
| Trading date, headcount, addresses and parent/subsidiary structure | To confirm from owner records for IWF eligibility |
| Countries served, UK service and legal-scope assessment | Owner/counsel to confirm; no inferred answer |
| Public product domain and service description | Veyrnox.ai; generation, private projects, social publishing and Cinema user content |
| Authorized applicant, role/department, business email and phone | To confirm |
| Technical/security contact | To confirm |
| Incident/reporting owner and backup | To confirm, including coverage hours |
| Expected image requests/day, peak concurrency and maximum image size | Measure from intended upload caps and usage; submit a bounded estimate |
| Video requirements | MP4 uploads, up to the existing Cinema 2 GiB limit; request supported video matching, limits and approved processing rules |
| Processing regions, subcontractors, retention and audit data | Obtain written provider answers and review data-processing terms |
| Integration account and benign match fixtures | Request an isolated test subscription and documented hit/non-hit fixtures |
| Availability, rate limits, suspension and price | Confirm account-specific terms; the marketing free tier is not an unlimited commitment |

Draft service description for owner editing: “Veyrnox.ai is a media creation service with private project files, social publishing and creator video distribution. We seek known-CSAM hash matching at ingest, before accepting media into durable storage or sending it to media providers. We need image integration fixtures and documented video coverage, with an operator reporting process and minimal retention.”

This draft has not been sent. Do not include API keys or sample user media in an application or chat. Provision approved credentials through the normal secret manager, separately for staging and production.

## Actual ingest paths requiring coverage

| Path | Present behavior | Integration boundary |
|---|---|---|
| `app/api/v1/uploads/route.js`, `lib/uploadSource.js`, `lib/uploadReservations.js` | Browser gets a signed R2 PUT; magic-byte checks occur after storage | Replace direct admission with trusted inspection of actual bytes before the final object write |
| `app/api/v1/social/uploads/route.js`, `lib/social/uploadPolicy.js` | Publish accepts device image/video uploads through reservation and completion | Use the same trusted admission result; no social attachment or dispatch until admitted |
| `app/api/v1/projects/[id]/assets/route.js`, inspect/download routes and `lib/projectAssets.js` | Private uploads enter a quarantine workflow; #857 adds a separate media-admission gate | Cloud documents can launch separately, but media stays closed in production pending D1. Cover admission before quarantine storage; malware/provenance checks remain additional controls |
| `lib/cinema/uploadApi.js`, transfer route and `lib/cinema/uploadPolicy.js` | Server-mediated upload; safety hold currently prevents new starts | Inspect before bytes reach Stream; a proxy by itself is not a scanner |
| `lib/cinema/libraryUploadApi.js` and `lib/cinema/stream.js` | Library copy can reach Stream; copy helper restricts sources to our R2 hosts | Require a server-recorded receipt for those exact bytes or rescan; a finished generation is not proof of a scan. Recheck future cloud-import implementations before release |

Inventory remote imports, generated media and every upload grant in the implementation PR. The listed paths are the first traced boundaries, not a claim that all sources have already been covered.

## Proposed integration contract

1. Validate the declared size and media allowlist, then inspect the actual bounded bytes in a trusted ingress service. Choose runtime and memory limits after obtaining provider constraints; the current Worker cannot be assumed to buffer a 2 GiB video safely.
2. Require a documented provider result with three internal outcomes: accepted for the configured hash-matching policy, matched, or unavailable/unsupported. Timeout, rate limit, malformed response, unsupported format and provider outage refuse admission. Give the user a retryable error when appropriate.
3. Persist a service-only receipt bound to the authenticated owner, actual SHA-256 byte digest, size, detected MIME, provider/policy version, scan time and one reservation. SHA-256 binds the receipt to bytes; it is not the CSAM matching algorithm. Reject client-supplied clean claims.
4. Let the trusted service write the final immutable object or forward the exact inspected stream. Do not scan one file and then issue an unrestricted browser PUT that could upload another. Preserve byte reservations, idempotency, expiry, cancellation and cleanup accounting.
5. Recheck owner/tenant permission before admission and before provider dispatch. Refuse a changed object, expired receipt or mismatched digest. Cover browser uploads, retries, multipart transfer, copies and remote imports with the same rule.
6. Keep matched content unavailable. Alert the designated operator using identifiers and minimal evidence; do not email raw media or place it in debug logs. Counsel defines the reporting, preservation and deletion procedure before any real match can occur.

Strict “before storage” means no R2 quarantine, Stream creation or durable temporary spool before the result. If video inspection needs durable quarantine, that changes D1 and requires an explicit reviewed policy decision; a private bucket does not silently satisfy the current requirement. Provider/frame extraction details and transient processing rules are still open. Do not substitute occasional frame sampling without documented matching coverage.

## Acceptance and rollout

Use only provider-approved benign fixtures. Record the reason for the saved flow: a matched upload must never become a stored object or playable/publishable media.

- A benign match returns refusal with no final object, Stream transfer, public URL, social dispatch or consumed upload reservation; retries cannot bypass it.
- A benign non-match stores the exact inspected bytes once and completes the intended user journey.
- Changed bytes, wrong MIME, wrong owner/tenant, replayed or expired receipts and concurrent completion attempts fail.
- Outage, timeout, malformed response, throttling and unsupported video fail before storage; reserved byte budgets are released safely.
- Browser flow receives a Reticle verdict on both outcomes. Independent R2/Stream/database checks establish whether any write occurred; a page message alone cannot prove absence of storage.
- Reporting delivery, restricted access, retention and cleanup are drilled with benign synthetic incidents. Real media is never used to test the system.

Keep upload launch flags and the Cinema safety hold unchanged until provider qualification, video coverage, reporting policy and staging acceptance are complete. Production migrations use ADR-0023's protected workflow; new paths retain the repository's 24-hour clean-reconciliation gate.

## Decisions needed from the owner

1. Review the recommended IWF Image Intercept inquiry and supply the correct operating entity/applicant details above, technical contact and reporting owner. Preparation is already authorized; submission and contractual acceptance remain separate actions. PhotoDNA remains the image-only fallback.
2. Have counsel approve reporting/preservation/deletion and provider data terms for the actual jurisdictions and business model. This proposal makes no legal determination.
3. Choose documented video coverage and retain strict pre-storage admission, or explicitly review a different quarantine policy. Keep video uploads closed while this remains unresolved.
4. Approve a concrete bounded provider/infrastructure budget after account quotas and rates are obtained.
