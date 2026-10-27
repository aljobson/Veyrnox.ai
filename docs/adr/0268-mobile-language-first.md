# ADR-0268: Mobile language first, complete string wiring and RTL preparation

Status: Implemented; independently reviewed; checked on the iOS simulator in English. Translations and switching languages on follow in L2.

Date: 2026-10-27

## Decision

L1 remains English only. L2 supplies app-only translations and enables languages in
`ACTIVE_LOCALES`. Before choosing 0268, the GitHub connector read main's ADR directory
(highest standalone number 0267) and searched open pull requests (none).

The translator initializes synchronously before screen modules capture text: an active
stored `LANGUAGE_SLOT` choice wins, followed by the first active device language, then
English. A root language gate precedes sign-in only when authentication has finished
restoring (`status === 'signedOut'`), multiple languages are active, and no active saved
choice exists. Loading and signed-in sessions never display the choice. It lists active languages in `LANGUAGES` order using
their own names and accessibility language tags, with one Continue action. English-only
startup bypasses the gate. Account shows its Language row only with at least two active
languages. Vibe asks only with at least two active languages and no active saved choice
(unless retaking). Both choosers list only active languages. An inactive saved choice
neither changes startup language nor suppresses the Vibe question when multiple
languages are active.

All changes of language use the same transition. Reselecting the current locale returns
success immediately, without writes, direction changes or reload; Account goes back.
On first launch, confirming the already-selected device locale stores the explicit
choice and advances to sign-in without reloading. Vibe similarly records the choice
and advances to its intro. The existing Appearance return slot
must be saved successfully, followed by the language choice, before requesting
`reloadAppAsync`. First launch returns to `/sign-in`; Account returns to `/language`;
Vibe returns to `/vibe`. The live translator stays unchanged until the new runtime
starts, so mounted layouts, navigation titles and accessibility labels cannot partially
switch. A signed-in session must have its current refresh credential persisted, with
no refresh in flight. AuthProvider exposes that condition and tracks the persisted refresh credential.
Memory-only sessions still work and cannot trigger a language reload.

Failed writes or an unsafe session keep the running language/session and show
“Could not change the language. Try again.” Reload rejection attempts to restore the
prior choice and clears the prepared return route. Storage that also rejects rollback
cannot offer a transaction across two SecureStore slots; the running session and
translator nevertheless remain intact.

Account synchronization is tied to explicit choices, using the existing
`PUT /api/v1/account/language` endpoint. Account and Vibe send the chosen locale before
reloading; ordinary launches never resend the saved language. Pre-sign-in choices carry
`pendingAccountSync` in the same version-1 `LANGUAGE_SLOT` record, preserving the existing
locale parser. After sign-in the gate consumes that marker durably before making one
best-effort request. If the marker cannot be consumed, it sends nothing. Inactive
choices are not sent. Consuming before sending prevents remounts and future launches
from overwriting an account preference changed elsewhere; an offline request is not
retried automatically. English still sends null. No endpoint, dependency or native
module was added.

## Strings and formatting

Screen copy, props, validation errors, alerts and shared labels use English area catalogs.
Counts with grammatical forms use `plural`; interpolation uses catalog placeholders.
The English registry is regenerated; `_order.ts`, web keys and generated web catalogs
are untouched. Original English values and the historical key ordering remain intact.

`visible-strings.cjs` parses JSX text, visible props, `Alert.alert` title/message arguments,
and object-literal `title`, `text` and `message` values throughout app, components and lib.
Tests include ternaries, templates, concatenation, placeholders and accessibility
labels/hints. Exceptions are product/brand names, the existing T/CC editor glyphs,
the development-only EditorSpikeHarness, imported Cinema film/episode titles, and
generated legal documents covered by their own parity guard. Three catalog-key tables
(Publish navigation, workflow messages and help-guide metadata) may contain actual
English catalog keys in object values. Other literals in those files remain checked.
The guard does not claim dataflow analysis of arbitrary identifiers: shared helpers
and metadata were audited separately. English catalog values reject HTML entities;
rendered apostrophes stay real apostrophes.

Dynamic catalog keys use stable ids. Skill headings use raw group ids; creator names
use chaos-band and pace ids rather than splitting rendered names. Tests enumerate the
dynamic key families and input ids with Spanish active, validate skill/Vibe source
allowlists, and reject translated/display-text expressions in dynamic keys. English
creator names remain identical across every pace/chaos combination.

Fixed camera/Oddling options, skill groups, feature groups, Film check values and creator
card traits use display-only translation lookups. Saved enum values, prompt assembly,
provider instructions, font names, imported film titles/creator content and user text
retain their original values. Translating those data values would violate the separate
requirement to preserve generation behavior. This is a presentation boundary, not a new
translation fallback for arbitrary user content. Option catalogs are split below 500 lines.

`formatLocale` preserves each call site's English policy (including device-region
formatting, Credits history en-GB dates and en-US credit numbers); other app languages
supply the locale. Numeric translator variables and explicit count displays follow the
app language. Store `priceString` remains untouched. Fixtures cover English with a
German region and Spanish calendar/date/Credits formatting.

## Direction

Language transitions call `I18nManager.allowRTL` and `forceRTL` before the shared reload
only when the target direction differs from the current language. LTR-to-LTR changes
still reload to remount translated screen and navigation copy.
Arabic remains disabled. Leading/trailing spacing and borders use start/end; shared
navigation icons, direct caret images, calendar arrows and the drawer animation mirror.
Navigation glyphs use the shared image Icon to avoid double-mirroring Unicode Bidi
glyphs. Template badges use start positioning. The Full Editor time axis (ruler, tracks,
clips and playhead) explicitly remains LTR; playhead positions use start within that
LTR container, and playback glyphs retain LTR text direction.
Text primitives supply RTL alignment/direction without changing English defaults.
Physical mascot, confetti, media-canvas and playback coordinates intentionally remain
physical rather than mirroring media content. Native navigation owns its header direction.

Native RTL application still needs the host's test build/device check. React Native
[documents these settings as taking effect after restart](https://reactnative.dev/docs/i18nmanager);
Expo provides [reloadAppAsync](https://docs.expo.dev/versions/v58.0.0/sdk/expo/).
No native configuration or app.json changes are included. This is readiness for L2,
not a claim of Arabic translation/native acceptance.

## Verification and limits

Regression tests cover English-only Account/Vibe visibility, first-launch bypass and
active choices, loading/signed-in gate suppression, stored/device fallback, unchanged
selection without reload, persistence failures, session durability, successful
LTR-to-LTR reload, RTL/LTR transitions, reload rejection, one-shot account synchronization,
and remounted navigation titles/accessibility labels. AuthProvider is tested directly
for memory-only credentials, successful persistence, refresh in flight, failed rotated
credential persistence and session loss. Spanish translations used for layout/creator-name
tests are fixtures, not enabled production translations.

Native simulator checks remain with the host, including first install, a test build with
a second active locale, Account language changes, English screen parity and RTL direction.
L2 supplies translations and enables languages after that review.
