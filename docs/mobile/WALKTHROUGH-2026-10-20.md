# New-person walkthrough, first pass (N7), 2026-10-20

**What this is.** A first pass of the plan's N7 on the iPhone 17 Pro simulator against the mock server, on `main` at
`54e165d4`. It is **not** the real-phone run the plan asks for: nothing here was tried on a device, with a real account, a
real provider, VoiceOver or TalkBack. It lists every place a new person would stall, in the order they hit it.

**Route walked.** Signed-out start, Browse first, preview, welcome cards, Explore, a prompt, Create, consent, the result,
Publish, Schedule, Posts. Then Account to sign out.

## Stalls, in order

| # | Where | What a new person sees | Severity |
|---|---|---|---|
| 1 | Sign-in | Apple, Google and email buttons are greyed out until the 18+ box is ticked, and nothing says why. | High: looks broken |
| 2 | Sign-in | "Browse first" is the only live-looking button, so it draws attention away from signing in. | Low |
| 3 | Preview | **Bug, fixed in PR 1421.** No header or Back button, and the tabs sat under the status bar (Cinema was not tappable). | High |
| 4 | Welcome | The last card is sparse: a title, one line, a large empty area, and no Vey. | Low |
| 5 | Explore | Prompt, two buttons, Oddlings banner, search and two chip rows come before any template. The first template is below the fold. | Medium |
| 6 | Create | "Character" and "Cinema camera" toggles have no explanation. | Medium |
| 7 | Create | Good: the price and the refund line show before Generate. | Keep |
| 8 | Consent | The "Before you create" sheet appears at the moment of delight, as a block of text. It is required, so shortening it is the only lever. | Medium |
| 9 | Creating | "Stop waiting… Credits are not refunded" reads as a warning and contradicts "Refunded if it fails" on the previous screen. It only stops waiting. | High: wrong promise |
| 10 | Result | Good: What next (Publish, Make another, Save, Share) is clear. | Keep |
| 11 | Composer | Post now is dimmed until an account is picked, with no reason shown. The account chip does not look selectable. | Medium |
| 12 | Composer | Picking an account inserts a "Different text for Instagram" field and shifts everything down. | Low |
| 13 | Composer | The default is Post now (public, immediate), with Schedule second. | Medium |
| 14 | Schedule | The confirmation shows seconds ("09:00:00") and a day-first date. | Low |
| 15 | After scheduling | It lands on Posts with the post at the top, but gives no "Scheduled" confirmation, and the tab bar and Vey are gone. | Medium |
| 16 | Account | "Delete my account": "Deleting your account from the app is coming." **In-app account deletion is not available.** Apple requires it for store review. | **High: store blocker** |
| 17 | Account | Email row stays on "Loading your details" (likely a mock gap, unconfirmed). | Check on a device |
| 18 | Account | Sign out is at the very bottom of a long list. | Low |

## Not covered

- A real install, real sign-in (Apple, Google, email), real providers, real images (the mock serves gradients), and Connect.
- Permissions in context (Photos, push), and the free-credit amount from a real account (the mock returns 10).
- Large text, VoiceOver, TalkBack, Android, and any slow or offline network.
- The poster art: the mock has none, so template tiles were blank.

## Next

Run the real-phone pass (plan N7) once a signed development build is on a device. Items 1, 9 and 16 are the ones to fix first.
