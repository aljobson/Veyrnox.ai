# Veyrnox CLI

The official Python command-line client for the OAuth-secured Veyrnox Developer API.

```bash
pipx install "git+https://github.com/aljobson/Veyrnox.ai.git#subdirectory=agent-harness"
veyrnox auth login
veyrnox models list
veyrnox generations create --model nano-banana-kie --prompt "A blue fox" --yes
```

Use `--json` before a command for machine-readable output. Generation creation always obtains a live estimate and requires the exact price to be confirmed. `--dry-run` estimates without spending credits.

Models that transform existing media can use an owned Library asset with `--source-asset image=ASSET_UUID --consent`. Accepted slots are `image`, `endImage`, `video`, and `audio`; each model advertises which slots it supports.

Tokens are stored in `~/.config/veyrnox/config.json` with user-only permissions, or at `VEYRNOX_CONFIG`. Set `VEYRNOX_API_URL` to use another deployment.

## Publish

When the server has Publish automation open: `veyrnox publish accounts`, `publish posts --status scheduled`, `publish schedule --at 2026-11-01T10:00:00Z --account ID --video JOB_ID --text "..."` (asks to confirm, or `--yes`; `--dry-run` prints the request), `publish reschedule POST_ID --at ... --expected-at ...`, `publish cancel POST_ID --expected-updated-at ...`, `publish analytics ACCOUNT_ID --from 2026-10-01 --to 2026-10-31`. Needs a Publish Plan for scheduling and analytics.
