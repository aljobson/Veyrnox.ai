# ADR-0106 — Public-site languages

**Status:** Proposed 2026-10-17; built behind `LOCALES_ENABLED` (on in staging, absent in production).

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

The nine catalogs were machine translated. Each should be read by a native speaker before production, in particular the FAQ answers on commercial use, data rights, watermarking and credit expiry, which are policy statements.

## Rollout

Staging first (`LOCALES_ENABLED` is `"true"` there). Production: add the var and deploy. Rollback: remove it; the prefixed paths then answer not-found and the page reads English.
