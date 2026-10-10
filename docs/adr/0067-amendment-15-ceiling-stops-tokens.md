# ADR-0067 amendment 15 (2026-10-10): our ceiling is a Stop, stops before text are counted, caps hold in tokens

- **Status**: Proposed. The owner accepts it by merging the change.
- **Amends**: [ADR-0067: Chat, a reply is a job](0067-chat-replies-are-jobs.md), points 3 and 4. A file of its own
  because ADR-0067 is at the 500-line limit. Follows amendment 14.
- **Scope**: the turn (`lib/chatTurn.js`), the caps (`lib/chat.js`), two lines of screen wording, and one read-only
  database function (migration 0258). No price changes.
- **Source**: the QA and security audit of 2026-10-09, findings M-04, M-05 and M-06, all Medium.

## Context

Point 3 says the flat price is safe because both ends are capped, and point 4 says a provider cut-off after text is
refunded while a Stop after text is charged. Three places where those rules did not hold as written:

**M-04. The 90-second ceiling refunded long replies and kept the text.** One timer covered the whole turn whatever the
row's reply cap. A Thinking row (8,192 tokens) that did not sustain about 91 tokens a second was cut off by our own
timer, and the cut was treated as a provider failure: the text stayed on screen and the Credits came back. Nothing had
failed; we had ended it.

**M-05. A Stop before the first character refunded everything while the provider still billed.** Reasoning tokens
never reach `out`, so an abort during thinking is "nothing produced": `job_failed` and a full refund, as point 4 says.
The balance is never consumed, so it could repeat at the rate limit (10 a minute) for as long as anyone liked, and a
free-allowance send got its allowance back too. The only bound was the OpenRouter key's spend cap, which takes Chat
down for everyone when it is reached.

**M-06. The input caps are in characters; the price assumes four characters a token.** `MAX_HISTORY_CHARS` 24,000,
`MAX_USER_TEXT` 8,000 and `MAX_SYSTEM_PROMPT` 4,000 were priced as 9,000 input tokens. CJK text and most symbols are
about one token a character, so a user could fill history on a 1-Credit model, `PATCH` the thread to Opus and send
about 36,000 input tokens for the price of 9,000.

## Decision

1. **Our ceiling after text is a Stop, by us.** The turn's timer scales with the row's reply cap: 90 seconds at the
   1,024-token default, 20 ms more per extra token (about 50 tokens a second), so 233 seconds for an 8,192-token row.
   When it fires with text on screen, the reply ends as `canceled`: text kept and charged, exactly as a Stop by the
   user, and the screen is told `reply_time_limit` ("The reply reached its time limit and was stopped there. It counts
   as a stopped reply and is charged."). When it fires with nothing produced, the reply is refunded as
   `provider_timeout`, as before. A provider cut-off after text is still refunded; only our own ceiling changes side.
2. **Stops before the first character are counted, and the count has a ceiling.** `chat_stops_before_text(user)`
   (0258) counts the user's chat jobs that ended `FAILED` with `user_canceled` in the last rolling day, from the
   `jobs` rows those endings already leave. The turn asks it after the context read and before any money moves; at
   20 (`STOPS_BEFORE_TEXT_PER_DAY`) the send is refused with 429 `stop_limit` ("Too many replies were stopped before
   they started today. You can send again tomorrow. No Credits were used."). Point 4's refund stands: the twenty are
   still refunded in full. What is bounded is how often it can happen. A Worker running before 0258 is applied gets an
   error from the missing function and lets the send through, which is the behaviour it had.
3. **The three input caps also hold in estimated tokens.** `estimateTokens` counts a quarter per ASCII code point and
   one per anything else, never below the tokenizers in use for the text in question and equal to the
   four-a-token rule for English. The token caps are the character caps divided by four (6,000 history, 2,000 user
   text, 1,000 system prompt), so 6,000 + 2,000 + 1,000 is the 9,000 the price assumes and an English message is
   unchanged. A message or a system prompt over its token cap is refused with the same code as one over its character
   cap. History is trimmed a second time in `buildMessages`, newest messages kept whole, after the database's
   character trim.

## Consequences

- A long Thinking reply is no longer cut at 90 seconds and refunded; it runs to the row's cap and is charged.
- A reply that reaches even the scaled ceiling is now charged, not refunded. The user is told why in the chat.
- Twenty stops-before-text in a day end a user's sending until the day turns. A person who genuinely changes their
  mind twenty times in a day is caught too; the message says when they can send again.
- A CJK message can be at most 2,000 characters (was 8,000) and a CJK system prompt 1,000 (was 4,000). The screen's
  words still say 8,000 and 4,000; a second line for the token cap is left for the screen's own change.
- The two new error codes join the screen's word list (`chatErrorCopy`); `reply_time_limit` says "charged", not
  "Credits were used", so it is not one of the warnings `chatLocal` keeps beside a chat.

## Checked

- `tests/chatTurn.test.mjs`: the ceiling after text (kept, charged, `reply_time_limit`), the ceiling before text
  (refunded, `provider_timeout`), the ceiling's growth with the cap, the stop cap at exactly the ceiling and one under,
  and the pre-0258 fall-through. The earlier test that pinned the refund-on-ceiling rule now pins this one.
- `tests/chat.test.mjs`: `estimateTokens`, the CJK refusals at 2,001 and 1,001 characters, the history trim.
- 0258 on a local replay of the full chain, applied twice: a user with 21 chat stops (one older than a day), one
  non-chat stop and other failures counts 20; `anon` cannot call it, `service_role` can.
