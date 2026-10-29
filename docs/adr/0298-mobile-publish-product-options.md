# ADR-0298: Phone product editor edits options, collections and discounts

Status: Proposed

## Decision

This amends ADR-0229: the phone edits variants, collections and discounts rather
than carrying them through unchanged. These are catalogue values only; nothing
is sold, posted or charged. The host will assign this ADR's number.

The existing PUT route (`app/api/v1/social/commerce/products/route.js:18-20`)
accepts at most 100 variants with trimmed, nonempty titles of at most 120
characters, optional SKUs of at most 100 characters, and integer prices and
inventory quantities from 0 through 100000000. It accepts at most 20 collections
of at most 80 characters after trimming, dropping blanks and first-order
de-duplication. Discounts are percent or fixed with integer values from 0 through
100000000; percent is additionally capped at 10000. The RPC repeats the bounds
(`packages/db/schema/supabase/0321_social_ads_commerce.sql:163-177`).

The form uses decimal strings: prices and fixed discounts become cents;
percentage discounts become basis points (12.5 percent becomes 1250). Both stored
discount types display value/100 with two decimal places. Comma decimal input is
accepted. A new variant starts at the product price with zero stock. Collection
names are individual list entries, never comma-separated text, so `Prints, Gifts`
remains one name during an unrelated edit. Stored array order is preserved.

## Size limits and unreadable data

`lib/requestBodyLimit.js:3,22-30` enforces an exact 65536-byte UTF-8 request limit.
The phone counts the same JSON string that saveProduct sends, including all product
fields, and maps HTTP 413 to an actionable too-large message.

The RPC uses `pg_column_size(p_variants) > 65536`
(`packages/db/schema/supabase/0321_social_ads_commerce.sql:159`). That is jsonb
binary storage, not JSON text. The phone cannot compute it exactly. It instead
limits the compact snake_case variants JSON to 56000 UTF-8 bytes. Estimated jsonb
overhead is roughly 30–35 bytes per variant; at 100 variants this leaves about
6 KB of additional margin. This is a conservative estimate, not a measurement
of PostgreSQL storage. Field-valid CJK names and SKUs can exceed these budgets.

PUT replaces options wholesale (`0321_social_ads_commerce.sql:186`), so products
whose stored options cannot be parsed remain read-only, with an explicit
unreadable-options message. Shop-synced and archived products also remain
read-only (`0321_social_ads_commerce.sql:187`). All cards can open the editor for
viewing; summary accessibility elements are siblings of the action buttons.

## Gates and development verification

Owner, manager and editor write gates, the 402 UnlockCard, and ADR-0293's
brand/user reset and stale read/save fences remain unchanged. Options live in the
existing form state and are cleared by its existing reset. Read-only inputs are
not editable; Add and Remove buttons are absent. Discount radios remain visible
and disabled with disabled accessibility state, so a read-only product still shows
which option is set.

The development mock supplies a manual product with A3/A4 variants, a collection
and a 10 percent discount, and a Shopify product. The Agency brand is a viewer.
It persists replacement writes in memory, archives on DELETE, validates route
bounds, and rejects oversized request bodies. Its snake_case JSON size check is
only a stand-in for the RPC's jsonb check. Tests cover lossless round trips,
validation and byte boundaries, editing, read-only gates, scope reset and
separate accessibility elements for summaries and action buttons.

## Non-goals

No server, RPC, schema, package, flag or deployment changes. No shop connection
or sync, archive restoration, collection screen/filter, option images, per-option
discounts, discount codes/schedules, product posts or picture uploads. Lists still
show only option counts. Existing unused optionsWeb/editOnWeb translations remain.
