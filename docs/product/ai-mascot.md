# Vey — in-product AI guide

Vey is the animated helper mounted once in the Veyrnox product layout, so it is available in the studio and on public Models, Templates, Tools, Pricing, MCP and Social Cinema routes. It answers how-to questions, moves beside a product-owned target, highlights it, and can navigate, focus a writing field or activate a specifically reviewed safe control.

## Character animation

Vey is a code-native articulated character rather than a single moving image. Its head, eyes, arms, hands, legs and feet animate independently across six product states: idle, listening, walking, thinking, pointing and tapping. Vey turns toward the selected control and respects the user's reduced-motion preference.

Drag Vey's body with touch or a mouse to position it on screen. A tap still opens or closes help. Manual placement stays through walkthrough steps until reset or reload, stays within the viewport, and preserves exact fingertip pointing. In the walkthrough, open More on mobile and choose Reset Vey position to restore automatic placement. Keyboard users can focus Vey, hold Alt and press arrow keys to move (Shift moves farther), or press Escape to reset. Dragging never confirms rights, submits a generation, or spends Credits.

On mobile the question panel is a short floating chat, 220–280px tall depending on screen height. The conversation scrolls inside it while the question field and Ask button stay visible. During a task, More → Ask about this step opens chat; Resume walkthrough sits above the chat panel and returns to the same task. Desktop keeps the full-size conversation panel.

When Vey directs someone to a control, it walks beside the target, points with its hand and keeps a pulsing outline around the control. For a reviewed reversible control, Vey shows a tap ripple and hand-tap animation before activating it. The user must first choose Vey's suggested action; Vey never clicks arbitrary page content.

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

Saved Oddling help is browser-local. Ask about a saved name or “my saved Oddlings” to inspect passport traits, voice, recurring show and visual canon. Duplicate names offer a version picker. “Show this saved passport” opens History and points to that exact card without loading it. The user chooses Load and edit; Vey then guides prompt review, Continue and the price in Create. Loading a saved custom character uses portrait mode, because it has no built-in cast animation portrait.

`lib/savedOddlingHelp.js` rereads the sanitised passport library on each question. Saved-passport questions and answers are marked local-only and excluded from subsequent help API history. Passport contents, names and local guidance are not uploaded to the model provider or included in helper analytics. This is structured local guidance, not an AI analysis of private passports. Clearing browser storage or using a different browser removes that context.

Open Ask Vey and choose **Saved Oddling → image → video**. Choose an exact saved passport version, personally Load and edit it, review the scene, and Continue to portrait generation. The state-aware guide checks the actual model kind, enabled character styling, prompt, settings, required sources, rights and current price. Each review is tied to the current inputs; changes invalidate it. Generate remains a user action. Vey tracks the first accepted job in a batch explicitly, waits for success, and does not retry failures.

After the tracked image succeeds, **Prepare video from this image** verifies that same account-owned job and asset, selects an available live image-to-video model, attaches the exact image by job id and writes an editable motion draft. It does not generate, upload a different portrait or accept rights. The video walkthrough covers the source, motion prompt, duration/aspect, personal rights attestation, cost review and Generate, then follows the video job to its result in Library. **Start with an existing image** lets the user explicitly choose and confirm a Library image instead of making another paid image.

The compact guide docks below the pointed control and can move to either side of the screen. **Ask about this step** opens the conversation without ending the task; next-step questions use the current local task state, not a provider guess. **Resume walkthrough** returns to the same step. Closing and reopening Vey preserves progress; ending the walkthrough does not cancel an already submitted job. A minimal account-scoped task record is kept in this tab’s session storage for up to 24 hours: passport/job ids, stage, handoff flag and local comparison tokens. It stores no passport contents, prompt text, files or signed URLs, and is never sent to the help model or analytics. Job recovery uses authenticated, ownership-checked reads. Form drafts and uploaded files are not persisted by the guide; after a reload users may need to restore the exact Library image and review inputs again. New account sessions cannot resume another account’s task.

`lib/productHelp.js` owns the only selectors and actions Vey may use. The model can return an allowlisted target id; it can never return CSS or arbitrary JavaScript. `show_target` may navigate, scroll and highlight. `focus_target` is further restricted to reviewed writing fields.

Pointing resolves a section marker to its actual control: the selected duration/count pill, the source Library button, the rights checkbox, or the prompt field. A model-selection step points at an eligible model button, not the MODEL heading. `useVeyPointer` measures the control after scrolling and follows scroll, resize and layout changes. `lib/veyPointer.js` positions the body and maps the target into the mirrored SVG; Vey’s articulated hand lands inside the control. Body bobbing is paused while pointing, and the decorative hand cannot intercept clicks. Closing the guide removes its pointer. A pointed checkbox remains unchecked and a pointed Generate button is never activated.

`activate_target` can click only targets explicitly carrying `canActivate: true` in that registry. It is intended for reversible interface controls such as opening Chat settings or an Oddling History tab. Any other target is downgraded to highlighting.

The visible activation sequence is walk, point, tap, then click. The click is delayed until the movement and tap animation have played, and it is cancelled if the target has left the page.

Vey never generates or sends content, spends Credits, buys a pack, accepts terms, confirms rights, publishes, approves, connects accounts, changes security, deletes, suspends or performs moderation decisions.

Library and the Create source picker both support older account jobs. Use **Load older** in Library or **Load older images** in the picker; already shown items remain on a failed read, and retry does not submit generation. Cursor timestamps retain database microseconds and use a transport-safe UTC suffix, so paging does not silently stop at a UTC offset. Source-picker previews remain bounded per click rather than fetching every asset at once.

## Adding or changing a feature

1. Build the route with clear headings, labels and explanatory copy. Vey learns the basic feature automatically on the next dev or build.
2. Add or update approved product documentation when the feature needs more detail than the UI provides.
3. Add a reviewed article in `lib/productKnowledge.js` for precise workflow, availability, pricing or safety guidance.
4. Add a stable product-owned target in `lib/productHelp.js` only when Vey should be allowed to point or focus there.
5. Extend the help tests for consequential workflows and drive the real flow with Reticle before shipping.

Live catalog data remains authoritative for currently available models, capabilities and prices. Knowledge articles describe how the product works; they must not freeze volatile catalog values.

## Production configuration

Production currently uses the existing, separately capped `OPENROUTER_CHAT_API_KEY`, avoiding another binding on a Worker that is already at Cloudflare's text-binding limit. Production never falls back to the shared generation key. The help model defaults to `google/gemini-2.5-flash-lite`; `OPENROUTER_HELP_MODEL` remains an optional local or future deployment override. A separate `OPENROUTER_HELP_API_KEY` can be introduced after another Worker binding is consolidated.
