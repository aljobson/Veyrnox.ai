# ADR-0294: Editorial Cinema series play in an embedded YouTube player on the phone

Status: Implemented for independent review; host simulator verification pending.
Date: 2026-10-28

The owner chose “Embed YouTube”. Editorial episodes remain outside creators'
YouTube videos. This amends ADR-0240: the bundled projection now includes validated
YouTube video IDs, and episodes play inside the phone instead of opening the web
watch page. Creator channel URLs remain excluded. Invalid providers and video IDs
fail generation before writing. The existing web URL helpers are unchanged.

This also amends ADR-0266 group C: editorial series playback is no longer hidden.
The embedded WebView list now includes the editor, Oddlings, Turnstile **and the
editorial YouTube player**. None may break out to a browser. The source guard's
allowed table is unchanged. No new dependency, server API, CSP, Worker, flag,
migration, web player or database watch-screen change is involved.

## Library facts and controls

The installed react-native-webview 14.0.1 implements these behaviors:

1. `src/WebViewShared.tsx` opens URLs outside `originWhitelist` with Linking.
   `originWhitelist={['*']}` therefore routes every navigation to our allow check,
   including app schemes. Only about:blank, about:srcdoc, the exact base document
   and HTTPS youtube-nocookie.com `/embed/` frames are allowed. The predicate does
   not depend on `isTopFrame`, which Android does not provide. No URL is logged.
2. Android's `RNCWebChromeClient.java` can send new windows to the system browser
   when multiple windows are enabled without a handler. We disable multiple
   windows and automatic JavaScript window opening, so the navigation is checked
   in the same view.
3. iOS's `RNCWebViewImpl.m` loads new windows in place without a handler, but
   cancels them when `onOpenWindow` is set. Our handler only shows translated
   blocked-link copy. Link previews and data detectors are disabled too.
4. A top-level embed URL can lack a Referer and receive YouTube Error 153. We load
   local HTML with `baseUrl: 'https://veyrnox.ai/'` and a
   `strict-origin-when-cross-origin` referrer meta tag. Loading this HTML does not
   fetch the base URL; the iframe receives the website's embedding origin.
5. iOS and Android emit `onHttpError` only for main-frame HTTP errors. A local
   main document cannot report a failing YouTube child frame that way. The
   IFrame API's `onReady` and `onError` post player health to React Native; a
   15-second ready timeout catches a missing loader or an unready player.
6. WebView's default error page is English. `onError` prevents that default and
   reports a translated load failure. `renderError` also provides a black view
   without text. Only the native status line contains error copy.
7. iOS injects its message bridge into the main frame only. Android exposes the
   bridge to all origins and normally supplies the sender origin. Messages must
   be strings of at most 200 characters, match the exact ready/error schema, and
   come from an origin equal to `https://veyrnox.ai`. Recognized error codes are
   2, 5, 100, 101, 150 and 153; other codes become null. The Android fallback
   bridge without WebMessageListener reports the main URL for every frame, so a
   forged message could show an error or clear a timeout. It cannot navigate.
8. The root Expo Router navigator is a Slot, rendering only the focused route.
   The public `/editorial/[id]` route is outside `(app)` and its sign-in/MFA gates,
   like `/preview`. Pushing it from `(app)` unmounts that layout. Back restores
   nested stack state but reruns mount effects, including check-in reads. The
   host must verify that return does not show a check-in modal or first-run
   redirect. Signed-in, signed-out and loading states all render the player.
9. `mapAppLink` preserves app-scheme URLs unchanged. History can therefore be
   Account or an unrelated series. “All episodes” always replaces to the current
   episode's own series, even with history. Close means leave: Back if available,
   otherwise the series when signed in or preview when signed out. “All episodes”
   is absent when signed out; adding a signed-out entry point remains out of scope.
10. Android WebView's `onHostPause` does nothing. Our injected pause script needs
    an API-controlled player. There is no static iframe: the constant script
    creates `window.__vp` through `new YT.Player`, with health handlers attached.
    Its wrapper stays `visibility:hidden` until `onReady`, preventing playback
    and hit testing before control is established. Blur/unmount and AppState
    changes away from active call `__vp.pauseVideo()`.

## Document and lifecycle

The config attribute is JSON escaped for all five HTML-sensitive characters.
Both scripts are constant; the translated frame title is assigned using the DOM
property. The player uses host `https://www.youtube-nocookie.com`, start 0, the
validated episode duration as end, playsinline 1, rel 0 and a two-letter locale.
Compared with the web player, the API adds enablejsapi=1 and the config adds
origin=https://veyrnox.ai. rel=0 limits related videos to the same channel; it
cannot disable them completely.

The second script loads `https://www.youtube.com/iframe_api`. The web player does
not use this loader. It is required here for child-frame health and controllable
pause. It has no integrity hash because YouTube revises it in place. It runs in
the local base document; navigation remains governed by `allowEmbedNavigation`
and bridge input by `parseEmbedMessage`. Script loads are not navigations.

A ready event after the timeout still reaches native code and reveals the page.
It clears only the current attempt's timeout status, never a player error, load
error or blocked-link line. Errors supersede blocked lines, not the reverse.
Retry clears status, remounts the WebView and restarts the timer. Callbacks are
bound to their attempt; callbacks from replaced attempts are ignored. Changing
episodes resets the player and its status. iOS uses the house announcement hook;
Android uses a polite live region on the UI Text component, one channel each.

The full-bleed player is at least 200 × 200 points: width is the floored window
width clamped to 200; height is rounded width × 9/16 clamped to 200. Narrow phones
letterbox inside the taller box. Inline and fullscreen playback are allowed,
media requires a user action, file access is disabled, and the view is incognito.
Nothing is downloaded, persistently cached or re-hosted by the app (ADR-0098).
YouTube streams through its embedded player; no app media cache is introduced.

## Verification boundary

Tests cover projection validation, constant HTML and fake API execution,
navigation and message boundaries, all WebView protections, public routing,
series/next/close actions, pause, sizing, error precedence, timer/retry and late
or stale readiness on both platforms. English registry and translated length
reports are generated, including all ten app catalogs.

Host iPhone 17 Pro checks remain required: inline sound after a tap, fullscreen,
ready/referrer behavior, offline timeout and retry, app-link entry over Account,
blocked YouTube links, pause, next, Back and signed-out close. Android and a
320-point device are unit-tested here, not device-verified. Error 153, a rejected
loader or a blocked nested frame must be reported to the plan reviewer with the
blocked origin only; the allow list must not be widened without a revised plan.

Implementation/proof deviations from the frozen work order:

- The requested `@jest-environment jsdom` docblock fails before tests run because
  the installed React Native preset redefines jsdom's nonconfigurable `window`.
  The helper test instead creates an explicit JSDOM instance with outside-only
  script evaluation under the existing preset. It retains the fake API, DOM,
  hidden-player and bridge assertions without new packages or config changes.
- Existing app catalogs and some generated length reports already exceed 500
  lines. Their required data format is preserved; new source and test files stay
  below 500 lines.
- The frozen checkout starts at `0fad9710a`; current local `origin/main` is
  `b5db7305f`, already differing in 335 files before this work. The edit whitelist
  is checked against the checkout's starting HEAD, preserving the frozen base.
