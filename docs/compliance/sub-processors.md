# Processor and data-recipient register

Status: DRAFT — counsel and owner review required. Repository evidence, not legal advice or a claim of executed contracts. This is the single source of truth for the inventory and the proposed retention/basis decisions in ADR-0317. Last inspected: 2 November 2026.

The inventory includes subprocessors, independent controllers and user-selected social recipients; inclusion does not determine their legal role or imply every integration is enabled. Downstream model providers depend on the model selected and gateway configuration. The owner must obtain gateway onward-processor lists and confirm legal entities, roles, regions and transfers before activation. No signed DPA is evidenced here. Existing public transfer copy mentions SCCs/UK IDTA; that copy is not evidence of an executed agreement. Every vendor's DPA status is UNKNOWN — owner to confirm.

## Inventory

| Name | Purpose | Data categories | Location / transfer evidence | DPA status | Availability / role note | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase | Authentication and database | Account identifiers, email, credentials, application records | EU Frankfurt database; contractual transfer arrangements UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `docs/adr/0006-auth-and-db-amendment-eu-residency.md` `packages/db/supabase-client.js` |
| Cloudflare | Workers, R2, Stream, Turnstile, Email Routing and Access | Requests, IP/security signals, media, email routing and admin identity | R2 EU jurisdiction; edge/Stream processing region and transfer arrangements UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/r2.js` `packages/adapters/r2Copy.js` `wrangler.jsonc` `lib/contentSecurityPolicy.mjs` |
| PostHog | Optional analytics/replay with consent | Pseudonymous usage, masked replay, diagnostic events | EU host; transfer arrangements UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `app/lib/analyticsPrivacy.js` `docs/operations/posthog.md` `docs/adr/0271-mobile-posthog-consent.md` |
| Sentry | Necessary server diagnostics | Sanitized errors, code locations and routes | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `docs/adr/0170-sentry-worker-error-reporting.md` |
| Fly.io | Cinema scanner, concat rendering and video-agent runner | Media, processing instructions, job identifiers | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `wrangler.jsonc` `docs/adr/0074-openmontage-video-agent.md` |
| Expo | Push delivery | Push tokens and notification payloads | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `lib/pushNotifications.js` `docs/adr/0113-mobile-push-notifications.md` |
| fal.ai | Generation | Prompts, reference media, generation settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/fal.js` |
| Kie.ai | Generation | Prompts, reference media, generation settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/kie.js` |
| GrsAI | Generation | Prompts, reference media, generation settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/grsai.js` |
| OpenRouter | Model gateway for generation and chat | Prompts, messages, references, model settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/openrouter.js` `packages/adapters/openrouterChat.js` |
| ElevenLabs | Speech generation and voice-profile creation, training and ownership verification | Text and voice settings; uploaded voice samples, live ownership-verification recordings and voice-profile metadata | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/elevenlabs.js` `app/api/v1/voice-profiles/[profileId]/samples/route.js` `app/api/v1/voice-profiles/[profileId]/captcha/route.js` |
| Exa | Optional web search | Search queries | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/exa.js` |
| Parallel | Optional web search | Queries, conversation and model identifiers | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/parallelSearch.js` |
| Resend | Service email | Recipient email and message content | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/resend.js` |
| RevenueCat | Store subscription and purchase coordination | App account identifiers and purchase events | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/revenuecat.js` |
| Stripe | Checkout, credit and Publish subscriptions; separate controller for Merchant of Record purchases | Customer contact, purchase and billing references | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/stripe.js` `packages/adapters/stripeCreditSubscriptions.js` `packages/adapters/stripePublishPlan.js` |
| BytePlus | Generation | Prompts and reference media | Singapore ModelArk endpoint; arrangements UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Planned in privacy notice; do not infer activation from adapter presence | `packages/adapters/byteplus.js` `lib/i18n/messages/legal/en/privacy.mjs` |
| Apple | Sign-in, App Store billing and push transport | Identity assertions, purchase and device identifiers | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `app/lib/authClient.js` `apps/mobile/src/lib/account.ts` `docs/adr/0113-mobile-push-notifications.md` `docs/adr/0106-mobile-app.md` |
| Google | Sign-in, Play billing, YouTube and Business Profile integration | Identity, purchases, channel/business profile, selected media/captions and statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/youtube.js` `packages/adapters/social/gmb.js` `app/lib/authClient.js` `docs/adr/0106-mobile-app.md` |
| Meta (Instagram, Facebook, Threads) | Requested publishing and supported inbox replies | OAuth tokens, profiles, selected posts/media, replies and analytics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/instagram.js` `packages/adapters/social/facebook.js` `packages/adapters/social/threads.js` `packages/adapters/social/inbox.js` `packages/adapters/social/carousel.js` `packages/adapters/social/videoPublishing.js` |
| TikTok | Connected social features and requested publishing where supported | OAuth credentials, profiles, selected content and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/tiktok.js` |
| LinkedIn | Connected social features and requested publishing where supported | OAuth credentials, profiles, selected content and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/linkedin.js` |
| X | Connected social features and requested publishing where supported | OAuth credentials, profiles, selected content and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/twitter.js` |
| Pinterest | Connected social features and requested publishing where supported | OAuth credentials, profiles, selected content and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/pinterest.js` |
| Bluesky | Connected social features and requested publishing where supported | OAuth credentials, profiles, selected content and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/bluesky.js` |
| Twitch | Connected profile and channel statistics (no publishing adapter) | OAuth credentials, profiles and supported statistics | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Integrated; runtime availability depends on configuration | `packages/adapters/social/twitch.js` |

| Crun | Generation | Prompts, reference media and generation settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Live configured integration: registered, production flag true, first-choice routes activated with paid-probe evidence; adapter header is stale. Deployed backend not queried here | `packages/adapters/crun.js` `packages/provider-sdk/registry.js` `wrangler.jsonc` `packages/db/schema/supabase/0387_crun_seedance_fast_first.sql` `packages/db/schema/supabase/0389_crun_images_first.sql` |
| Higgsfield | Generation | Prompts, reference images and generation settings | UNKNOWN — owner to confirm | UNKNOWN — owner to confirm | Planned integration, ships dark. Higgsfield trains on outputs unless the account-level Console opt-out is on; the owner must switch it on before enabling. Written ToS s11.5 permission outstanding | `packages/adapters/higgsfield.js` `packages/provider-sdk/registry.js` `wrangler.jsonc` `packages/db/schema/supabase/0437_higgsfield_standby_routes.sql` |

## Explicit adapter exclusions

| File | Reason | Evidence |
| --- | --- | --- |
| `packages/adapters/social/common.js` | NON-VENDOR — shared request/encoding helpers; vendor callers are inventoried above. | `packages/adapters/social/common.js` |

README.md and package.json are metadata, not executable adapters. Shared adapters that actually contact providers (inbox, carousel, videoPublishing, r2Copy) are covered in vendor rows, not excluded.

## Retention and lawful basis by purpose

Basis assignments below are PROPOSED — owner/counsel to confirm, grounded in existing privacy purposes and the cited technical behavior. No job or sweep is changed by this register. A code default is not a legal retention decision. Existing public commitments remain: the ledger is retained for the account lifetime plus the tax period, and request logs for a short security window before discarding them. Neither specifies a numeric duration. These commitments are not replaced by the proposed technical defaults below; only genuinely undecided categories are described as being finalised on the public page.

| Purpose / data | Basis proposed | Repository default / retention | Evidence |
| --- | --- | --- | --- |
| Account access and profile | Contract | Until account erasure; public.users tombstone remains. Age date/version erased at that transition. | `docs/adr/0111-account-deletion.md` `packages/db/schema/supabase/0425_age_confirmation.sql` |
| Generation / generated assets | Contract | 90 days for generated assets; holds and linked-content exceptions remain governed by existing flows. | `docs/adr/0008-asset-retention-policy-and-sweep.md` |
| Chat and chat uploads | Contract | Conversations until deletion; uploaded chat images within 24 hours; database backup copy around seven days per existing notice. | `lib/i18n/messages/legal/en/privacy.mjs` `docs/adr/0067-chat-replies-are-jobs.md` |
| Requested Publish uploads and connections | Contract | Completed uploads until removed; abandoned uploads 24 hours; unused file deletion queued after link expiry, normally 20 minutes. Disconnect clears stored tokens; published history remains. | `lib/i18n/messages/legal/en/privacy.mjs` `docs/adr/0111-account-deletion.md` |
| Ledger, balances, top_ups, store_customers | Contract for purchase fulfillment; legitimate interests for accounting/disputes; legal obligations require counsel determination | PROPOSED — owner/counsel to confirm: retained after tombstoning, no expiry sweep / no finite period set by ADR-0111. | `docs/adr/0111-account-deletion.md` |
| Referral rewards and abuse-prevention email digest | Legitimate interests | PROPOSED — owner/counsel to confirm: accounting retained, one-way email hash retained for signup-grant abuse prevention; no finite period specified. | `docs/adr/0111-account-deletion.md` |
| Content reports, appeals, account actions and security events | Legitimate interests | PROPOSED — owner/counsel to confirm: retained evidence/accounting; no general expiry established. | `docs/adr/0111-account-deletion.md` |
| Request logs and necessary Sentry diagnostics | Legitimate interests | PROPOSED — owner/counsel to confirm: sanitized necessary error reporting; no common finite retention established in repo. | `docs/adr/0170-sentry-worker-error-reporting.md` |
| Optional analytics and replay | Consent | Existing notice: events up to 12 months, replay up to 30 days; owner must verify hosted project settings. Withdrawal stops new collection. | `docs/operations/posthog.md` `app/lib/analyticsPrivacy.js` `lib/i18n/messages/legal/en/privacy.mjs` |
| Push delivery | Consent to OS permission; contract for requested completion notices | PROPOSED — owner/counsel to confirm: tokens not seen for 180 days deleted by housekeeping; account erasure removes tokens. Outbox rows expire after 7 days and token-write counters after 1 day; legal policy still needs review. | `docs/adr/0113-mobile-push-notifications.md` `packages/db/schema/supabase/0348_push_tokens.sql` |
| Service messages | Contract | PROPOSED — owner/counsel to confirm: account deletion removes account identity; Resend-side retention is not established in repo. | `packages/adapters/resend.js` `docs/adr/0111-account-deletion.md` |
| Age self-declaration, where requested | Contract / legitimate interests in eligibility | First positive date and statement version, until account erasure. No birth date or negative declaration stored. | `packages/db/schema/supabase/0425_age_confirmation.sql` `lib/minimumAge.js` |

## Owner follow-up

Confirm DPAs and legal roles, transfer mechanisms and provider regions; approve lawful bases and legitimate-interest assessments; choose finite periods for all proposed rows and implement corresponding retention jobs separately. Verify hosted backup/analytics retention and downstream providers. Counsel must review every legal-copy change and translation. This work neither certifies compliance nor enables a processor or feature.


## Translation review status (inspection F2)

All new non-English legal strings are machine-produced drafts and still require native-speaker AND counsel review before publication. The register was checked against surrounding catalog wording: German uses Sie/Ihr, Spanish usted/su, Korean the existing formal imperative; Portuguese follows the surrounding formal address and European phrasing. Japanese, French, Russian, Arabic, Hindi and Chinese new strings retain the surrounding polite/formal or impersonal register. This source comparison is not native or legal approval.

The required `translationsReviewedAgainstEnglishDated` field in `lib/i18n/messages/legal/source-hashes.json` is a mechanical English-source date enforced by `scripts/legal-source-hashes.mjs`; it must not be read as certification of human review. No additional review claims or dates are recorded. The source hashes are regenerated for the conditional recording notice, restored retention commitments and purpose-labelled provider entries; the required English-source date remains 2 November 2026, with no additional review-date bump.

## Public list and recipient roles (inspection 2)

The public privacy notice separates service providers from networks a person chooses to connect; each named entry has a short purpose. Google appears in both roles (sign-in/store purchases versus requested YouTube/Business Profile publishing). Meta, TikTok, LinkedIn, X, Pinterest, Bluesky and Twitch are user-directed social recipients, not represented as processors merely because they appear in this inventory. Owners must confirm each actual legal role. BytePlus remains marked planned. A catalog test checks every public name against this register and checks that no registered vendor is omitted. No provider is enabled by this documentation change.

## Swap data categories (inactive, 2026-11-07)

The existing fal and Crun entries also cover the proposed customer-video plus
reference face-photo flow in [Swap privacy register](swap-privacy-register.md)
(ADR-0329). Pro sends video, up to two face photos and an optional replacement
prompt to fal; Quick sends video and one face photo to Crun. Both offers remain
inactive. No new processor, retention change or DPA/region assurance is implied;
owner review of these categories is required before activation.
