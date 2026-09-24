# Veyrnox.ai — Technical Overview

## Social cinema, built for participation

Veyrnox.ai is a mobile-first episodic entertainment platform where viewers do more than watch. Audiences can vote for the stories they want to see win, follow ongoing series and participate in interactive story decisions.

Our core experience is built around:

**WATCH → VOTE → RANK → WIN → RETURN**

## Platform architecture

The Veyrnox.ai MVP uses a modern managed architecture designed for rapid delivery, strong security controls and scalable media distribution.

- **React Native + Expo** for a shared iOS and Android application.
- **Supabase** for authentication, Postgres data, realtime capabilities and database-enforced authorization.
- **Cloudflare Stream** for direct creator uploads, video processing and adaptive delivery.
- **Managed push notifications** for episode releases, voting windows and winner announcements.
- **Dedicated moderation tools** for content review, abuse handling and platform operations.

## Creator-first media flow

Creators upload video directly to the video platform using secure, time-limited upload sessions. Video is processed asynchronously, while Veyrnox.ai stores the series, episode, creator and voting metadata separately.

This avoids routing large media files through the application backend and allows the platform to scale video delivery independently from social features.

## Community voting

Veyrnox.ai rankings are designed to reward more than raw popularity.

Weekly ranking can consider:
- qualified community votes
- episode completion
- unique audience
- sharing
- engagement quality

Invalid or manipulated activity can be excluded from competition results.

## Interactive stories

Creators may attach a story decision to an episode. Viewers can vote on what should happen next, allowing creators to use audience feedback as part of an ongoing production.

## Security by design

The platform uses:
- token-based authentication
- database Row Level Security
- least-privilege access
- server-side privileged operations
- protected provider credentials
- audit logging for moderator/admin actions
- vote integrity controls
- abuse reporting and moderation workflows

## Built to evolve

The initial architecture is designed to support future capabilities including:
- creator monetisation
- premium episodes
- subscriptions
- richer recommendation systems
- advanced creator analytics
- funded Veyrnox Originals
- additional viewing platforms

Veyrnox.ai is not designed as a passive short-video feed. Its technical model is centred on audience participation and measurable community choice.
