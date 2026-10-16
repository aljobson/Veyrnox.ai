# API response contracts

These existing route families have different compatibility contracts. A universal response rewrite would break clients, so adapters normalize failures at consumption boundaries.

| Family | Success | Failure |
| --- | --- | --- |
| `/api/catalog` | `{models:[...]}` | `{error:"code"}` |
| Legacy `/api/v1/*` and browser Publish | Resource-specific object, sometimes `{data:[...]}` | `{error:"code"}`, with route-specific details |
| Foundation/security APIs | Resource-specific success | `{error:{code,message,requestId}}` from `packages/security/errors.js` |
| `/api/publish/v1/*` customer API | `{data:...}` | `{error:"code"}` |

The HTTP status remains authoritative. Rate limits use 429 and `Retry-After`; authentication errors use 401. `gatewayFetch` and `gatewayDownload` accept string and structured failures through `app/lib/apiErrorDetails.js`; the thrown `GatewayError.code` and `.message` are always strings and `.body` preserves the original response. Existing string error codes and success payloads remain unchanged. Unknown/malformed responses become `gateway_error` with an HTTP-status message, not an object coerced to `[object Object]`.

Use the structured security error helper for new foundation APIs and generic messages for unexpected errors. Do not expose upstream bodies or serialize exceptions. Changes to an established route family's success/error schema require explicit API versioning or a compatible client migration.
