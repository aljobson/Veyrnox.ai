# Provider model

`model_catalog` remains authoritative for provider, endpoint, modality, activation and credits. The existing `lib/modelCapabilities.js` registry validates/shapes model inputs, prices output tiers and limits source sizes. Browser requests cannot choose credentials or arbitrary provider endpoints. No replacement model database is introduced.

The existing dispatch contract is extracted from the generations route into `packages/provider-sdk/registry.js`:

- `key()` resolves server-only configuration/readiness.
- `check(record, model, inputs)` validates capability support before debit.
- `submit(job, record, key, publicHost, sources)` returns an asynchronous provider handle or a failure.
- `providerFor(id)` performs an own-property lookup and rejects unknown providers.

Keep all five existing adapters: fal, Kie, GrsAI, OpenRouter and the VEYRNOX Auto Short/Clip Editor orchestrator. Input shaping, callback configuration, source ownership checks, billing, consent, retry and refund behavior remain unchanged. Existing adapter, generation-route and orchestration tests cover the extraction. The browser import-graph security check prevents transitive adapter/database imports.

Submission and completion are separate. `lib/providerCompletion.js`, provider-specific signature checks, GrsAI polling and recovery sweeps remain the existing completion path. Never blindly retry an ambiguous paid submission or automatically switch providers after an uncertain acknowledgement.

Future governance fields—privacy/security review, regions, retention/training, confidential/voice approval, enterprise eligibility, health and cost—need a catalog migration plus policy enforcement. A type/interface alone is not enforcement. Voice cloning must stay unavailable until consent, strong authentication, verification and revocation are implemented.
