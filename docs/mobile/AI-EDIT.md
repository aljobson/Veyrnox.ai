# Typed AI edits in Cut

The build flag `EXPO_PUBLIC_EDITOR_AI_EDIT_ENABLED=false` is public and defaults
off. The Describe the edit row appears only when that flag is the exact string
`true` and the authenticated quote succeeds. This checkout does not enable it.

The server separately requires `EDITOR_AI_EDIT_ENABLED` and an active text model
in `EDITOR_AI_EDIT_MODEL_ID`. Model IDs and provider secrets are server-only.
The phone displays only the server's quoted price. See ADR-0000 for pricing,
refunds, recovery, retention and the owner decisions before rollout.
