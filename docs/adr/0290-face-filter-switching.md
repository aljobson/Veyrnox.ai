# ADR-0290: Face filter switching keeps the photo; a result can be the next source

Status: Accepted

Each job applies one catalog filter to one image. Changing filters keeps the attached
photo and its uploaded source key, while selecting a filter resets its settings and
prompt. The catalog supplies each run's price without client-side arithmetic.

Rights confirmation is an attestation for each run. Switching filters, changing
settings, attaching a result and submitting a run clear it; it is never inherited
from a photo or a navigation handoff.

A finished result can become the next filter's source using `source_assets` with its
job id. Chaining never downloads or re-uploads the result's bytes. Its signed URL is
only a renewable preview, never a generation input. Refresh on stale redisplay or
foregrounding and on an image error; an unsuccessful image refresh chain stops at
Retry until the person retries or the image loads successfully.

Choosing a replacement photo or trying the same filter on a new photo clears the
result source. Account changes and unmount invalidate outstanding work so late
answers cannot restore an attached source. Missing or invalid result assets clear
the attachment and show the existing upload guidance.
