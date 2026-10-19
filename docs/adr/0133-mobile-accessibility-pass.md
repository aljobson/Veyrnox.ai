# ADR-0133 — Mobile: accessibility pass (M8 piece 3)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app); the earlier labels, roles and 44 pt pass (#1271); the M8 brief in `docs/mobile/BUILD-BRIEFS-M8-M9-2026-10-18.md`

## Context

An earlier pass gave every control a role and most a label, and set minimum touch targets. This pass checked the rest: the app was run at the largest iOS text size (`xcrun simctl ui <device> content_size accessibility-extra-extra-extra-large`) and every screen was audited in code.

## Found and fixed

1. **Home and sign-in could not scroll.** They were plain views, so at large text sizes the lower buttons were off screen and unreachable. Both now scroll (sign-in also clears the status bar and home indicator itself, as it has no navigation bar).
2. **Header buttons were clipped** at large sizes ("Video files" in Library, "Folder" in a chat, "New post" in Posts), and the title shrank to "Lib…". One `HeaderAction` component caps the label's growth for the fixed-height bar, keeps a 44 pt target and reads as a button with the full label.
3. **The logo wordmark grew with the text size** while the mark beside it did not, and overflowed. It now stays at its design size (the row is read as "Veyrnox.ai").
4. **Fifteen section titles were plain text**, so a screen reader could not jump by heading. They carry the header role (card titles inside tappable cards do not: they are part of the card).
5. **Two text fields had no label** (the referral code and the post caption).

## Kept from the audit

`__tests__/a11yAudit.test.ts` scans every screen and component and fails if: a `Pressable` has no role; a `TextInput` has no label; font scaling is turned off; a screen with four or more controls has no scroll container; a section title lacks the header role; a navigation-bar button is not a `HeaderAction`. It cannot replace a screen-reader pass.

## Not done, and why

- **Reduced motion:** nothing on these screens animates (activity spinners and the operating system's own transitions only), so there is nothing to switch off. No hook was added for it.
- **VoiceOver and TalkBack were not run.** The tools available can screenshot, tap and set the text size, but cannot read the accessibility tree or run a screen reader. Focus order was checked from the code (reading order equals tree order on these screens), not by listening.
- Android was not run. Right-to-left layout is not part of this pass.

## Manual checks for the owner (about 15 minutes, on a real iPhone, VoiceOver on)

1. Sign-in: swipe right through the screen. Expect: Veyrnox.ai (heading), the sign-in line, the age and terms checkbox (with actions for the Terms and Privacy Policy), then three buttons. The buttons read as "dimmed" until the box is ticked. Tick the box with a double tap and sign in.
2. Create: swipe through the tabs (Image, Video, Audio, with the selected one announced), a model, open one, then the prompt field (labelled "Prompt"), the length buttons ("5 seconds"), the price line and Generate.
3. Account: use the rotor set to Headings and move through the section titles (Purchases, Notifications, Credits, Help, Safety, About and contact, Your data). Toggle "Tell me when a creation is ready" and hear its state.
4. Set Settings → Accessibility → Display & Text Size → Larger Text to the largest, and repeat 1 to 3. Nothing should be cut off and every control should be reachable by scrolling. Repeat with Reduce Motion on (nothing should change).
