# ADR-0273: Chat depth on the phone

Status: Implemented; independent review and native device checks pending.

The phone ports the web's pure markdown parser to TypeScript. A parity test evaluates the web source and compares both parsers across normal, hostile and streaming input. Replies support the same limited blocks and inline formatting; italic, images, tables and HTML remain text. Following ADR-0266 and the host disposition, links are checked again at the sharing boundary: only HTTP(S) without credentials is passed as text to the native share sheet. Links remain visibly styled and announce “Copy or share”; model output never opens a web page directly. This supersedes the frozen plan’s browser-opening requirement. The accessible reply group exposes link and code-sharing actions; reply controls and Studio draft cards remain sibling elements.

Stars and unsent drafts are local to the account and device, like the web. They are not synced and are cleared on sign-out. Serialized map mutations carry account epochs and per-thread tokens. Deletion records a bounded tombstone list; a late stopped-send give-back cannot revive a deleted thread. Debounced writes carry the typing-time capture, and restoration preserves newer draft text in full. Copy uses the existing native share sheet, with no clipboard dependency.

Saved-reply free, stopped and cut-off labels use only server status and credits. The composer uses the server allowance only for its current refresh round and an eligible plain reply. Send start and settlement invalidate the allowance; the Again action retains the catalog price.

Ask about this opens a new chat with an owned Library image attachment, validated after model loading. Nothing is sent automatically. Several skills can be selected in pick order, up to four whole skills within 4,000 characters and 1,000 estimated tokens. Selection is derived from the saved system prompt. Single-skill prompts preserve the phone's existing catalog order; combined prompts prioritize one model of each media kind. There is no Oddling hand-off or locked continuity skill on the phone.

Five workflows expose their steps and require an explicit start. Consistent film routes to Film Studio, Oddling series to Oddlings; the other workflows start one chat with up to four step skills. Opening an individual step starts a one-skill chat. No generation runs automatically.

Video attachments use the installed expo-video player and thumbnail API, then expo-image-manipulator to save up to four JPEG frames locally. The player is released after success or failure; native-module failures and 12-second step timeouts produce a notice. Only still frames pass through the existing image upload and pricing path. No package was added. Thumbnail SharedRef compatibility still needs host device verification.

Translations reuse the website's corresponding sentences, with machine translations for new phone wording. Native-language review is pending. English values outside the new chatDepth area are unchanged. Length-review reports are regenerated with the existing checker.
