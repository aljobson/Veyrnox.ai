# ADR-0107 — Public-site languages

**Status:** Accepted 2026-10-17; `LOCALES_ENABLED` on in staging and production at the owner's request, before native review of the translations.

## Decision

Ten languages besides English for the public marketing site: Spanish `es`, Simplified Chinese `zh`, Hindi `hi`, Arabic `ar` (right to left), French `fr`, Brazilian Portuguese `pt`, Russian `ru`, Japanese `ja`, German `de`, Korean `ko`. English stays at the bare path.

- **URLs:** a language prefix (`/es`, `/fr`, ...). `middleware.js` strips it, rewrites to the English-named route and records the language in the `x-site-locale` request header, set on every page request so a client value never arrives. It is not an identity header and no handler authorises on it. `/en` is not served.
- **Only translated pages take a prefix.** `LOCALIZED_PATHS` in `lib/i18n/locales.mjs` lists them (today: `/`). A prefix on any other path redirects (307) to the English page rather than serving English under a second URL. A page is added to the list in the same change that translates it.
- **Catalogs:** `lib/i18n/messages/<code>.mjs`, flat dotted keys, `{slot}` placeholders; English is the source and fills any gap. `tests/i18nCatalogs.test.mjs` fails on a missing key, an empty value or a changed placeholder. Nav and footer lists keep their English label and look it up as `label.<English label>`.
- **SEO:** `<html lang dir>`, localised title and description, a canonical per language, `hreflang` alternates with `x-default`, localised FAQ structured data, a language switcher of plain links.
- **No automatic redirect** from `Accept-Language`.

## Not done

- Pages other than `/`: pricing, models, guides, presets, tools, about, developers, `/social-cinema`, sitemap entries per language.
- The signed-in app (`/app/*`), the search overlay, the browser-storage notice, error pages, emails.
- Legal pages (terms, privacy, refund, GDPR, acceptable use) stay English until a lawyer-reviewed translation exists. The links from translated pages point at the English text.
- Template names and prompts, model names and blurbs, and the film player labels stay English.

## Review needed

Native-speaker review is a repeatable loop, not a one-off:

1. `node scripts/export-i18n-review.mjs` writes one CSV per language to `.gstack/i18n-review/` (gitignored): every key with the English beside the translation, policy-critical rows (FAQ, packs and tax, refunds, data rights, limits) first, empty Verdict / Corrected / Note columns, and a README for the reviewer.
2. The reviewer marks rows `fix` and fills the corrected text.
3. `node scripts/import-i18n-review.mjs <sheet.csv>` (add `--dry` to preview) writes each fix into the language's catalog, one changed line per correction, and refuses the whole sheet if a placeholder differs from English. Commit the result as a normal PR.

All ten catalogs were machine translated and went live before review (at the owner's request). Each should be read by a native speaker before production, in particular the FAQ answers on commercial use, data rights, watermarking and credit expiry, which are policy statements.

## Rollout

Both environments name `LOCALES_ENABLED` `"true"`. Production was at the var cap, so it replaced the unused `PREMIERES_ENABLED` `"false"`. Rollback: set it `"false"` and deploy; the prefixed paths then answer not-found and the page reads English.

## Amendment 2026-10-18 — phase A public surfaces

The public Social Cinema landing page, discovery, creator workspace and uploads,
analytics, Pass, title, series and watch screens now use the flat catalogs in all
ten languages. This includes comments, voting, rankings, story polls, retention,
sharing and film-player UI labels. Title, series, episode and creator names,
descriptions, user comments and moderation notes remain catalog/user data. The
previous film-player-label exclusion is superseded for UI labels only.

The `/m` prototype screens, OAuth consent, social review links, team invitations,
social connection callbacks and sign-in callback use the same catalogs. Shared
authentication, account-menu, library-picker, clipboard, template-detail and
recipe controls, price-offer cards, background-job notices, browser-storage and
analytics notices, recovery/loading screens and search descriptions are translated.
Vey's public controls, suggested questions and destination labels are translated;
canonical English helper requests remain unchanged internally so the existing
local interpreter still recognizes them. The displayed question uses the catalog.
The Publish-enabled `/mcp` copy also uses the catalogs, including its unchanged
2-credit, 10-minute and 43-day limits.

`/m` takes a language prefix. It remains a sample-data prototype with noindex
metadata; its redirect and tabs preserve the prefix and it remains outside the
sitemap. Social Cinema, creator and Pass paths, title/watch/series families and
preset detail paths are registered together with their translated metadata and
language alternates. Existing noindex settings remain. Entries already present in
the sitemap gain alternates through the existing helper. Legal links keep their
English destinations. Identity/social callback addresses registered with providers
remain unchanged: prefixed callback URLs honor the language, but an unprefixed
provider return remains English. No locale cookie or auth protocol is introduced.

Legal documents still require lawyer-reviewed translations. The signed-in app,
admin, design system, emails, API codes and shared-generation pages remain out of
scope. Model names and blurbs, template names/prompts/recipe data, Oddling and film
catalog data, user content and brand/product names retain their original text.
Shared components use English on these unprefixed routes, as before.

Arbitrary provider errors retain their original text. Vey's generated answers,
English local fallback responses also retain their existing response contract.
Task-step guidance shown on public routes is translated; the app's step records
remain unchanged. Their language needs an explicit decision across the public
helper, signed-in walkthrough and `/help` service; translating the visible controls
does not make those responses multilingual. A proposed follow-up is a locale-aware
response/guide contract, retaining canonical request matching and exact policy
facts. This is a remaining response-data limitation, not a claim that every possible
helper conversation is translated. YouTube embeds receive the site's language through their documented `hl` option.
Cloudflare Stream's hosted controls have no documented UI-language override in
the current player options; they remain provider-controlled. Forcing their labels
through our catalogs would require a separate custom-player decision, beyond
this translation-only change. Native-speaker review of new policy copy is
still required. Numeric policy checks cover the new Cinema, auth, template, billing
and MCP messages; catalog tests also require identical keys and placeholders.

The public-copy audit follows imports from public routes, inventories JSX text,
visible props and conditional/error copy, and classifies catalog lookups and small
explicit exceptions. App-only render branches remain excluded. Run
`node scripts/audit-public-i18n.mjs` for residual candidates and classification;
`--all` includes translated lookups. It is a source inventory, not an assertion
about arbitrary server or user text.

Unknown editorial series use the existing middleware static-page guard and the
page calls `notFound()`. This corrects the prior HTTP-200 behavior accepted during
phase A review. Unknown live title/episode IDs retain their existing client-side
handling; no new HTTP-404 behavior is claimed for those dynamic data routes.

Offline React server-render tests cover German Cinema routes, template details and
public controls, Japanese mobile and helper UI, Arabic credits/authentication, and
Korean invalid/authenticated consent. They inject Next request/navigation and auth
fixtures. URL-level rendering remains unverified when the environment refuses
listening sockets; offline SSR is not a browser or middleware end-to-end check.

The global error document replaces the failed root layout, so it restores its own
provider from a validated public URL language on hydration, including `lang` and
`dir`. Next does not pass the request locale into that client-only boundary. Its
initial server fallback therefore remains English; guaranteeing translated HTML
before hydration would require changing the error/request locale contract.


Phase A review clarification (2026-10-18): the version-bound Cinema Pass and
Unlock consents, creator rights/AI-disclosure declaration (`rights-2026-10-13`),
and safety and malware declarations remain the exact English legal statements
until lawyer-reviewed translations exist. Their existing consent, rights and
policy version identifiers are unchanged. These statements are explicitly marked
`lang="en" dir="ltr"` within translated forms; no machine translation accompanies
them. Surrounding controls and non-binding explanations remain translated. This
is the same legal-text exception as the English legal documents, and overrides
the earlier amendment's inclusion of these binding statements in translated copy.

## Amendment 2026-10-18 — phase B app display preference

The signed-in app uses the `veyrnox_locale` browser cookie, never a URL prefix or
an account setting. Its accepted non-English values are `es`, `zh`, `hi`, `ar`,
`fr`, `pt`, `ru`, `ja`, `de` and `ko`. Absence, invalid values, wrong case and
ambiguous duplicate cookies mean English. Choosing English expires the cookie.
It has `Path=/`, `SameSite=Lax`, a one-year lifetime and `Secure` in production;
it is not HttpOnly because the language controls write it.

The cookie is sent with same-origin requests like any cookie, but only page rendering reads it.

No API handler, RPC, authorization decision, rate limit, billing or ledger path,
or database write reads this preference or changes behavior because of it. No
API payload carries the language, and API error codes remain language-neutral.
The middleware reads it only for `/app` and `/app/*` page rendering, and sets
`x-site-locale` to the validated preference or `en`. It overwrites inbound locale
and site-path headers, rather than deleting them, because OpenNext overlays set
headers on inbound headers. Public pages retain their URL-selected language;
public unprefixed pages and legal documents ignore this cookie. Prefixed app
paths still redirect to their unprefixed address. `LOCALES_ENABLED` off ignores
the cookie and uses English. Admin pages always use English.

Both public language controls remember the choice. App navigation offers the
same menu; app links retain the unprefixed route. The root document receives the
validated language and Arabic direction through the existing `lang` / `dir`
contract. Edited navigation, Library cards and chat panel edges use logical
start/end placement. Existing English number-format locales are retained;
non-English number and relative-date formatting use the selected locale.

App-only messages live in flat area catalogs at
`lib/i18n/messages/app/<code>/<area>.mjs`, aggregated by `<code>.mjs`.
The server imports these only for app routes, including the English
admin shell, and passes the selected merged messages to a provider in the app template.
The template also loads on client navigation from public pages, where the root
layout persists; its language/direction wrapper keeps the app subtree correct.
The public translator does not import these catalogs, and public pages keep their
existing provider loading behavior. Catalog checks cover all eleven app catalogs,
all public catalogs, placeholders, duplicate keys and numeric policy facts.

The phase B work order still requires all non-admin app UI and its shared
components to be translated. The current implementation covers app navigation,
the main Account page, Library access and main-page copy, and portions of the
Create, Publish and chat workspaces. It is **not a completed phase B rollout**:
account subpanels, billing, editor, video agent, personas, Publish subpages and
many shared controls and error messages still contain untranslated UI. The app
coverage test fails on those residuals; they are not exempted or allowlisted.
Run `node scripts/audit-public-i18n.mjs --app` for the source inventory. This
status records incomplete implementation, not a decision to reduce the scope.

Admin, legal documents, emails, API responses, model names/blurbs, templates and
prompts, Oddling/Cinema catalog data, brand names, user content and provider output
retain their existing language. Version-bound binding statements remain exact
English until lawyer-reviewed translations exist. The source-upload rights
statement in `SourceRightsConfirmation.jsx` is marked `lang="en" dir="ltr"`;
its existing consent payload is unchanged. Credit checkout/subscription, Publish
plan, deletion and other binding statements remain untranslated alongside their
currently untranslated forms. Phase A's explicit English Cinema declarations
remain unchanged. They must retain their English markup when those remaining
forms are localized.

Library tab/kind/view keys are closed sets from `STATE_TABS`, `KIND_TABS` and
`VIEWS` in `libraryFilter.js`; the persisted view is checked by `readView`.
Server job states and Create error codes use `tOr`, with existing safe English
copy or a translated default when a key is unknown. Library selection plurals
and navigation asset nouns use `Intl.PluralRules`, including Arabic and Russian
categories. Source extraction for Vey resolves app English catalogs as well as
public English. A retention fixture captures the 32 non-admin app routes from
`origin/main` at `22945bc0` before this change.

### Phase B Publish batch (2026-10-18; implementation in progress)

The app catalog indexes now merge area files. Each area must have the same keys
and placeholders in all eleven languages; tests reject duplicate keys within or
across areas and files exceeding 800 lines. This does not change the public
catalog import graph. The app header and mobile menu both expose the persistent
language choice; the two menus have distinct accessibility IDs.

Publish's plan checkout declaration beginning “Start my Publish Plan at” remains
English, with `lang="en" dir="ltr"`, including its price, tax, billing interval
and automatic-renewal acceptance. It is submitted with `consent_version` and
uses the original English currency formatter. Device-upload rights confirmation
is translated: its request carries a boolean `rights_confirmed`, not a consent
version identifier. Neither request gains a locale field.

The completed Publish components use `tOr` for server statuses, roles, network
labels, billing intervals and upload error codes. Network brand names and user
content remain unchanged. Draft and click counts use `Intl.PluralRules`;
English click wording remains the original “clicks”, including for one click.
Date and currency formatting retains the original English locale choices.
SVG path coordinates and literal link-editor URLs are technical data, not copy.

The global coverage test remains strict and reports unresolved totals by area.
A separate Publish regression test protects completed components without
exempting any other Publish file from the global inventory. The remaining
Publish screens are still unfinished; this amendment does not reduce the work
order or authorize a rollout of the partial translations.

Editor mobile-stage IDs and aspect values remain fixed machine values in
`MOBILE_STAGES` and `ASPECTS`; only their labels are translated. Analytics date
presets are the closed `RANGES` list. Dynamic provider types, capability labels
and statuses use `tOr` fallbacks. Editor DOM queries and e2e navigation use stable
hooks; the knowledge generator resolves their labels from the actual JSX.

### Phase B continuation: editor rights statement (2026-10-18)

The consent checkbox in `app/veyrnox/_components/editor/GenerationPanel.js`
attests to `RIGHTS_ATTESTATION_VERSION` (`aup-2026-09-26`), recorded by the
existing generations handler and `attest_upload_rights`. Its complete ownership,
identifiable-person, brand/artwork/recording declaration, Acceptable Use link text,
and account-recording sentence remain English inside `lang="en" dir="ltr"`.
The audit recognises only these exact legal fragments; other literals remain
subject to the strict coverage test. Generated camera directions, model/catalog
content, user drafts, captions and provider diagnostics retain their source text.

### Phase B continuation: subscription checkout consent (2026-10-18)

The checkout declaration in `CreditSubscriptions.js`, beginning “I agree to”
and ending “expire without rollover.”, remains English inside `lang="en"
dir="ltr"`. It is submitted with the existing `catalog.consent_version`. Its
plan names, US-dollar price, interval and Credits retain the original English
formatting. The cancellation confirmation has no version identifier in its
request and is translated. The audit exempts only the six exact checkout
fragments, not the surrounding billing controls or policy explanations.

### Phase B continuation: chat media rights (2026-10-18)

`chat/MediaComposer.js` keeps its upload rights declaration and Acceptable Use
Policy link in English inside `lang="en" dir="ltr"`. The generations endpoint
records this consent under `RIGHTS_ATTESTATION_VERSION`, as for GenerationPanel.
Only the two exact declaration fragments are exempted from the literal audit.
No request payload, version identifier or authorization behavior changes.

### Phase B continuation: credit-pack consent (2026-10-18)

`TopUpPacks` keeps the complete `supply-consent-v1` acceptance statement in English, byte-for-byte, inside `lang="en" dir="ltr"`. Its translated refund-policy link is outside that English span. The version and consent payload remain unchanged; translating this acceptance requires a separately approved legal version. Keyboard chord identifiers and catalog preset/model names remain unchanged. The app catalogs continue to load only at the signed-in boundary, split into area modules.

### Amendment — editor and account rendering, 2026-10-18

The local editing assistant still parses four fixed English command examples. Those
examples remain verbatim, with `lang="en" dir="ltr"`; translating them would make
the advertised commands unusable. The audit exception names each accepted command
and does not exempt other assistant copy. The generated plan descriptions and
validation messages from the existing local helper still require a separate
localization pass; they are not evidence of completed helper coverage.

The multitrack timeline's chronological canvas keeps an explicit left-to-right
time axis so pointer coordinates, trim gestures and horizontal scrolling retain
their existing meaning. Surrounding Arabic controls inherit RTL and use logical
placement classes. Track names, captions and marker names remain user content.

Saved-video publishing confirmation and custom-font permission are boolean/local
rights declarations without a version identifier, and their UI copy is translated.
Previously listed version-bound legal statements remain English. Form enum values,
report categories, CSV headers, codec names and stored project identifiers do not
change with display language. Report category labels are selected from the fixed
`CATEGORIES` list; film workflow labels branch on the closed image/video pair;
trim labels branch on the closed `TRIM_EDGES` pair. Server-provided sanction actions,
credit job states and export-quality labels use `tOr` with a display fallback.

### Amendment — local controls and account confirmations, 2026-10-19

Account deletion, OAuth revocation and passkey removal confirmations do not submit
an acceptance-version identifier, so their display copy is translated. Deletion
still requires the exact `DELETE` input and the existing opaque confirmation
token. Existing version-bound consent statements remain English. OAuth scopes,
passkey IDs and source-slot IDs are unchanged; names supplied by users or clients
remain verbatim. Unknown deletion blockers and ledger kinds use translated safe
fallbacks through `tOr`.

The legacy timeline, like the multitrack timeline, keeps an explicit LTR time axis
for pointer and keyboard editing; its placement styles use logical properties.
Workspace dock values remain the closed `left`/`right`/`hidden` set while their
labels translate. Composer labels use the closed `COMPOSER_KINDS` table and mode
labels use `replyMode()`/`REPLY_MODES`; typography switches use the fixed
`italic`/`underline` pair. These display translations do not change stored enums.

### Phase B continuation: local media controls (2026-10-19)

Canvas selection handles retain an explicit LTR coordinate space, like the
existing timeline, so horizontal pointer movement still matches the rendered
image. Their placement uses logical properties. Transport buttons and editable
timecodes retain their chronological LTR order; surrounding controls follow the
page direction. Displayed non-English numbers use `localeTag`; English precision,
spacing and timecode syntax remain unchanged.

Mask dimension labels use the closed `x`/`y`/`width`/`height` key table. Select
controls keep their existing stored option values and use `tOr` for display;
unknown provider labels remain verbatim. Film test verdicts use `tOr` with a
translated unknown fallback. Film prompt content, reference names and user text
are unchanged. No consent statement, rights identifier or API locale field is
changed in this round. The film import E2E control uses `film-import-json` rather
than its translated accessible name.

### Phase B remainder: app controls and validation (2026-10-19)

The frozen remainder work order's 32 files now resolve their visible UI copy
through the existing app catalogs. The strict app inventory reaches zero
unresolved candidates without adding audit exceptions. This supersedes the
remaining-literal count above; it does not claim that arbitrary provider output,
user content, or helper responses outside these display sites are translated.

Creation settings and goals, source-duration and rights guidance, audio-stem
controls, Oddling controls, referral and credit history/usage, chat skill cards,
Film boards/passports/master saving, Publish activity and the remaining editor
and film metadata use all eleven catalogs. Known Film validation templates,
master-save errors/progress, and Publish activity actions/errors are translated
at their display sites; the underlying helpers, payloads and stored IDs retain
their existing contracts. Unknown error codes use a safe translated fallback;
unknown provider prose and user content retain their original text. English
activity action fallbacks retain the existing human-readable presentation.

The complete ownership/identifiable-person/brand/artwork/recording statement in
`SourceRightsConfirmation.jsx`, including its Acceptable Use link and recording
sentence, remains exact English within `lang="en" dir="ltr"`. It is the existing
`RIGHTS_ATTESTATION_VERSION` (`aup-2026-09-26`) declaration, not a new consent.
The surrounding confirmation status and per-tab explanation are translated.
`FilmMasterSave` sends only the existing boolean `rights_confirmed`; its rights
checkbox text is translated, as with the previously documented saved-video
confirmation. No consent version or API locale field changes.

Oddling names, hooks, identity/trait descriptors, preset collection titles and
motion names/phrases remain source catalog data. Camera/lens model names and
photographic settings, model-family brand names, model names, user filenames,
asset tags/versions, prompts, reference captions, and generated draft content
remain unchanged. Film style-board names are also persistent catalog IDs.
The `cr` abbreviation retains the existing Credits product convention. Skill
card names and explanations translate; their canonical assistant instructions
and stored skill IDs remain unchanged.

English number/date formats and singular/plural wording are pinned by offline
React render fixtures extracted from main commit
`1675cf4d1061bd822bc2f6738ac512abe5dc043f`. Other locales use `localeTag` and
`Intl.PluralRules`. Numeric policy fixtures are extracted from that same English
source, including referral percentages/delays, source limits, reference counts,
master size/format/retention limits and usage periods. Catalog validation checks
identical keys/placeholders, numeric facts and duplicates across all languages.
Logical placement preserves Arabic flow; SVG/transition geometry is unchanged.
Create goals, Library downloads and empty top-up history have stable data hooks
used by their existing E2E tests instead of translated selector text. Offline
renders are not a browser or end-to-end execution claim.

The frozen remainder scope excludes `lib/generatedProductInventory.js` and its
extractor. The source edits make its strict freshness test fail. Regenerating
that tracked artifact with `npm run sync:vey-knowledge` is a proposed follow-up
scope change, not performed as part of this work order. The freshness assertion
remains unchanged; the checked-in inventory must be refreshed before a green
full-suite result can be claimed outside the two sandbox socket failures.

## Amendment 2026-10-20 — phase C1: convenience translations; English governs

The owner authorizes machine translations of the six legal documents and the
binding consent statements in es, zh, hi, ar, fr, pt, ru, ja, de and ko. This
supersedes the earlier requirement to wait for a lawyer-reviewed translation.
Every translated document must say, in its own language, that it is a machine
translation for convenience, has not been reviewed by a lawyer, and that the
English text governs any difference. Its unchanged English document is one
click away. Public documents use language prefixes; app statements use the
existing browser preference. No account language setting is introduced.

`BindingText` retains the original English statement and its `lang="en" dir="ltr"`
markup, with a separate translated block immediately below. The block includes
the governing-English notice and says that agreement is to the English text
above. The checkbox, button, consent version identifiers and request payloads
are unchanged. No API, server policy, database, authorization or billing change
is made. What the person agrees to remains the English text.

Legal documents use stable message and inline-element IDs in per-language
`lib/i18n/messages/legal/<code>/<document>.mjs` catalogs. Shared structure retains
English headings, lists, links and anchors; tests compare complete English
markup to origin/main `18f835916db97793ab50917956bf7f5b9968c892`. Numeric policy facts
and placeholders must agree. Dates retain their underlying UTC date and Latin
digits; non-English month/day order follows `Intl` and `localeTag`. English date
strings remain exact. This interprets the date-formatting instruction as an
exception to retaining the literal English date string.

The literal audit now validates each binding's English text against the paired
catalog instead of exempting version-bound English fragments. Legal pages are
included, including pages whose JSX is supplied by the shared document renderer;
a missing language catalog is unresolved. Native-speaker review remains needed.

All six documents now have complete ten-language catalogs and are registered
for prefixes, canonical/hreflang and existing sitemap alternates. All eleven
binding statements have translations. Tests cover the notice, English link and
metadata on every translated document, all catalog keys and placeholders,
duplicate keys, numeric and link facts, and the original English renders.

Admin, emails and an account language setting remain outside C1. Brand, company
and product names, company number, registered address, email addresses, statutory
references, section numbers, prices, credit amounts and durations retain their
source facts. User/catalog/provider content and the existing English-only local
editor command parser are unchanged. Regenerate the product inventory with
`npm run sync:vey-knowledge`; its legal source reader now follows the English
catalogs and shared document structure.

C1 review fixes: the only grouped legal number is two thousand in Terms
`b014`: de/pt use `2.000`, es `2000`, fr `2 000` (U+202F), ru `2 000`
(U+00A0), ar `2٬000` (U+066C), and en/zh/ja/ko/hi `2,000`.
Numeric parity normalizes grouping and Arabic-Indic/Devanagari digits.
Terms `b016` quotes the same English supply source as checkout, isolated with
`lang="en" dir="ltr"`, followed by a localized explanation that English governs.
It no longer substitutes a translated quotation for the actual statement.

`BindingText` wraps the original label and emits the convenience translation
as its sibling, with a unique ID referenced by the checkbox's `aria-describedby`.
Existing descriptions are retained. The English path emits the original label
without a new description or block; English labels, flags and payloads are pinned
by render and contract tests. Binding anchor destinations and English labels are
also recorded in the source manifest. The hard-wall scan includes legal structures
and all message catalogs and skips binary files without changing banned terms.

After changing English legal, binding or chrome text, re-translate or confirm every affected translation.
Run `node scripts/legal-source-hashes.mjs --update` to record English SHA-256 hashes, anchors and each document's reviewed-against date.
Review that manifest diff; run the default hash check, both translation audits, tests, lint and `npm run sync:vey-knowledge`.
