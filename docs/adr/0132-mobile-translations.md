# ADR-0132 — Mobile: translations (wired, English on)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0107](0107-public-site-languages.md) (the site's languages), [ADR-0106](0106-mobile-app.md) (the app); the M8 brief in `docs/mobile/BUILD-BRIEFS-M8-M9-2026-10-18.md`

## Context

The app had a translator (`src/lib/i18n`, eleven languages, an English catalog with four keys) but no screen used it, and nothing ever read the device language, so the app was English only. The public site already has ten translations (ADR-0107), machine translated and not yet reviewed by native speakers.

## Decisions

1. **The main screens use `t()`**: sign-in, email sign-in, Home, Create (list and form), Job, Library, Account and Credits, plus the email form's fixed messages and the legal link names. Every visible string there is a catalog key. About 130 strings; credit counts and seconds use plural forms.
2. **Shared strings keep the site's key and exact wording.** 27 strings equal the site's English (Library, Sign in, Terms, Continue with Apple, ...). They are listed in `webKeys.json`, the English catalog uses the site's key names, and a test fails if the app's English drifts from the site's.
3. **Ten catalogs ship, generated, never edited.** `scripts/sync-web-i18n.mjs` copies the site's translation of those 27 keys, verbatim, into `messages/<code>.ts`, and rewrites `docs/mobile/I18N-NEW-KEYS.md`, the list of app-only keys for the localization process (no machine translation was done for the app). `--check` fails on drift.
4. **Device language without a new dependency.** `src/lib/i18n/device.ts` reads iOS's language list or Android's locale, with `Intl` as a last resort, once at start. No native module was added, so no rebuild is needed.
5. **Only English is switched on** (`ACTIVE_LOCALES = ['en']`). Only about a fifth of the strings have a site translation, so turning a language on now would show screens in two languages. Turning one on is adding its code to `ACTIVE_LOCALES` once the localization process has returned its app-only strings (and the owner accepts the site's unreviewed translations for it). Until then nothing visible changes.
6. **Right-to-left is not done.** Arabic needs `I18nManager.forceRTL` and a restart; it is off with the rest.
7. Text that stays as it was: the AI-sharing consent and offline messages (their own constants), delete-confirmation texts, date and number formatting (still the device's), and every screen outside the list above.

## Not proved

- A translated screen was never shown on a device: only English is on, and the simulator is English. Translation lookup, fallback and the site's wording are covered by unit tests.
- Device language detection ran on the simulator (English); iOS and Android language lists are covered by unit tests with injected values.

## Consequences

- Adding a string means adding a key to `en.ts` and re-running the script, which updates the list for localization.
- The remaining screens (chat, publish, projects, Cinema, help, appeals, referrals and others) still hold English text and are the next wiring slice.
