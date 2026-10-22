# ADR-0251: Vibe Check, a first-run interview that tunes the product

Status: Proposed; implemented behind unset flags (`CREATOR_PROFILE_ENABLED` on the server, `EXPO_PUBLIC_CREATOR_PROFILE_ENABLED` in the phone build), pending owner review.

New people land on a generic home. The product has templates, quality tiers, aspect ratios, Publish and Vey's voice, but nothing says which matter to this person. An optional seven-tap interview, the Vibe Check, runs after the welcome on the phone, from an Explore card on the web, and from Account on both. Its answers order templates, pick the opening aspect ratio on the phone, and end in a Creator Card and a first creation through the normal generation path.

Answers are one allowlisted JSON object per person in `creator_profiles` (migration 0363): six enum answers (look, goal, pace, destination, audience, voice), a chaos level 0 to 4, and an optional studio name of at most 40 characters with no control characters or angle brackets. The same allowlist is enforced three times: in `private.creator_profile_clean` (the line that holds), in the route, and in each client. Writes go only through four service-role functions (`get`, `save`, `skip`, `reset`); the table has forced RLS and no grants. Saving the same answers again changes nothing. A skip never overwrites completed answers. The row is deleted in the same transaction as account erasure.

The route is `/api/v1/creator-profile` (GET, PUT, DELETE) and `/api/v1/creator-profile/skip` (POST), inside the gate, taking identity only from the middleware's header. It answers 404 while the flag is off. Nothing here touches credits, the ledger, prices or what a template does; the first creation spends the existing free allowance or credits exactly as any other, with the price shown first.

The Creator Card name is a pure function of the answers (four paces by three chaos bands, twelve names) and is not stored. The phone and server share one English implementation; the web words the card from catalog keys so it reads correctly in every language. Template ranking uses a small shared word list (`lib/creatorWords.js` and its phone twin); tests check the twins agree.

Skipping must always work and must leave the product exactly as it is today. Answers are never used for pricing, for ranking other people, or for advertising, and are sent to no model provider.

Alternatives rejected: inferring preferences from behaviour only (slow, nothing for the first session); a long profile form (abandonment); keeping answers on the device only (lost on reinstall, cannot drive the web).

The profile is part of the privacy export (ADR-0250): migration 0364 redefines `read_privacy_export_page` with a `creator_profile` key in the `profile` section (status, answers including the studio name, and its times), bounded by `as_of` like the rest, and the export drift guard lists `creator_profiles` as exported.

Language comes first. The interview opens with a card listing the website's eleven languages (English and the ten others), each by its own name with its flag. On the web, choosing another language writes the locale cookie and the account language (the same calls as the language menu) and reloads, so the interview and the whole app continue in it; the ten translations of the interview copy are machine-grade and flagged for native review. On the phone the choice is saved on the device and on the account, but only English is switched on in the app (ADR-0132), so the app stays English and says so until that language goes live; the phone's interview strings join the app-only list for the localization process. The card is skipped on a retake.

Not in this change: Vey's tone from the voice answer (a line in the chat system prompt), a shareable card image, translation of the phone's interview copy (the web copy is translated), and enabling the flag on staging (staging is at the 128-binding limit, so a variable must be freed first).

Open questions for the owner: is the shareable card image in v1; may the interview run before sign-up or only after; is the first creation free for everyone who completes it, or only within the existing free allowance.
