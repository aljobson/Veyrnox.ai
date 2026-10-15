# Vey — in-product AI guide

Vey is the animated helper mounted once in the Veyrnox product layout, so it is available in the studio and on public Models, Templates, Tools, Pricing, MCP and Social Cinema routes. It answers how-to questions, moves beside a product-owned target, highlights it, and can navigate, focus a writing field or activate a specifically reviewed safe control.

## Knowledge model

Vey combines two product-owned knowledge layers:

- `lib/productKnowledge.js` contains reviewed workflow, availability and safety guidance.
- `lib/generatedProductInventory.js` is generated from Veyrnox routes, their local components and allowlisted product documentation.

Each reviewed article names:

- the user task and routes it covers;
- matching language users are likely to ask with;
- a concise explanation, ordered steps and important constraints;
- at most one safe UI target and action.

The server retrieves only the most relevant articles for a question and supplies them to the help model. If the model is unavailable—or the user is signed out—the same articles produce the local answer. This keeps the fallback and AI answer grounded in one maintained source.

For questions about models, prices or generation capabilities, the authenticated help route also reads the same safe live media catalog used by Create. Provider endpoints and costs are never supplied. Vey keeps up to six recent conversation messages as untrusted context so follow-up questions work; the browser does not persist that transcript across a reload.

`npm run sync:vey-knowledge` discovers product routes, follows their local component imports, and records static headings, explanatory copy, control labels, links and `data-assistant-target` ids. It also indexes the allowlisted product documents in `scripts/lib/vey-knowledge-source.mjs`. `predev` and `prebuild` run the sync automatically, and `npm run check:vey-knowledge` fails when the committed artifact is stale.

The generated layer is descriptive only. It cannot create a target action or bypass the reviewed safety policy, so a newly added button does not automatically become clickable by Vey.

Coverage includes Explore/Templates/Models/Tools, image/video/audio generation, uploads and prompting, generation costs and refunds, Library, LLM Chat, Studio skills, Film Studio, Projects, Video Enhance, Video Agent, Credits, account security and data, Publish/calendar/analytics, MCP, Social Cinema and admin review.

## UI control contract

`lib/productHelp.js` owns the only selectors and actions Vey may use. The model can return an allowlisted target id; it can never return CSS or arbitrary JavaScript. `show_target` may navigate, scroll and highlight. `focus_target` is further restricted to reviewed writing fields.

`activate_target` can click only targets explicitly carrying `canActivate: true` in that registry. It is intended for reversible interface controls such as opening Chat settings or an Oddling History tab. Any other target is downgraded to highlighting.

Vey never generates or sends content, spends Credits, buys a pack, accepts terms, confirms rights, publishes, approves, connects accounts, changes security, deletes, suspends or performs moderation decisions.

## Adding or changing a feature

1. Build the route with clear headings, labels and explanatory copy. Vey learns the basic feature automatically on the next dev or build.
2. Add or update approved product documentation when the feature needs more detail than the UI provides.
3. Add a reviewed article in `lib/productKnowledge.js` for precise workflow, availability, pricing or safety guidance.
4. Add a stable product-owned target in `lib/productHelp.js` only when Vey should be allowed to point or focus there.
5. Extend the help tests for consequential workflows and drive the real flow with Reticle before shipping.

Live catalog data remains authoritative for currently available models, capabilities and prices. Knowledge articles describe how the product works; they must not freeze volatile catalog values.

## Production configuration

Production currently uses the existing, separately capped `OPENROUTER_CHAT_API_KEY`, avoiding another binding on a Worker that is already at Cloudflare's text-binding limit. Production never falls back to the shared generation key. The help model defaults to `google/gemini-2.5-flash-lite`; `OPENROUTER_HELP_MODEL` remains an optional local or future deployment override. A separate `OPENROUTER_HELP_API_KEY` can be introduced after another Worker binding is consolidated.
