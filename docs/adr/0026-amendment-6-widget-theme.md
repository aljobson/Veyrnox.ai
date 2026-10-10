# ADR-0026 amendment 6 (2026-10-10): the widget takes the site's theme

- **Status**: Proposed. The owner accepts it by merging the change.
- **Amends**: [ADR-0026: Turnstile CAPTCHA on sign-up and sign-in](0026-turnstile-captcha-on-auth.md). It follows
  amendment 5. It is a file of its own because ADR-0026 is at the 500-line limit.
- **Scope**: browser only, appearance only. One option on the widget. No route, migration, switch, new wording or CSP change.

## Context

The sign-in dialog is dark unless the visitor chose the light theme. The
widget inside it was not: at its default it follows the visitor's system
setting, so on a system set to light it is a white box in a dark dialog
(seen in one browser, below). The owner asked for the captcha to be themed.

## What Turnstile reports

Read on 2026-10-10 in Cloudflare's widget configuration reference
(`developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/`):

- `theme` takes `light`, `dark` or `auto`. `auto` is the default and
  "respects the visitor preference", meaning the system's light or dark
  setting.
- The reference lists it under "Theme options", described as the widget's
  visual appearance. When the widget shows (`appearance`) and when the
  challenge runs (`execution`) are separate options with their own sections.
- Cloudflare recommends `auto` for most sites.

## Decision

The widget is given the site's theme when it is rendered:
`theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'`
in `components/Turnstile.jsx`.

The site does not follow the operating system (see the comment on the theme
tokens in `app/globals.css`): it is dark, and light only when the visitor
picks it with the toggle, which writes `data-theme` on `<html>`. As we read
it, Cloudflare's recommendation of `auto` fits a page that follows the
system. Ours does not, so `auto` made the widget disagree with the page
around it. The visitor's own choice on this site is the preference the
widget now follows.

## What does not change

The check. Same site key, Managed mode, explicit rendering. `retry`,
`retry-interval`, `refresh-timeout` and `appearance` are still at their
defaults, as amendment 3 recorded them, and so is `execution`. The five callbacks, the
notices and the count of failed checks are untouched. No request goes to
Auth without a token. The CSP is untouched: the widget loads from the same
host.

Amendment 3 said the widget "leaves every option at its default", and
amendment 4 that it passes six options. From this amendment it passes seven,
and one of them, `theme`, is not at its default. `tests/turnstileFailure.test.mjs`
pins the list: an option written like the others, on its own line at the
object's indentation, cannot be added without that test failing. It reads
the source as text, so it is a tripwire for the ordinary case, not a proof.

## A limit

The theme is read once, when the widget is rendered. If the site's theme
changes while the dialog is open, the widget keeps its old colours until the
dialog is opened again. The dialog covers the page, so the toggle cannot be
clicked while it is open, and Tab from inside the dialog stays inside it.
The page behind is not inert, so this is not a guarantee; it was read from
`components/AuthGate.jsx`, not tried.

## What was and was not seen

Seen on a local build on 2026-10-10, in a headless browser whose system
setting is light:

- With a stand-in for Cloudflare's script that records the options: the
  widget was given seven options, `theme: 'dark'` among them. After the
  visitor switched the site to light and reopened the dialog it was given
  `theme: 'light'`, and `'dark'` again after switching back.
- With Cloudflare's test site key that shows the checkbox
  (`3x00000000000000000000FF`, a temporary local change, not committed): the
  real widget drew its dark version inside the dark dialog. The box was not
  ticked.

Seen on production before the change, same day: the widget was white inside
the dark dialog in that same browser.

Not seen: the real site key with the new option. On localhost it fails the
hostname check (110200) before anything is drawn. That the option changes
nothing about how the check runs rests on Cloudflare's reference, not on a
test of ours.
