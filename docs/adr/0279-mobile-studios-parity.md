# ADR-0279: Mobile studios parity (Faceless Reel, Video agent balance, Oddlings builder)

Status: Accepted for the two-part mobile implementation.

The phone uses the existing production catalog, Create price review and generation contract. Part A adds Faceless Reel, its optional sound continuation, shared hand-off plumbing and the Video agent balance gate. Part B adds the Oddlings builder after Part A merges. Neither part changes servers, flags, migrations or billing.

## English model prompts and live limits

Model instructions remain English in every interface language, matching the web. Interface copy is translated. The web Faceless Reel template already exceeds Wan 2.5's 800-character prompt cap with an empty brief. The phone uses a compact English template with the same section order and intent, with at most 600 fixed characters. It checks the complete prompt against the live catalog limit, never truncates it, and shows remaining brief room. The editable brief retains its fixed 800-character maximum so adding a hook cannot prevent shortening a previously valid brief. The web flow needs its own fix, outside this work.

## Transient hand-off and reviewed continuation

Creative source hand-offs gain 16:9, optional `followup: 'generated-sound'` and copied `picks`. Tokens remain in memory, expire after 15 minutes and are single use. Faceless Reel stores no form data. Once Create opens, its existing per-account prompt/settings drafts remain unchanged: autosave after 600 ms and on leave, account-scoped cache, cleared on sign-out or account change. Character picks populate the image prompt model's panel; other models receive the character prompt so picks are preserved.

Only a successful single Wan 2.5 submission with the Faceless Reel sound intent and chosen duration at most eight seconds carries the sound continuation. The builder offers five or ten seconds, so only the chosen five-second length qualifies. The phone job screen does not read duration. It requires the continuation marker, succeeded state, Wan model, a video asset and a catalog sound model with a video source slot. The source is an asset reference to the completed job; the action neither uploads nor charges. Create shows the catalog price and requires fresh source-rights consent. These hand-offs never set `rightsConfirmed`; the originality attestations do not grant source rights.

The phone exposes Faceless Reel in the Tools menu and as a Create tile when the ungated Wan model is available. The web currently has no visible entry point. The Faceless screen also disables hand-off when its catalog model is unavailable.

## Video agent balance

An unavailable, invalid or negative balance cannot approve a plan. Insufficient funds show the shortfall and packs link; unavailable funds show a retry. `useBalance` remains the only balance state. Retry observes the API request and publishes only for the account captured at press when it is still current. Purchases and subsequent balance events continue to replace that value; no local balance override can conceal a newer result. Only the retry progress boolean is local.

## Part B: Oddlings builder decisions

Use a stepped slider without adding a dependency. Draw swatch gradients as bands. Load picture tiles from `https://veyrnox.ai/oddlings/…`. Reference uploads use `SourcePicker` and the server's size rules instead of the web's 2 MiB check. Preserve the web portrait model priority when choosing among available models, and show its credit banner without inventing a local price. Refine in chat uses the web's compact skill bodies. Reuse the copied picks hand-off, sanitizing its values in Create. Keep model prompts English and source-rights consent unticked. These decisions cover Part B without requiring an edit to this ADR.
