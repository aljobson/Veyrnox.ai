# Veyrnox.ai

A credit-metered AI generation platform: users spend credits to generate images, video, and voice.

## Language

### Credits and buying

**Credit**:
The unit a user spends on a generation. Every model's price is a whole number of credits.
_Avoid_: Token, coin, point

**Credit Pack**:
A fixed number of credits sold for a fixed price in a single one-off purchase.
_Avoid_: Bundle, plan, package

**Pack Credits**:
Credits a user received from a Top-up. They never expire.
_Avoid_: Purchased credits (ambiguous once Subscriptions exist), paid credits

**Free Credits**:
Credits granted once at sign-up at no charge. They expire 90 days after grant and are spent before Pack Credits.
_Avoid_: Bonus credits, trial credits

**Top-up**:
A user buying a Credit Pack. The only way to buy credits today.
_Avoid_: Recharge, refill, purchase (when meaning this specifically)

**Supply Consent**:
A buyer's recorded acknowledgement, given before a Top-up, that credits arrive immediately and their right to cancel ends once they generate.
_Avoid_: Waiver, terms acceptance

**Auto-refill**:
Automatically buying a Credit Pack when a user's balance falls below a threshold. Not offered.
_Avoid_: Auto top-up, recurring top-up

**Subscription**:
A recurring plan that grants a monthly allotment of credits. Planned, not yet offered. A Credit Pack always costs more per credit than the best-value Subscription.
_Avoid_: Tier, membership

**Sales Channel**:
Where a Top-up is bought: web, iOS App Store, or Google Play. Each channel has its own Merchant of Record and its own Credit Pack prices.
_Avoid_: Platform, store (when meaning the channel)

**Merchant of Record**:
The company that legally sells to the user in a Sales Channel and collects and remits sales tax. Stripe (Managed Payments, sold through Link) on web.
_Avoid_: Payment processor, billing provider (when meaning the legal seller)

### Reversals

**Top-up Refund**:
A Top-up's money being returned, in full or in part, by Veyrnox or by the Merchant of Record. Takes back a matching share of that Top-up's Pack Credits, never below a zero balance. Veyrnox grants one within 14 days only if nothing was generated since that Top-up.
_Avoid_: Refund (on its own), money-back

**Credit Refund**:
Returning the credits spent on a generation that failed or was rejected. No money moves.
_Avoid_: Refund (on its own), reversal

**Chargeback**:
A card dispute against a Top-up, either reported by the Merchant of Record or inferred from a Top-up Refund that arrives after credits were spent since that Top-up. Freezes the account.
_Avoid_: Dispute (when meaning the reversal itself)

**Operator**:
A named Veyrnox staff member acting on a user's account, such as unfreezing it. Every Operator action records who acted and why.
_Avoid_: Admin (when meaning the person), support

**Frozen**:
An account state, entered on a Chargeback and left only when an operator unfreezes it, that blocks generating and buying. Sign-in, the library, downloads, and account deletion still work.
_Avoid_: Suspended, banned, locked
