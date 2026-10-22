# ADR-0252: Film Studio on the phone lists the films saved to the account

Status: Proposed

## Context

The authenticated Film Studio reads shipped in ADR-0245. They require both
`TENANT_PROJECTS_ENABLED` and `FILM_STUDIO_CLOUD_ENABLED` to be exactly `true`.
This phone slice does not require Part B. It makes no assumption about a web Save
button or a cloud query-parameter handoff. The existing file import remains available.

## Decisions

The optional Film Studio link appears only after a successful list read with at
least one valid film. Empty, malformed, unavailable and failed reads leave it absent.
The introduction neutrally describes both file exports and films saved to the account.
The cloud screen supports direct entry, loading, an empty list, unavailable, offline,
busy and generic failure states. It displays at most 20 films in server order, with
validated UUIDs, revisions, names, shot counts and optional dates. A drift test pins
the server fields, routes, gates, cap, SQL bounds and UUID expression.

The phone uses only GET through the existing authenticated ApiClient. HTTP statuses
are mapped to sentences; no server error messages, codes or statuses are displayed.
A missing individual film is announced and refreshes the list. Controls have labels,
44-point touch targets and busy/disabled states. Failures use polite live regions and
open failures are announced. No animation is added: only the system ActivityIndicator
moves, so there is no custom animation for reduced motion to disable.

Neither the list nor a cloud-opened film is persisted. The original `studio_json`
string is validated with parseFilm and retained byte-for-byte in one memory slot,
alongside the parsed film, owner and opening time. Lock and prompt contexts remain
unchanged. Opening does not call saveStudio, clearStudio, cache.read or cache.write.
There is no persistence check or saveFailed state. This supersedes the disk-write and
cleanup proposals in revisions 1–3 of the work order.

**A cloud film lives only until the app restarts, sign-out, wipe or account change.**
It can be reopened from the account list; the server film is unchanged. The screen
explains that opened films stay until the app closes. File-import copies continue to
persist under the existing per-user filmStudio policy. A cloud open takes precedence
while its memory slot exists; it does not erase an older file-import cache entry.

Every cache-user notification synchronously clears the slot, including signing out
and back into the same account. An open subscribes before requesting and permanently
invalidates itself on any such notification. Its ownership check and slot assignment
are synchronous. Screen unmount also invalidates a pending open. The mounted index,
cloud list and shot screen discard their own state and ignore older load generations
on notifications, then reload for the current session. No cleanup writes null or
removes a newer operation's copy. The existing import path's native disk behaviour
is unchanged and is outside this feature's scope.

Opening confirms replacement when there is an active film. All rows are disabled
during confirmation and opening. Success uses dismissTo('/film'); the index reloads
through loadActiveStudio on focus so an existing route shows the newly opened film.
The shot reader uses the same active source. An invalid, cancelled or throwing import
keeps the active cloud film. A successful import clears the slot after saveStudio
succeeds. Remove clears the current account's imported copy and then the memory slot.
Session generations prevent pending UI actions from restoring dropped screen state.

English keys live in the new filmCloud catalog; the English registry is generated.
Other locales use the existing English fallback. No historical catalog order changes.

## Owner decisions

These are the owner's calls, recorded here so they are not mistaken for implementation details:

- The existing `/film` sentence "not on our servers" is replaced by neutral wording in every state, because it stops being true once a film is saved to the account.
- The "Films saved to your account" row is hidden when the person has no saved films, so `/film` looks unchanged until the server flags are on.
- An opened cloud film lives in memory only and is gone after an app restart, a sign-out or an account change; the person reopens it from the list.
- Turning on `FILM_STUDIO_CLOUD_ENABLED` and `TENANT_PROJECTS_ENABLED` stays with the owner (staging first).

## Out of scope

No phone save, edit, rename or removal on the server; no pagination, search, price,
generation, analytics or logging; no new storage, cache policy, flag or dependency.
No server, migration, web, Library, Create handoff or Film chats change. No ADR index
or README edit. The existing shot's Create/share behaviour remains as before, with
its controls removed when the owning session is dropped.

## Not proved

No device run, VoiceOver or TalkBack pass was performed. Flags are off in production,
so nothing was exercised against the real server. Staging verification needs both
flags enabled and a film saved manually through the API. Unit and rendered-screen
tests cover the parser, original text, no disk writes, error copy, replacement,
focus reload, failed imports, and account/session invalidation.
