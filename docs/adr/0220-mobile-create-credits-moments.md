# ADR-0220: Mobile Create: know the balance before Generate (parity plan G5)

**Status:** Proposed 2026-10-20. Branched from main.

## Context

On the web, Create shows the price against your balance and disables Generate when you are short, with a way to buy.
The phone found out only after Generate, when the server answered `insufficient_credits`. The rest of the "credits
moments" list is already on main: the low-balance prompt on Explore (ADR-0191, #1399), "File expires" and
"Failed, refunded" in the Library (ADR-0156, #1344).

## Decision

No server change; the balance is the existing `GET /api/v1/balance` through the cached `useBalance`.

- The Create form reads the balance (refreshed when the screen comes into view). When the price shown, including the
  count and today's free runs, is more than the balance, a card says "You have N credits and this costs M. You need K
  more." with **Buy credits**, and Generate is off.
- An unknown balance (offline, not loaded) never blocks anything. The server still judges the real charge, and a
  refused one still comes back as the existing "Not enough credits" message.
- **Back to work keeps the prompt.** Buying credits opens `/credits` above the form, so the screen and its state stay.
  The draft is also written before leaving, and again when the form closes: the last words typed in the final
  600 ms were previously dropped when the screen closed before the save timer fired.

## Not proved

`tsc` and Jest only (owner disk rule); not seen on a phone. The return from a real store purchase to the form was not
exercised.
