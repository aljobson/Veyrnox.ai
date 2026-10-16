# Veyrnox CLI test plan

## Test inventory plan

- `test_core.py`: 14 unit tests planned.
- `test_full_e2e.py`: 12 HTTP, installed-command and workflow tests planned.

## Unit test plan

### `core/config.py` — 5 tests

- Default and environment-derived paths.
- Missing configuration.
- Lock-protected save/load round trip.
- User-only file mode on supported systems.
- Logout removes token material while retaining the API origin.

### `core/auth.py` — 6 tests

- PKCE verifier and S256 challenge shape.
- Discovery document validation.
- Dynamic public-client registration payload.
- Authorization URL state and exact loopback redirect.
- Authorization-code exchange persistence.
- Refresh-token rotation and malformed responses.

### `core/client.py` — 7 tests

- Bearer header injection without token leakage.
- JSON success parsing.
- Structured HTTP errors and retry metadata.
- One automatic refresh on `401`.
- Estimate validation.
- Typed `--input` value parsing.
- Binary asset download verification.

## E2E test plan

### HTTP backend workflow — 5 tests

A real local HTTP server implements the documented OAuth/API contract. The production client performs discovery, token exchange, model listing, estimate, generation creation, polling and binary download over HTTP. Tests verify exact methods, paths, headers, JSON bodies and downloaded bytes.

### Installed CLI subprocess workflow — 7 tests

Use `_resolve_cli("cli-anything-veyrnox")` with no working-directory dependency. Verify `--help`, JSON model listing, balance, estimate, confirmed generation creation, history, wait and asset download. Force-installed release validation must show that the console script, not a source-module fallback, ran.

## Realistic workflows

### Safe image generation

1. List image models.
2. Estimate an image request.
3. Create with the exact confirmed credit value and an idempotency key.
4. Poll until succeeded.
5. Download and verify non-empty output bytes.

### Price-change refusal

1. Estimate a request.
2. Submit a different confirmed value.
3. Verify `409 credit_confirmation_mismatch` and no created job.

### Refresh-token rotation

1. Start with an expired access token and a refresh token.
2. Make an authenticated request.
3. Verify exactly one refresh, use of the new access token and persistence of the rotated refresh token.

## Release-only live checks

The repository suite validates the full HTTP client against a contract server without using a real account or spending credits. Release acceptance separately checks the production discovery, OAuth challenge, OpenAPI document and public guide. An authenticated production generation is performed only with explicit account-owner approval because it consumes credits.
