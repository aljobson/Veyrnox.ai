# ADR-0270: Mobile translations, all eleven languages enabled

Status: Machine translated before native review at the owner's request, following ADR-0107.

Date: 2026-10-27

## Scope and catalog contract

All ten app translations are complete and registered below their generated website
catalogs. Website keys always win verbatim. `ACTIVE_LOCALES` follows `LANGUAGES`:
`en`, `es`, `zh`, `hi`, `ar`, `fr`, `pt`, `ru`, `ja`, `de`, `ko`.
The language choice is available on first launch. English wording and behavior,
purchases, consent logic, generation and navigation are unchanged.

The English catalog contains 4,513 app-only keys. Completeness is category-aware:
non-plural keys must all exist, and each of the 64 app plural families must have
every category from the locale's `Intl.PluralRules`. Chinese, Japanese and Korean omit unused
English `one` forms. Japanese’s 64 dead plural `one` entries have been removed.
Ordinary labels such as `share.review.one` are not plural families. Placeholders,
their multiplicity and rich-text slots are preserved exactly. Per-language
`review/<code>-equal.json` files explain unchanged brands, terms and notation;
binding statements use a separate explicit English list. Stale exceptions fail tests.

The existing translated catalog text is retained. The length review includes every
merged-catalog value over 1.6 times its English source, conservatively including
prose and website strings. Added plural categories compare with English `other`.
Integration tests exposed three omitted review flags, now added: Spanish
`calendar.posts.many` and `insights.posts.many`, and French
`freeAllowance.runs.many`. The terminology corrections below update the affected equality and length reviews.

## Long labels in controls

For non-English locales, Button, Chip and SegmentedControl labels permit two lines
and font shrinking down to 0.85, with constrained/shrinkable text inside the control.
A shared control-label context applies the same policy to rich Button/Chip children.
Chips are constrained to their available width. Existing single-line caption text,
including bottom tabs and header captions, retains one line with bounded shrinking.
This is implemented in the UI primitives; the English layout defaults are retained.
Explicit English binding text does not inherit the control-label fit policy.

The rendered-control tests exercise every length-review entry through all three
primitives and rich Button/Chip labels at the default text size, asserting line limits,
font-shrink props and flex shrinking. They also render the actual five bottom-tab
labels and header credit caption in every language. German Create's “Jeder Preis”
remains intact and has a dedicated two-line/shrink regression check. The header
credit chip displays a number; its translated plural label is accessibility text.
These are layout-policy assertions, not native measurements or native linguistic
acceptance. Device review, including larger accessibility text sizes, remains required.

## English binding statements

`src/lib/i18n/binding.ts` explicitly lists these keys, all asserted unchanged in tests:

- `signIn.agree`
- `aiConsent.body`
- `aiConsent.tomakeyourcreationsandansweryour`
- `aiConsent.theyuseitonlytoproduceyour`
- `billing.perRenewsautomaticallyeachuntilyoucancel`
- `form.sourceRights`
- `form.consent`
- `features.ihavepermissiontousethesesources`
- `features.ihavepermissiontousethesesources2`
- `faceFilters.rights`
- `faceFilters.privacy`
- `deleteaccount.thiserasesyouraccountandwhatis`
- `publishUploads.rights`
- `cinemaDrafts.thistitlecontainsnonuditypornographyexplicit`

These are the AI-sharing consent (`ai-share-2026-10-18`), sign-in agreement,
store renewal statement, source/face/publishing rights declarations and Cinema safety
statement, source-file retention disclosures and account-deletion retention notice. The guided-source check is also preserved in English: it hands its rights
confirmation to the model form. The earlier separate AI body fragments are retained
as English too, even though the host uses `aiConsent.body` today.

Cinema's `RIGHTS_TEXT` (rights and truthful AI disclosure, `rights-2026-10-13`) and
`MALWARE_TEXT` are existing English constants in `cinemaDrafts.ts`, not catalog keys.
`SAFETY_TEXT` uses the explicit English lookup. The Cinema policy version remains
`cinema-safety-2026-10-13`. All three actual checkbox elements already carry English
accessibility language. Their wording, versions, required checks and submission
logic are unchanged. The surrounding declarations heading is translated and no
longer incorrectly marked as English.

Cinema Pass is read-only in this checkout (ADR-0207); there is no Pass purchase
consent or Cinema paid-title Unlock consent to translate or mark. `UnlockCard` is
the Publish subscription card and uses the same English renewal builder. No missing
purchase flow is invented.

The sign-in sentence uses the English template with English `label.Terms` and
`chrome.privacyPolicy` substitutions and the unchanged numeric minimum age. The
separate legal links remain translated. Its accessible checkbox is marked
`accessibilityLanguage="en"`. The AI host marks the actual body Text as English;
its title and controls remain translated.

`renewalTerms()` explicitly uses the English template, `billing.intervalWeek`,
`billing.intervalMonth`, `billing.intervalYear`, `billing.yourAppleIDsettings` and
`billing.theGooglePlaysubscriptionspage`, without locale-specific number formatting.
These reusable substitution keys can be translated in catalogs; the binding builder
always selects their English values. Store `priceString` passes through unchanged.
Credits, Publish (including its PriceText wrapper) and Unlock mark the actual renewal
Text as English. Source-rights, guided-source, face-filter and upload checkboxes mark
their actual accessible elements as English. The model form’s `form.consent`, the face-filter flow’s `faceFilters.privacy`, and
the retention notice beside account deletion’s typed confirmation use `english()`
and mark their actual Text as English. Controls and explanatory copy outside
these declarations remain translated. Legal documents and purchase/consent logic are
unchanged.

## Startup direction and explicit choices

The language gate waits for auth restoration, then reconciles the already resolved
stored/device/English locale with native `I18nManager.isRTL`. A direction mismatch
requires a recoverable signed-in session, durable locale + return route + guard, and
a second session-durability check before setting direction and requesting the reload.
The separate `veyrnox.language.direction.v1` record stores this preparation atomically, preserving the current pathname, query
parameters and fragment rather than redirecting signed-out deep links to sign-in.
It never writes `LANGUAGE_SLOT`, creates an explicit choice, changes
`pendingAccountSync` or makes an account-language request. Normal pending-choice sync
is deferred through both the repair request and its recovery startup; a later ordinary
launch can consume it. A device-derived Arabic locale
therefore still has no explicit choice after repair and still needs the language
screen after repair with Arabic active.

A factory and a per-runtime attempt guard serialize concurrent repair calls. Rejected
storage or rejected reloads keep the current session running. A temporarily unsafe
session does not consume the attempt, including when readiness is lost after the
preparation write: the record is cleared before making a retry available. Auth
notifies readiness effects after adoption and refresh completion even when status
remains signed in. The same launch can retry when its session becomes recoverable;
concurrent calls are serialized and only one reload can be requested. A
failed reload attempts to restore the prior native direction and remove its prepared
record. Actual native direction, rather than the previous locale's assumed direction,
is also used by explicit language transitions. Confirming the already-current choice
in first launch or Account invokes reconciliation; only the explicit first-launch
confirmation saves a choice.

**Conservative guard deviation:** JavaScript does not have a reliable native cold-launch
identifier under these constraints. A persisted repair record prevents another
automatic reload on the next startup if direction still disagrees; that startup
consumes the record but remains guarded in memory. A subsequent launch can retry.
Thus an interrupted attempt (for example, process termination after saving the record
but before reload) can require one extra launch. This trades immediate next-launch
retry in that edge case for preventing a reload loop even when a reload resolves but
does not apply direction. No native module or dependency is added. The host must
verify actual native restart/direction behavior; unit tests model both applied and
unapplied reloads.

## Language completion and terminology

The following sections consolidate the language-batch notes. Counts refer to app-only
catalog entries; length flags include merged website values and prose. All languages
retain the fourteen app binding-English statements above and the website-over-app precedence.
Every flagged label receives the shared control treatment described above when rendered
in Button, Chip, SegmentedControl or a single-line caption; none was silently shortened.

### Spanish (es)

Complete: **4,577 keys**, CLDR one/many/other, **113 equality exceptions** and
**411 length flags** (including the two added plural-review entries). Uses neutral
**tú**, créditos, Biblioteca, Crear, Publicar, plantillas and modelos. Chat follows
the site's persona terminology; security follows its Passkey terminology. Film Studio
is Estudio de cine. Vey, Oddlings, Social Cinema, Cinema Pass and Publish keep their
product names. Expanded control labels such as Compartir and Iniciar sesión use
the shared wrapping/shrinking policy.

### Simplified Chinese (zh)

Complete: **4,449 keys**, CLDR other, **46 equality exceptions** and **5 length flags**.
Uses the website's direct voice, 积分, 素材库, 创作, 发布, 模板 and 模型; Publish,
Veyrnox.ai, Vey and Oddlings retain the site's product naming. The ordinary
`share.review.one` label remains. All five flags are age choices
`optionLabels0.option39`–`option43` (“20 多岁” through “60 多岁”); their chip labels
use the shared treatment without shortening.

### Hindi (hi)

Complete: **4,513 keys**, CLDR one/other, **49 equality exceptions** and
**256 length flags**. Uses respectful **आप**, क्रेडिट, लाइब्रेरी, बनाएँ,
पब्लिश करें, टेम्पलेट and मॉडल. Film Studio is फ़िल्म स्टूडियो; Veyrnox.ai,
Vey, Oddlings, Publish Plan and AI Generation retain their product names.
Expanded controls include सत्यापित करें, विज्ञापन and ब्लॉक करें; they receive
the shared two-line/shrink policy.

### Arabic (ar)

Complete: **4,769 keys**, CLDR zero/one/two/few/many/other, **39 equality exceptions**
and **258 length flags**. Uses Modern Standard Arabic and the site's direct
instructional voice: المكتبة, إنشاء, النماذج, القوالب and الرصيد / كريدت.
Publish, Vey and Oddlings follow the site's names; Oddlings passports use جواز الشخصية.
Count labels include explicit singular, dual and few forms where required.
Text-size chips, Brand kit, Email, Retry, queue controls and AI tool labels use
the shared fit policy. Startup direction repair now runs against the enabled Arabic
locale, and all five representative screens have RTL text-style render assertions.
Native Arabic direction and layout review remains required.

### French (fr)

Complete: **4,577 keys**, CLDR one/many/other, **176 equality exceptions** and
**676 length flags** (including the added free-allowance plural-review entry).
Uses formal **vous**, crédits, Bibliothèque, Créer, Publier, modèles,
modèles prédéfinis/prêts à l’emploi and Studio cinéma. Veyrnox.ai, Vey, Oddlings,
Social Cinema, Cinema Pass and Publish Plan retain their names; timeline, prompt
and workflow follow the website. Expanded labels include Accueil, Bibliothèque,
Modèles prêts à l’emploi and Tirer au sort; tabs shrink and other shared controls
permit two lines with bounded shrinking.

### Brazilian Portuguese (pt)

Complete: **4,577 keys**, CLDR one/many/other, **126 equality exceptions** and
**417 length flags**. Uses **você**, Biblioteca, Criar, Publicar, modelos
prontos/templates, modelos, créditos in prose and Credits where retained by the site.
Uses Estúdio de cinema, Plano Publish and chave de acesso; Veyrnox.ai, Vey,
Oddlings, Cinema Pass and LLM Chat remain names. Flags include cancel setup,
unlock, add box, undo and sign-in busy labels; these use the shared control treatment.

### Russian (ru)

Complete: **4,641 keys**, CLDR one/few/many/other, **43 equality exceptions** and
**443 length flags**. Uses polite **вы**, кредиты, Библиотека, Создать,
Публикация, промпт, шаблон, модель, бренд-кит and ключ доступа. Veyrnox.ai,
Vey, Oddlings, Cinema Pass and the Publish brand keep their names; plan headings
use Тариф Publish. Expanded controls
include Воспроизвести, Заблокировать, Использовать, Ключи доступа and character
chips; these use the shared two-line/shrink policy.

### Japanese (ja)

Complete: **4,449 keys**, CLDR other, **49 equality
exceptions** and **2 length flags**. Uses polite です／ます, クレジット,
ライブラリ, 作成, 公開, テンプレート and モデル. Veyrnox, Vey, Oddlings,
Cinema Pass and Publish remain names; Film Studio follows the website’s フィルムスタジオ. The flagged labels
`optionLabels0.option192` (引き締まった体) and `vibe.audience.me` (自分のため)
remain intact and receive the shared control treatment.

### German (de)

Complete: **4,513 keys**, CLDR one/other, **160 equality exceptions** and
**453 length flags**. Uses informal **du**, Credits, Bibliothek, Erstellen,
Veröffentlichen, Vorlagen and Modelle, with the site's brand names retained.
Expanded control labels use the shared treatment; Create's “Jeder Preis” has
an explicit regression test. Existing catalog, screen, binding and direction
coverage is retained.

### Korean (ko)

Complete: **4,449 keys**, CLDR other, **48 equality exceptions** and **2 length flags**.
Uses the website's polite 합니다/해요 style, 크레딧, 라이브러리, 만들기, 게시,
템플릿 and 모델. Veyrnox.ai, Vey, Oddlings, Film Studio, Publish and Cinema Pass
retain their names. Ordinary `.one` labels remain. Both flags, `explore.new` and
`film.new`, use 새로 시작 and receive the shared control treatment without shortening.

## Disclosure and equality audit

The adjacent-disclosure audit found the model form’s AI-provider and one-day
retention statement (`form.consent`), the face-filter source-file retention statement
(`faceFilters.privacy`), the retention notice beside the account-deletion confirmation
(`deleteaccount.thiserasesyouraccountandwhatis`), and OAuth’s account/data-access
permission disclosures. The AI-consent body and its two historical fragments already
use binding English. Sign-in, source rights, guided sources, publishing rights,
Cinema declarations and renewal controls have no further adjacent data-sharing or
retention statement requiring this treatment.

**Website-precedence deviation:** OAuth disclosures are shared website keys rather
than app-only entries. Replacing their generated translations with English would
break verbatim website precedence. `WEBSITE_BINDING_ENGLISH_KEYS` records the
rendering-only English contract for `oauth.summary`, `oauth.summaryPublish`,
`oauth.models`, `oauth.estimate`, `oauth.limit`, `oauth.video`, `oauth.assets`,
`oauth.publishAccess`, `oauth.password`, `oauth.restrictions`,
`oauth.restrictionsPublish` and `oauth.revoke`. The OAuth screen selects their exact
English with `english()` and marks the disclosure Text as English. Generated website
catalogs, permission decisions, scope identifiers and translated controls are unchanged.

**Account-heading deviation:** Arabic Account used `label.Credits`, whose website
value is literally “Credits”; it is absent from `ar-equal.json`. Account now uses the
existing app key `account.creditsSection` (Arabic: الكريدت), matching the website’s
كريدت terminology without overriding a generated website entry. No Arabic equality
exception was removed.

All ten equality lists were reviewed against the public and signed-in website
catalogs. These 17 ordinary labels were corrected and their exceptions removed:

- Spanish and French `chat.skills.group.Plan`: Planificar / Planifier, from
  `app.chat.skill.Plan`.
- Portuguese `analytics.post`, `analytics.posts`, `chat.chats`, `chat.chats2`,
  `comments.post`, `plan.menu.posts`, `publish.post`, `publish.posts`, and
  `filmStudio.studio`: Publicação / Publicações, Conversas / conversas, Publicar
  for the comment action, and Estúdio, following the website’s analytics, chat,
  publishing and navigation catalogs.
- German `editor.tIMELINE`: ZEITLEISTE, preserving the label’s uppercase styling
  while using `app.editor.workspace.timeline` terminology.
- Japanese `film.filmStudio`, `menu.film`, `srch.s.film`: フィルムスタジオ,
  matching `label.Film Studio` and `app.meta.filmStudio.title`.
- Russian `plan.navTitle`, `publishWorkflows.tier.publish`: Тариф Publish, matching
  `publish.plan.colPlan` while retaining the Publish brand.

Chinese, Hindi, Arabic and Korean equality lists needed no changes. Website-backed
loanwords remain, including German Credits, Assets and Passkeys, Portuguese Credits
and Chat, Spanish Chat and Passkeys, and French Timeline and Workflows. Brand names,
format notation, technical units and ordinary same-spelling localized words remain.
The affected length-review entries are updated without shortening the translations.

## Verification and remaining review

Tests iterate every registered app catalog for category-aware completeness, exact
placeholders, actual CLDR selection, fallback-free lookups, equality exceptions,
binding English, website precedence and current length reviews. Language choice,
sign-in, Home, Create and Credits render in all ten translated locales. Rendered
sign-in, AI, Cinema and renewal statements retain their exact English and accessible
language in every locale, preserving the earlier German/Japanese/Arabic coverage.
Direction tests use the production active list and cover stored/device Arabic in LTR,
LTR in native RTL, durable route recovery, absent explicit choice, pending account
metadata, failed prerequisites, same-launch session recovery before and after the
preparation write, readiness-effect notification and reload-loop prevention. Face-filter,
account-deletion and both OAuth permission variants render English disclosures with
English accessibility language across all locales. Arabic Account has a translated-heading
regression check, and Japanese tests reject unused plural categories.

Native review remains pending, prioritizing purchases and credits, consent controls,
account deletion and security. The owner's device acceptance covers first launch,
sign-in, Home, Create, model forms, Credits and Account in German, Japanese and
Arabic, including native RTL, long labels and binding statements.
