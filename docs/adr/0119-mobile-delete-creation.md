# ADR-0119 — Mobile: Delete a creation

**Status:** Proposed 2026-10-18
**Related:** [ADR-0116](0116-delete-a-creation.md) (the server rule and route), [ADR-0110](0110-mobile-account-and-safety.md) (store review expectations), [ADR-0106](0106-mobile-app.md), roadmap slice M10b

## Context

Apple 1.2 and Google Play expect a person to be able to delete content they generated. The server now offers `DELETE /api/v1/jobs/:id` (ADR-0116): it erases the file and the prompt, keeps the job row and the ledger, refunds nothing, and cannot be undone.

## Decisions

1. **No server change, no dependency.** The app calls the route as it is.
2. **Where.** A "Delete this creation" action on the job screen, under Save, Share and Report, shown only for a finished creation that has a file. Library rows open that screen, so there is one place to delete from.
3. **Confirm first**, with the system dialog: "Delete this creation?" and "This permanently erases the file and the prompt. Your credits are not refunded, and it stays counted in your history. This cannot be undone." with Cancel and a destructive Delete.
4. **Result.** On success, and on a repeat (`replayed: true`) or a 404 `not_found` (already gone, or not the person's), the app returns to the Library, which refetches when it comes into view.
5. **Refusals change nothing** and each gets its own plain sentence ending "Nothing was changed.": still being made, held for review, account on hold (contact support), used by a Publish post (remove or finish the post first), used by a Cinema upload (withdraw it first), used by a Film Library master, too many requests, no connection, or a general "could not delete".
6. **No undo and no local trash.** The app keeps nothing after a delete.

## Not decided here

- Naming which Publish post blocks a delete: the route says only `used_by_post`, so the app says "a Publish post".
- Deleting several creations at once, or deleting from the Library list with a swipe.
- Deleting a chat reply (chat has its own delete) or a failed job that has no file.

## Consequences

- A creation deleted in the app disappears from the web Library too, and the reverse.
- No new native module.
