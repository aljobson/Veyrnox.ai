# ADR-0097 — The editor is included; upgrades use existing Credit Packs

Status: accepted by the owner on 13 October 2026.

## Decision

The full browser video editor is a standard Veyrnox.ai capability. It is
available without a subscription or card and does not have a separate paid
membership.

The editor's Credits surface uses the existing one-off Credit Pack catalog and
purchase flow. It reads current pack values from the public API rather than
defining prices in the editor. At acceptance, that catalog is:

| Pack | Price |
| ---: | ---: |
| 100 Credits | $10 |
| 270 Credits | $19 |
| 1,200 Credits | $59 |
| 3,000 Credits | $129 |

Credit Packs never expire and do not renew. The editor dialog links customers to
the existing Credits & billing purchase flow, where explicit supply consent and
Stripe Checkout already apply. A Stripe return URL never proves payment; the
existing top-up recovery and webhook path verify payment before granting
credits.

This decision does not alter the catalog, database rows, Stripe prices,
subscription plans, or existing purchases. The dormant subscription catalog
and its release requirements remain governed by ADR-0064 and ADR-0082.

The editor surface uses a familiar professional editing-product interaction
pattern while retaining Veyrnox branding, wording, accessibility, prices and
features. It must state plainly that editing is included and that payment buys
generation credits, not access to editing.
