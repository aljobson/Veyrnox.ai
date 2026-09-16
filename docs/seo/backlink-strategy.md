# Backlink strategy — Veyrnox.ai

Written 16 September 2026, alongside the on-page SEO pass.

## The honest starting position

Veyrnox.ai is a new domain with, as far as anything on this side can tell, no
referring domains. On-page work is now done; it stops being the bottleneck.
Nothing below produces results in under about eight weeks, and "AI video
generator" as a head term is not winnable in year one — Runway, Pika, Kling,
Luma and Sora own it, and they are backed by link profiles measured in tens of
thousands of referring domains.

So this strategy does not chase that term. It chases the one thing Veyrnox.ai
has that they do not: **published per-model prices and an auditable refund
rule.** Every competitor hides pricing behind a subscription tier. That asymmetry
is the link asset.

## What we are actually optimising for

Rankings on comparison and cost intent, not on generation intent:

- `<model> pricing` / `<model> cost per second` / `how much does <model> cost`
- `<model A> vs <model B> price`
- `AI video generator without subscription`
- `pay per generation AI image`

These have low volume individually. There are ~40 models in the catalog, and
the long tail across all of them is the whole point. They also convert far
better than head terms, because the searcher is already comparing cost.

## Tier 1 — do these first (weeks 1–4, no outreach required)

1. **Live pricing pages, one per model.** `/pricing/<model-slug>` rendered from
   `model_catalog`, showing credits per 5s, the GBP equivalent, the resolution
   and duration limits, and the refund rule. This is the single highest-leverage
   item on this list. It is the page people link to when arguing about cost in a
   Discord or a subreddit, and it is the page an LLM cites when asked what a
   model costs. It also happens to be content we already hold in the database.
   Currently `/pricing` is one page listing everything, which cannot rank for
   forty different queries.
2. **Submit to the AI tool directories.** Free listings, `dofollow` on several,
   and they are how this category actually gets discovered: Futurepedia,
   There's An AI For That, AI Tool Hunt, Toolify, Insidr, AI Scout, Foundr AI.
   Budget an afternoon; each takes a form, a logo and the OG image.
3. **Product Hunt launch.** One shot, so do it after the per-model pricing pages
   exist. A top-5 day is worth several hundred referring domains over the
   following year through roundup posts that scrape PH.
4. **Set up Search Console and Bing Webmaster Tools.** Not a backlink, but you
   cannot measure any of this without them, and Bing feeds ChatGPT's search.

## Tier 2 — earned links (weeks 4–12)

5. **A public, dated price-tracking page.** Provider pricing moves constantly.
   A page that records "Veo 3.1 dropped from X to Y on <date>" across the whole
   catalog, updated automatically from the ledger of catalog changes, becomes a
   citation target for every newsletter writer covering the space. This is the
   one piece of content most likely to earn links without asking.
6. **Cost-comparison posts, one per model pair that people actually compare.**
   Kling vs Veo, Wan vs Seedance, Nano Banana vs Flux. Real numbers, real output
   samples generated on the platform, published cost per clip. Not listicles.
7. **Answer the cost question where it is already being asked.** r/StableDiffusion,
   r/aivideo, r/SideProject, Hacker News threads on model releases. Link only when
   the specific number answers the specific question asked. This is slow, it does
   not scale, and it is how the first fifty referring domains arrive.

## Tier 3 — sustained (month 3 onward)

8. **Free tool pages that need no account.** A credit-cost calculator, a
   "what does a 30-second clip cost across every model" comparison widget. Free
   tools attract links from people who will never sign up, and links from
   non-customers count the same.
9. **Be the source for the trade press.** When a provider changes pricing, we
   know before most journalists do, because the catalog is versioned. A short
   note to the people covering this beat, with the actual numbers, is worth more
   than a guest post.
10. **Founder presence.** The person writing the cheque for provider capacity has
    a genuinely interesting view on unit economics in this category. That is a
    real post, and real posts get linked.

## What not to do

- **No paid link building, PBNs, or "100 backlinks for £50".** Cheap to buy,
  expensive to recover from, and this domain has no authority to absorb a
  penalty.
- **No guest-post mills.** The sites that accept them pass nothing.
- **No reciprocal link exchanges.**
- **No directory blasts** beyond the curated AI-tool list above.

## How to tell whether it is working

Check monthly, in this order:

1. Search Console **Pages** report — indexed count rising toward the sitemap count.
2. Search Console **Queries** — impressions on `<model> pricing` shapes, before
   clicks. Impressions move first.
3. Referring domains — any free backlink checker; the absolute number matters
   less than the direction.
4. Rankings last. They are the lagging indicator, not the leading one.

Expect nothing for six weeks. Expect the first `<model> pricing` impressions
around week eight, and first clicks around week twelve.
