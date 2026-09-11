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

- `fal.js` — fal.ai queue submit + Ed25519 webhook verification, bound to
  our own fal tenant id (`tests/falWebhook.test.mjs`,
  `tests/falWebhookSignature.test.mjs`)
- `r2.js` — Cloudflare R2 via SigV4: put, presigned GET (15 min cap), delete
  (`tests/r2Copy.test.mjs`)

Replicate failover, Stripe and DeepSeek moderation adapters were unshipped
TypeScript stubs and were removed 2026-09-11; see ADR-0009 for the fal
retry policy that replaced failover for Phase 1.
