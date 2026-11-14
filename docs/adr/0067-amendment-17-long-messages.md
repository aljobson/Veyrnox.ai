# ADR-0067 amendment 17 (2026-11-14): messages up to 30,000 characters, with a per-model long-message extra

- **Status**: Proposed. The owner chose this direction (a per-model extra, not a higher flat price for everyone and not
  absorbing the cost) and accepts it by merging the change and approving the apply-migrations run for 0517.
- **Amends**: [ADR-0067](0067-chat-replies-are-jobs.md) point 3 and [amendment 15](0067-amendment-15-ceiling-stops-tokens.md)
  decision 3. A file of its own because ADR-0067 is at the 500-line limit.
- **Scope**: `lib/chatLimits.js`, `lib/chat.js`, `lib/chatTurn.js`, `GET /api/v1/chat/models`, migration 0517, the web and
  mobile chat composers.

## Context

The flat price per reply was set against 9,000 input tokens: 6,000 history, 2,000 user text (8,000 characters) and 1,000
system prompt (amendment 15). The Create prompt field takes 30,000 characters, and the owner wants Chat to match. Raising
the cap for every reply would either raise every model's flat price or leave the longer input unpaid.

## Decision

1. **The message cap is 30,000 characters and 7,500 estimated tokens** (`CHAT_USER_TEXT_MAX`, `MAX_USER_TEXT_TOKENS`, still
   the character cap divided by four). The flat price covers a message up to the standard length, 8,000 characters and 2,000
   tokens (`CHAT_USER_TEXT_STANDARD_MAX`). A message over either is a **long message**.
2. **A long message costs the row's `chat_long_text_extra_credits`, once per reply**, added to the base and to any other
   option's extra, exactly as Thinking, Web search and Images are. The turn sets it from the text (`isLongText`); a caller
   cannot ask for it or turn it off. The job records `inputs.long_text = true`. The price is still only looked up and added
   on the server (`replyPrice`); the screens show the catalog extra and never compute one.
3. **The extra pays for 6,600 input tokens at the model's input rate**: the 5,500 extra tokens at worst (7,500 against
   2,000) plus about 20% for tokenizers that count a CJK character or an emoji as more than one token, at the higher of the
   rate recorded in 0194/0196 and OpenRouter's live list (2026-11-14), under the same margin-floor CHECK as every option
   (`credits >= ceil(cost / 0.01796)`). Opus 2 Credits, every other row 1. The figures are in migration 0517. The new
   worst-case input is 6,000 + 7,500 + 1,000 = **14,500 tokens**.
4. **A row without the extra keeps 8,000 characters.** A long message to it is refused with `invalid_text` before any money
   moves, and the models route reports `max_message_chars` per model (30,000 or 8,000) so the composer holds the right limit.
5. **Not with Deep research.** A research run reads the question in its plan and every search, so a long message there is
   refused (`option_unavailable`); research keeps 8,000 characters.
6. **The database stores a message over 8,000 characters only for a job marked `long_text`** (`chat_complete_turn`, 0517),
   so a priced-without-the-extra long message cannot be stored even if the Worker were wrong.
7. A long message is never free: the free allowance (ADR-0069) covers only a reply priced at the row's base.

## Consequences

- A Luna reply with a long message costs 2 Credits (1 + 1); an Opus reply 9 (7 + 2). The composer shows the total with the
  extra next to Send, and a character counter ("n/30000") once the message is long.
- Merges deploy before the migration is approved. Until 0517 is applied the Worker reads no `chat_long_text_extra_credits`
  (`selectChatModels` drops a missing late column and reads again), so no model offers long messages and the limit stays
  8,000 everywhere. Applying 0517 turns it on, column and stored-text limit together.
- History is unchanged: `chat_turn_context` still cuts at 24,000 characters and `buildMessages` at 6,000 tokens, so a long
  message in history is cut there and costs nothing more on later replies.
- Refunds are unchanged: a failed reply refunds the full price, extra included, through the same paths.
- The rates are a planning bound from the providers' lists; the owner should check the per-model prices before approving.

## Checked

- `tests/chatLongText.test.mjs`: 8,000 / 8,001 / 30,000 accepted with the right price, 30,001 refused, the token cap, the
  extra only above 8,000 characters or 2,000 tokens, refused on a row without it and with research, the late-column read,
  the composer state, refund of a failed long reply and replay unchanged, never free-allowance.
- `scripts/test-chat-long-text.mjs` (ledger-tests.yml, full replay): 0517 applied twice; costs and the margin-floor CHECK;
  `chat_complete_turn` stores 30,000, refuses 30,001 and refuses over 8,000 on a job not marked `long_text`; replay writes
  nothing; grants.
- `apps/mobile/__tests__/chatLongText.test.tsx`: the counter, the extra next to Send and the over-limit words.
