# packages/adapters

Provider adapters for the Worker runtime. Plain JS on Web Crypto + `fetch`
— no jose, no SDKs (they trip Workers Builds; see CLAUDE.md).

## Interface

```ts
interface ProviderAdapter {
  submit(job: JobSpec): Promise<{ providerJobId: string; statusUrl: string }>;
  verifyWebhook(req: Request): Promise<VerifiedEvent | null>;
  parseResult(evt: VerifiedEvent): ProviderResult;
}
```

## Providers

Generation:

- `fal.js` — fal.ai queue submit + Ed25519 webhook verification, bound to
  our own fal tenant id (`tests/falWebhook.test.mjs`,
  `tests/falWebhookSignature.test.mjs`)
- `kie.js` — kie.ai submit + HMAC webhook verification
- `openrouter.js` — OpenRouter submit + webhook verification
- `grsai.js` — GrsAI submit; no signed callback, results are polled
- `byteplus.js` — BytePlus ModelArk submit; its callback is unsigned, so it
  is never registered and results are polled (`lib/byteplusSweep.js`)

Storage, billing and email:

- `r2.js` — Cloudflare R2 via SigV4: put, presigned GET (15 min cap), delete
  (`tests/r2Copy.test.mjs`); `r2Copy.js` copies provider output into R2
- `stripe.js` — Checkout sessions and HMAC-SHA256 webhook verification
  (ADR-0031)
- `resend.js` — transactional email over Resend's HTTP API

Social publishing (`social/`, ADR-0061): `instagram.js`, `linkedin.js`,
`tiktok.js`, `twitter.js`, `youtube.js`.

Replicate failover and DeepSeek moderation adapters were unshipped
TypeScript stubs and were removed 2026-09-11; see ADR-0009 for the fal
retry policy that replaced failover.
