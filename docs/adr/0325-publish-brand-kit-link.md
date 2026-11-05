# ADR-0325 — A Publish brand can use a workspace brand kit

Status: Proposed (migration 0441 drafted, not applied).
Date: 2026-11-05.

## Problem

The editor's Brand kit (ADR-0088, migration 0280) belongs to a workspace: name, palette, fonts, text styles and licensed
assets. A Publish brand (ADR-0061) belongs to a person and groups connected social accounts. They shared nothing but the
word "brand", so the look a team set in the editor never reached Publish.

## Decision

One optional link per Publish brand to one workspace (`social_brand_kit_links`, migration 0441).

- **Who links.** Only the brand owner, and only to a workspace they can edit (organisation owner or admin, or workspace
  creator or editor). Unlinking is the same call with `workspaceId: null`.
- **Who reads.** Every brand member, through `GET /api/v1/social/brand-kit` (selected brand via `x-publish-brand-id`).
  The reply carries the kit's name, palette, fonts, text styles and the credit lines of its assets (name, credit, usage,
  licence link). It never carries project or asset ids, and the workspace id only goes to the owner. A team member
  therefore needs no workspace membership to see the look.
- **Where it shows.** A Brand kit card on the Publish page: swatches, fonts, text styles, credits, and for the owner a
  workspace picker with Link and Unlink. States: loading, error with Retry, not linked, linked but kit empty, linked.
- **Gate.** Follows `EDITOR_SHARED_TOOLS_ENABLED`; with it off the route answers 404 and the card does not render.
  Link writes use the existing Publish write limit.
- **Security.** Service-role RPCs only, keyed by the verified auth id; table has forced RLS and no client grants. The
  stale case (workspace deleted) reads as not linked.

## Not changed

No kit schema change, so no logo, voice or hashtag fields yet: those need kit schema version 2 across SQL, web, phone
and ten locales and should be their own ADR. No automatic application of palette to the composer. Phone not changed.
