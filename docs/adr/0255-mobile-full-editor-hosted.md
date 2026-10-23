# ADR-0255: Full mobile editor through a secured hosted workspace

Status: Accepted

## Context

ADR-0247 deliberately shipped the mobile project editor behind a flag with a developer stub while a bundled engine was investigated. The owner subsequently requested the full editor in the mobile app. The production website already has the complete multitrack workspace, responsive phone stages, cloud project autosave, Library integration, generation tools and browser export. Reimplementing that surface natively or maintaining a second generated bundle would delay parity and create two editor products.

The mobile app and website use the same environment and account. The native app can mint a fresh access token without exposing its rotating refresh token. Store billing remains native-only.

## Decision

Normal development, preview and production mobile builds enable `EXPO_PUBLIC_EDITOR_ENABLED=true` and `EXPO_PUBLIC_FULL_EDITOR_ENABLED=true`. Opening a project mounts the existing `/app/editor?project=<uuid>` workspace in an incognito WebView. The earlier bundled stub and native persistence shell remain as an off-by-default fallback during migration; they are not selected by normal EAS profiles.

The native app fetches a fresh access token for each load, reads its subject and expiry, and refuses tokens with less than five minutes remaining. Before the main-frame page bundle runs, it seeds the website's existing session record with the access token and user identity. The refresh token never enters the WebView, URL, logs or page messages. The seed script checks the expected environment origin before writing.

Top-level navigation is limited to the selected environment's exact `/app/editor` path, plus `about:` and `blob:` documents used by the WebView/editor. File-system access, popups and multiple windows are disabled. The page keeps DOM storage because the editor needs its session and recovery draft, but the WebView is incognito so this data is scoped to the view's non-persistent store.

The mobile shell retains the native Back affordance and adds a 44-point Reload action. Loading, session failure, network failure and repeated WebView process death are visible states with an explicit Retry. One content-process death automatically requests a new native token and remounts the editor; a second stops and asks the user before reopening.

All website Credits controls are captured before the website handler runs and route to native `/credits`. Direct top-level navigation to `/app/credits` is also blocked, preserving native in-app purchase as the only mobile purchase path.

## Consequences

Mobile receives the same full editor feature set and project format as the website without a parallel implementation. Website editor deployments also update the mobile editor, so compatibility checks for `/app/editor` become part of mobile release QA. An unavailable web deployment or network connection makes the editor unavailable even though project browsing remains native.

Browser media encoding remains subject to WKWebView/Android WebView memory and codec limits. Automated tests cover the session boundary, navigation boundary, Credits handoff and recovery states; physical-device export performance and download behavior remain release checks rather than claims made by unit tests.

This decision supersedes ADR-0247 D1 and D6 for the selected production editor and rollout flag. ADR-0247's native document shell, protocol and stub remain a fallback implementation until they can be removed in a later cleanup.
