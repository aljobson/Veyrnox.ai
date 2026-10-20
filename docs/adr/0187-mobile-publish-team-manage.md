# ADR-0187 — Mobile: Publish team, change a role, remove a member, cancel an invitation

**Status:** Proposed 2026-10-20
**Related:** [ADR-0163](0163-mobile-publish-team-activity-queues-autolists.md) (the read-only team list), parity phase P5

## Decisions

1. **Manage from the team list.** For an owner or manager, each member the actor may change gets a "Change role or remove" control: five roles to pick from (manager is offered to owners only) and Remove. A pending invitation gets "Cancel invitation". Each is behind a dialog naming the person; nothing is sent before the person agrees. After a change the list is read again so it shows what the server holds.
2. **Rules mirrored, server decides.** Nobody changes the owner; a manager cannot change another manager or make one. The buttons follow those rules so the common refusals never happen, and a 403 from the server still gets a plain message.
3. **Not built:** inviting a person. The invitation route returns a bearer link; whether the app may share such a link is an open question for the owner (the approvals list drops them on purpose, ADR-0135). The screen says to invite on veyrnox.ai. Accepting an invitation needs an app-link path for `/social/team/invite/...` and is a later change to app links.
4. No server change, no dependency, no flag. Unit tests only; the screen was not run on a device.
