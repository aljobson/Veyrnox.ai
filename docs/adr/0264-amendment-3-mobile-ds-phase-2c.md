# ADR-0264 amendment 3: Mobile design system phase 2c, drawer, Editor, Publish and Account security

Date: 2026-10-27
Status: Implemented; independently reviewed; checked on the iOS simulator in light mode with `MOCK_SECURITY_FIXTURES=1`.

This presentation-only migration applies ADR-0264 tokens and primitives to the menu drawer,
Editor and Publish tabs, Account, and the security components shared by Account and Security.
Navigation, authentication, billing and security requests remain with their existing owners.
ADR-0265's assistant identity and ADR-0266's web restrictions remain unchanged.

## Screens and components

Paths below are relative to `apps/mobile/src`:

- `components/MenuDrawer.tsx`
- `app/(app)/(tabs)/editor.tsx`
- `app/(app)/(tabs)/publish.tsx`
- `app/(app)/account.tsx`
- `components/account/CodeField.tsx`
- `components/account/DevicesCard.tsx`
- `components/account/GrantsCard.tsx`
- `components/account/MfaCard.tsx`
- `components/account/MfaGate.tsx`
- `components/account/PasskeysCard.tsx`
- `components/account/PasswordCard.tsx`
- New `components/account/AccountParts.tsx`, containing the v2 security Card and Status presentation.

Static styles use module-scope `themedStyles` and `useThemedStyles`; text uses the ramp.
Section labels use secondary footnote/caption text. Drawer destinations retain their selected
state, with accent icons and text on accentSubtle. The account destination uses ListRow.
The drawer's modal, scrim, slide timing, Reduce Motion check, modal accessibility isolation,
close actions and navigation handlers are retained. The existing hamburger drawing remains;
menu destination, disclosure and close images use the Phosphor Icon primitive.

Editor keeps workspace selection, refresh, project ordering and every entry point. Its new-project
action is the only filled primary. Publish keeps its brand, capability and billing gates, plan
selection and VeyCardPeek. The dashboard action is its only filled primary; Subscribe is secondary.
Plan selection uses an accentSubtle surface so the price remains warning-toned even when selected.
Prices use warning and tabular figures, including renewal sentences and Account's stay offer.
Only the price fragments in those sentences receive warning ink.

Account navigation rows use ListRow; account deletion entry and security revocations are tertiary
Buttons with danger text. Existing native confirmation alerts retain their destructive confirmation
and cancel actions. Password and TOTP fields use TextField without overriding its shell styling.
CodeField retains digit filtering, six-character length, number-pad keyboard, one-time-code
completion and textContentType. All other field constraints, busy and disabled expressions,
API arguments, i18n keys and explicit accessibility roles, labels and states are retained.

## Primitive additions

`components/ui/Button.tsx` adds optional `tone` for primary, secondary, accent or danger text on
secondary/tertiary buttons. Default behavior and filled primary/destructive ink remain unchanged.

New `components/ui/PriceText.tsx` composes Text for a sentence containing a formatted price. It
preserves the complete sentence and highlights only exact price fragments with warning and tabular
figures. It is exported by `components/ui/index.ts`. Tests cover both additions in light, dark and OLED.

## Legacy shared compatibility

`components/account/shared.tsx` is unchanged, including every style key, numeric legacy value,
DynamicColorIOS value, and its Action, Card and Status exports. Migrated security components no
longer import it. New v2 presentation lives in AccountParts and is included in the migration guard.

Remaining importers include BrandKitEditor, CatalogList, developer parts/keys/logs/webhooks,
privacy-export, review, team-invite, brand-kit, oauth-consent, topups and publish/developer.
The compatibility test compares every exported style property, verifies the iOS light/dark dynamic
colours, and renders the unmigrated BrandKitEditor to check the native input receives the legacy style.

## English copy

Only these app-owned uppercase headings change:

- `editor.home.eyebrow`: “CREATE & CUT” becomes “Create & cut”.
- `publishHome.eyebrow`: “YOUR SOCIAL STUDIO” becomes “Your social studio”.

The two directly referenced web-shared keys, `label.Credits` and `public.account.signOut`, remain
unchanged. No web-shared catalogue values or keys are edited. The menu headings already have
sentence-case English values; their runtime uppercasing is removed. Initials use the original
character without runtime uppercasing. The English registry is regenerated with no content delta;
there are no new keys, and `en/_order.ts` is untouched.

## Security fixtures and coverage

`apps/mobile/dev/mockSecurityFixtures.mjs` supplies one verified TOTP factor, two passkeys, two
devices and one app grant. Its handlers are wired into `dev/mock-server.mjs` with two lines.
They run only with `MOCK_SECURITY_FIXTURES=1`, default off, and are disabled in production.
The fixed TOTP code is `123456`; any other code is rejected. Successful verification returns an
aal2 token pair, and its refresh token preserves aal2. Removing the initial factor allows the
existing enrolment UI to be exercised. New enrolments expose a fixed secret and otpauth URI.
Fixture passkey and grant removal and bulk session revocation mutate isolated server state.
Restarting the mock server resets the fixtures.

New tests under `apps/mobile/__tests__`:

- `securityInteractionsV2.test.tsx`: controlled shared fixtures for enrolment, secret/otpauth display,
  wrong codes, MFA challenge and session adoption, unlock/removal/cancel, password validation,
  passkey add/remove/cancel, device scopes and app-grant confirmation/cancel. Pending promises
  exercise the existing disabled/busy conditions and assert the original API calls and arguments.
- `accountPresentationV2.test.tsx`: legacy import compatibility and Button/PriceText themes.
- `mockSecurityFixtures.test.ts`: opt-in/production gates, fixture counts, endpoint response shapes,
  fixed-code rejection/acceptance, session refresh, enrolment and revocation state transitions.

The only existing test changed is `designSystemV2.test.ts`, to register the four main files and all
account components except the unchanged legacy shared file. All UI files, including PriceText,
are already included through directory enumeration. No existing behavior assertion is removed.
The no-web and Link-asChild guards remain unchanged.

## Deviations

- The drawer scrim remains a plain Pressable. A Button would add layout and press-animation
  behavior to the full-screen dismiss target. Its role, label and close handler are unchanged.
- Drawer geometry, safe-area insets, Animated values, caller-provided hamburger ink, and the
  selected VeyCardPeek margin remain computed styles. Fixed themed sheets cannot represent
  those runtime values while retaining the existing behavior.
- `menu.mcp` remains “MCP”: it is an acronym rather than an uppercase section heading.
- DevicesCard has no device-list endpoint or per-device UI. The two device fixtures support its
  existing “other sessions” and “everywhere” actions; no new device-list behavior is introduced.
- Native passkey creation requires an associated domain and cannot be completed by local HTTP
  fixtures alone. Add/cancel is covered by controlled component tests; the mock supports existing
  passkey list/removal. Native passkey configuration and gates remain unchanged.

## Verification

`cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check && node
scripts/sync-web-legal.mjs --check` passes (229 suites, 4,143 tests). On the iOS simulator with `MOCK_SECURITY_FIXTURES=1`:
the MFA challenge accepted the fixture code and opened the app; Account, Account security (two-factor on, two passkeys,
danger-text removals), Editor and Publish. Dark, OLED and Android are not yet checked on a device.
