# Veyrnox source analysis and CLI operating model

## Backend

The real backend is the hosted Veyrnox API. Generation is performed by Veyrnox's existing provider adapters and recorded through its ledger; the CLI never reimplements media generation.

## Data and action mapping

| Product action | Developer API operation | CLI command |
| --- | --- | --- |
| Sign in and consent | OAuth DCR + authorization code/PKCE | `veyrnox auth login` |
| Inspect identity | `GET /me` | `veyrnox auth status` |
| Browse models | `GET /models` | `veyrnox models list` |
| Price a request | `POST /estimates` | `veyrnox generations estimate` |
| Read credits | `GET /balance` | `veyrnox balance` |
| Start work | `POST /generations` | `veyrnox generations create` |
| Inspect work | `GET /generations/{id}` | `veyrnox generations get` |
| Wait for work | repeated owned status read | `veyrnox generations wait` |
| Download output | owned expiring asset link | `veyrnox generations download` |
| Browse history | `GET /generations` | `veyrnox generations list` |

## State

The CLI is a stateless service client except for OAuth configuration. Its user-only JSON file stores the API origin, public client registration, access token, rotated refresh token and expiry. Saves are lock-protected. Project undo/redo and mutation auto-save do not apply because there is no local project document.

## Interaction model

- One-shot Click commands for scripts and CI.
- Default REPL for interactive terminal use.
- `--json` on every command path for agent parsing.
- A generation always obtains a current estimate before POSTing. Non-interactive callers provide the exact value with `--confirmed-credits`; an interactive caller explicitly confirms the displayed maximum.

## Output

Human mode uses concise tables and status messages. JSON mode writes one JSON value to stdout and sends diagnostics to stderr. Secrets are never printed by status, error or debug output.
