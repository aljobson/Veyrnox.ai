# packages/adapters

Provider adapters (fal.ai, Replicate, etc.). Implements the `ProviderAdapter` interface.

## Interface

```ts
interface ProviderAdapter {
  submit(job: JobSpec): Promise<{ providerJobId: string; statusUrl: string }>;
  verifyWebhook(req: Request): Promise<VerifiedEvent | null>;
  parseResult(evt: VerifiedEvent): ProviderResult;
}
```

## Providers

- `fal.ts` — fal.ai (primary, ed25519 webhook verification)
- `replicate.ts` — Replicate (failover, HMAC webhook verification)

See `docs/architecture_v0.3.1.md` §25.7 for the job state machine and failover logic.
