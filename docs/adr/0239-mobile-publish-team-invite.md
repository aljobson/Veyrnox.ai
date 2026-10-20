# ADR-0239 — Mobile: invite a person to a brand and share the invitation link

**Status:** Proposed 2026-10-20
**Related:** [ADR-0238](0238-mobile-publish-approval-create.md) (same bearer-link decision), [ADR-0187](0187-mobile-publish-team-manage.md) (role change and removal), parity phase P5

## Decision

With the owner's "buildit" on sharing bearer links (ADR-0238), the Team screen gets an "Invite someone" section for owners and managers: an email address and a role (manager is offered to owners only), a dialog naming the person and the role, then the invitation. The route answers with a private invitation link, shown once under the form with a Share button that opens the system share sheet. The link is kept only if it is https and its path is `/social/team/invite/...`; it is never stored, logged or put in a notification, and the team list still never reads links. The text says that anyone signed in with that email can use it.

**Not built:** accepting an invitation inside the app. The link opens on the web; opening it in the app needs an app-link path for `/social/team/invite/...` in the app's link config (not in this slice's files). Until then accepting happens in the browser.

No server change, no dependency, no flag. Unit tests only; the screen was not run on a device.

The link's host is pinned: it is kept only when its origin equals the app's own API origin (the one every request uses), with no userinfo, so a link on another host or a lookalike is dropped, not shared.
