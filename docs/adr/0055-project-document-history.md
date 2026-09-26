# ADR-0055: Versioned project briefs and canvas

Status: accepted for staging preview; production rollout remains protected by ADR-0023.

Project metadata alone cannot preserve creative decisions or recover overwritten work. Introduce a canonical v1 document containing `schema_version`, server-validated `project_id`, `brief` (up to 6,000 UTF-16 units at the API) and `canvas` (`aspect_ratio`: 16:9/9:16/1:1; numeric `frame_rate`: 24/25/30/60). The database also validates the schema and bounds JSON storage to 32 KiB. Media/timeline are intentionally absent until their authorization and validation contracts exist.

Store immutable snapshots in `project_document_versions`, keyed by project and increasing revision. Revisions are independent of the existing metadata version. Projects without a saved document read as revision zero with a default canvas. Restoring copies a historical snapshot into a new revision, preserving every previous snapshot. Only project-authorized users can read snapshots; editors/creators/admins/owners can save. Readers get column-limited SELECT grants. No client role gets INSERT/UPDATE/DELETE, and an immutability trigger also blocks privileged row rewrites.

A narrow public SECURITY INVOKER RPC delegates to a private SECURITY DEFINER function with empty search path and live role checks. It locks the project row (also used by metadata mutation), compares expected revision, inserts the snapshot and writes an audit event atomically. Per-actor locking and the existing 30 changes/minute limit also cover document saves. An idempotency key scoped to project and actor returns the same saved revision only for the identical original request, after rechecking access. Cross-tenant access, revocation, deletion and restore requests cannot bypass those checks. Historical actor UUIDs deliberately have no live Auth FK; deleting an account revokes membership while leaving immutable attribution intact.

The preview UI debounces autosave by three seconds, serializes saves, preserves edits made during an in-flight save, and retains the request key when retrying an uncertain response. JSONB ordering is ignored when detecting edits. Conflicts pause autosave and retain the local draft; the user reviews the server version before choosing it or explicitly saving their draft against the latest revision. Request timeouts pause automatic retries. Drafts are held in memory: unsaved changes can be lost on a browser crash; leave warnings cover links and page unload, and this phase does not provide offline persistence or collaborative merging.

The history API returns up to 50 metadata records at a time, with a before-revision cursor. Full snapshot content is fetched individually. Restore is disabled while there is an unsaved draft. New UI remains behind the existing browser preview flag; this flag is not an authorization mechanism.

Validation is recorded in `docs/architecture/project-documents-rollout.md`. Production is not enabled by this change.
