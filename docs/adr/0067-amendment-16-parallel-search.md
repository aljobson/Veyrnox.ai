# ADR-0067 amendment 16: keyless capped Web search

- **Status:** Proposed. The owner accepts it by merging this change.
- **Date:** 2026-10-18
- **Amends:** [ADR-0067 amendment 8](0067-chat-replies-are-jobs.md#amendment-8-2026-10-05-a-capped-search-of-our-own)

## Decision

Capped Chat Web search uses [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
when no search provider is configured. Anonymous searches use Fast mode and need no
account or search API key. Existing `EXA_API_KEY` credentials keep Exa selected.
`CHAT_SEARCH_PROVIDER=parallel` or `exa` explicitly selects a provider;
`CHAT_SEARCH_PROVIDER=off` disables capped search. Unknown values and an explicit
Exa selection without its key refuse search. A provider failure never selects a
different provider. Catalog rows using the OpenRouter plugin keep that engine.

This intentionally replaces amendment 8's no-key refusal for capped rows. The
models endpoint offers Web search only when the resolved provider is available.
The user's Web search switch, model availability, authentication, rate limit,
balance check and supplier-spend admission still gate the operation. Parallel
receives only the bounded current question, a stable chat conversation identifier
and the configured model identifier. The privacy notice names both search providers.

The fixed destination is `https://search.parallel.ai/mcp`, over Streamable HTTP.
The adapter initializes MCP, discovers `web_search` and calls it with the question.
It keeps at most three results, 2,000 characters of text per result, 200-character
titles and credential-free HTTP(S) URLs. The model still receives at most 7,000
characters of untrusted search context in the user turn. No page can add a tool
step. There is no automatic page-fetching step.

Search completes before debit; an error or empty result charges nothing. The
existing eight-second search deadline includes discovery and response reading,
and caller cancellation propagates. The job records the selected capped search
provider and the provider's cost only when reported. Parallel's MCP response does
not report a dollar cost, so none is recorded; reply Credits and model costs remain catalog decisions. No pricing
or database migration is part of this change. Parallel's free service has lower
rate limits; a rate limit returns the existing typed search error.

## Validation

Exercise provider resolution, explicit overrides and disabled search, the chat
turn through model context and stored source links, HTTP destination and project
User-Agent, bounded/sanitized results, errors, timeout and cancellation. Use a live
anonymous request through the chat caller with database and model dependencies
scripted; that establishes search wiring without making a billed model request.
Retain existing Exa, plugin, pricing and failure/refund regression tests.
