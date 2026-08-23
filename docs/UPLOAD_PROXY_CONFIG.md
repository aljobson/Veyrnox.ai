# Upload Proxy Configuration

The upload proxy (`lib/uploadProxyTarget.js`) forwards client uploads to a
signed URL. To narrow the SSRF blast radius, the set of hostnames it will
forward to is constrained by an allowlist.

## `UPLOAD_PROXY_ALLOWED_HOSTS` (required in production)

Comma-separated list of exact hostnames the upload proxy is permitted to
target. Case-insensitive; whitespace is trimmed.

```
UPLOAD_PROXY_ALLOWED_HOSTS=uploads-prod.your-bucket.s3.eu-west-1.amazonaws.com,uploads-staging.your-bucket.s3.eu-west-1.amazonaws.com
```

### Behaviour

- **Production (`NODE_ENV=production`)**: this variable **must** be set to a
  non-empty value. If it is missing, `validateUploadProxyTarget()` throws
  immediately (fail-closed). Any request that hits the upload proxy in prod
  without the variable set returns an error to the client instead of silently
  falling back to the broad `*.s3.amazonaws.com` heuristic.
- **When set**: the allowlist **replaces** the default `*.s3.amazonaws.com`
  heuristic — only the exact hostnames enumerated in the variable are
  permitted. Union with the S3 heuristic is intentionally disabled so that
  narrowing the allowlist actually narrows the blast radius.
- **Non-production and unset**: the built-in S3 host heuristic
  (`*.s3.amazonaws.com`, `*.s3.<region>.amazonaws.com`) is used as a fallback.
  This is intended only for local development and CI.

### What to put in it

List the exact virtual-hosted-style S3 endpoints (or presigned domains) your
upload flow issues signed URLs against. Do not use wildcards, and do not use
generic `s3.amazonaws.com` — bucket-scoped hostnames are the whole point.

### Related

- `lib/uploadProxyTarget.js` — validator and allowlist parser
- `app/api/upload-binary/route.js` — the proxy route that calls the validator
