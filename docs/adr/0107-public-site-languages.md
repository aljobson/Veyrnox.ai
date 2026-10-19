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
