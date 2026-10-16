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
