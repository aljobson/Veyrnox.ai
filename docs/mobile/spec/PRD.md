# PRD: Veyrnox.ai mobile app

**Status:** Proposed 2026-10-19, written against `main` at `4768d535`. Feature states come from merged PRs, ADR status lines and the code; nothing was run on a device.
**Owner:** product owner (Al Jobson). The "Veyrnox.ai mobile app" session builds; the planning session writes specs.
**Predecessors:** [ADR-0106](../../adr/0106-mobile-app.md) (the app), [ADR-0108](../../adr/0108-mobile-store-billing.md) (store billing), [ADR-0109](../../adr/0109-mobile-publish-plan-and-store-catalog.md) (Publish Plan in stores), [ADR-0110](../../adr/0110-mobile-account-and-safety.md) (account and safety), [ADR-0135](../../adr/0135-cinema-block-users.md) (blocking).
**Language:** terms are those of [CONTEXT.md](../../../CONTEXT.md). This document adds none.
**Set:** [README.md](README.md) lists the other five documents.

## 1. Overview

Veyrnox.ai is a credit-metered AI generation platform on the web: image, video and voice generation, a video editor, a publishing tool (Veyrnox Publish) and Social Cinema, an episodic video catalogue. The mobile app is the same product as a native iOS and Android client of the same `/api/v1` gateway. It is not a second product and has no backend of its own.

The reference points the owner named are Higgsfield (AI video and audio), CapCut (editing), Metricool (publishing) and ReelShort (Cinema). The web product is the design reference, not those apps.

## 2. Why

- People make short video on a phone and post from a phone. A web-only product loses the moment they want to make something and send it on.
- Generations take minutes. A phone can tell the person when it is done; a browser tab cannot.
- Store presence is a distribution channel the web product does not have.

## 3. Who it is for, and the jobs

| Person | Job in their words |
|--------|--------------------|
| Short-video maker | "When I have an idea, turn it into a clip I can post tonight." |
| Social manager | "When a clip is ready, schedule it to my accounts without opening a laptop." |
| Viewer | "When I have ten minutes, watch something good and be able to come back to it." |
| Returning member | "When my video finishes, tell me, and let me trim or caption it and post it." |

## 4. Features and state

Key: **Shipped** (merged, flag state noted), **In flight**, **Decided, not built**, **Deliberately not built**.

### 4.1 Account and trust

| Feature | State |
|---------|-------|
| Sign in with Apple, Google, email (hidden bot check), 18+ tick | Shipped (ADR-0106, 0110) |
| Account: sign out, restore purchases, report, appeals, help, referrals, credit history, legal links | Shipped |
| Delete account in the app | Shipped, off until `EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED` and the server flag are on (ADR-0111) |
| Consent before content goes to an AI provider | Shipped (ADR-0128) |
| Block a Cinema member, Blocked list, report on comments | Shipped; server migration 0353 applied 2026-10-18 (ADR-0135, 0141, 0142) |
| Push notification when a creation finishes | Shipped, off behind `EXPO_PUBLIC_PUSH_ENABLED`; server `PUSH_NOTIFICATIONS_ENABLED` on staging only (ADR-0113) |

### 4.2 Create

| Feature | State |
|---------|-------|
| Create with a prompt: image, video, audio models from the catalog, price shown first, idempotent submit | Shipped |
| Create from your own photo, video or audio (upload, save, share) | Shipped (ADR-0114) |
| Templates from `GET /api/presets` | Shipped (ADR-0120) |
| Auto Short and the video agent | Shipped (ADR-0117, 0118) |
| Free allowance card | Shipped (ADR-0124) |
| Quick edit: trim, join, captions, render on the server | Shipped (ADR-0134) |
| Film Studio runs | Decided, not built; needs a route survey first |
| Multi-track timeline editor, in-browser Enhance | Deliberately not built on the phone (decision 2 of the roadmap) |

### 4.3 Library and projects

| Feature | State |
|---------|-------|
| Library of creations with cache and offline view; Save to Photos, Share, Delete | Shipped (ADR-0119, M8) |
| Library video files (film masters, editor renders), read-only | Shipped (ADR-0130) |
| Workspaces and projects, read-only | Shipped (ADR-0131) |

### 4.4 Chat

| Feature | State |
|---------|-------|
| Chat with Vey: threads, personas, folders | Shipped (ADR-0125, 0126). Becomes the mascot sheet (slice N8) |

### 4.5 Publish

| Feature | State |
|---------|-------|
| Publish Plan paywall through the store | Shipped (ADR-0109) |
| Accounts, posts, analytics, brand switcher, approvals, calendar and best time (read) | Shipped (ADR-0121, 0137, 0138) |
| Compose, schedule, cancel, restore | Shipped (ADR-0122) |
| Connect a social account from the phone | Shipped (ADR-0136, 0140); cannot work against a provider until the owner registers redirect addresses |
| Inbox, contacts, ads, autolists, SmartLinks, developer keys | Deliberately not built on the phone |

### 4.6 Cinema

| Feature | State |
|---------|-------|
| Free viewing feed, one active player, signed playback | Shipped (PR #1251, spike note `CINEMA-PLAYBACK-SPIKE-2026-10-18.md`), not proved on a device |
| Comments with report and block | Shipped |
| Pass, pay-per-title unlocks, credit subscriptions in the app | Decided, not built; needs its own decision record and in-app purchase plan (server S5) |
| Creator upload and analytics | Deliberately not built on the phone (web handoff) |

### 4.7 Money

| Feature | State |
|---------|-------|
| Credit packs through the store only (RevenueCat) | Shipped, sandbox buy proved on the Test Store; refund and a real sandbox purchase not proved |
| Web link-out to buy credits | Deliberately not built (roadmap decision 4) |

### 4.8 Navigation and first run

| Feature | State |
|---------|-------|
| Five-tab shell, balance chip, avatar to Account | Decided, not built (N1) |
| First-run intro and credits explanation with the real free amount | Decided, not built (N3) |
| Signed-out preview of Explore and the Cinema list | Decided, not built (N2) |
| Vey mascot as the chat entry on every screen | Decided, not built (N8) |
| Result screen next steps: Edit, Publish, Make another | Decided, not built (N5) |
| Explore as the home screen | Decided, not built (N4) |

## 5. Out of scope

- A native multi-track timeline. FFmpegKit is retired and Skia video export is beta; quick edit runs on the server.
- Any wallet, crypto or on-chain wording or feature. The Veyrnox wallet is a separate business (hard wall in `CLAUDE.md`).
- Selling credits, Pass or subscriptions through anything but the stores, and any link that steers to web checkout (App Store 3.1.1).
- Per-user model training and real-time camera filters (same reasons as the web).

## 6. Success criteria

Proposed; the owner has not set numbers.

1. A new person who installs the app can make a first creation and see it, within five minutes, without help (N7 walkthrough).
2. Every check in [DEVICE-PASS-2026-10-18.md](../DEVICE-PASS-2026-10-18.md) passes on an iPhone, then on a Pixel-class phone.
3. TestFlight external review and Play internal testing return no rejection on content, billing or account deletion.
4. Every debit has a refund path, and `reconcile_balances()`, `reconcile_free_credits()` and `reconcile_top_ups()` return zero rows for the 24 hours after store billing is switched on in production.
5. Crash-free sessions and first-creation rate are measured from the first TestFlight build (targets to be set by the owner).

## 7. Launch blockers

Owner steps (accounts, keys, agreements) and flag flips are in [PLAN-2026-10-18.md](../PLAN-2026-10-18.md) section 2A and the M7 checklist. The three that stop a first TestFlight build: the App Store Connect API key and in-app purchase products, the RevenueCat iOS key, and a review account on production.

## 8. Open questions

1. Targets for success criterion 5.
2. Whether Oddlings gets a phone screen or stays a web link.
3. Whether the app needs a light theme (it is dark only today).
4. Whether paid Cinema ships in the first store release or later (recommended: later, free viewing first).
5. Where Vey sits by default on a phone and when it hides.
