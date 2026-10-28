# ADR-0280: Create's controls inside the chat Make panel

Status: Proposed

The phone's chat Make panel reuses CreateOptions, SourcePicker, catalog pricing,
validation and generationSubmit. Prompt-capable image, video and audio models,
including models requiring files, are available without leaving the conversation.
Camera, character, drawing and Auto Short remain in Create.

Sources use Create's ordered references and Library selection. Each selection
requires the binding English source-rights agreement. Model changes, opening the
panel and Make another remount the source controls; epoch checks discard stale
upload callbacks. No locale keys or server routes change.

Each image uses its own idempotency key and catalog unit confirmation. Failed
requests retain their keys. Partial or ambiguous retries show the maximum remaining
cost and bypass the client balance gate, allowing the server to replay accepted
keys without another charge. Make another cannot discard an unsettled or ambiguous
batch. Closing stops observation immediately without cancelling jobs or resetting
an in-flight submission's keys.

The panel owns its free allowance, invalidating it at submission and refreshing
on open and settlement. Balance is read again after settlement, never copied from
a generation response. Request counters and captured account/batch identity reject
stale allowance and balance answers. Account changes clear local private state.

Accepted jobs appear inline and share a polling AbortController. Batch guards
reject late job, poll and asset callbacks. Images form square tiles; video and
audio use InlineMedia. Asset failures leave the status visible. Explicit Open and
Library actions navigate away; running jobs remain available in the Library.

Validation covers controls, rights, batch keys, ambiguous and partial retries,
free allowance invalidation, read ordering and account isolation, inline media,
source remounts and polling cleanup. The agreed proof runs TypeScript, Jest,
English registry checking and app localization checking. Simulator inspection is
performed independently against the development mock server, without paid sends
to production.
