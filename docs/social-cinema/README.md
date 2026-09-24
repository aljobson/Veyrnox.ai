# Veyrnox.ai Technical Specification Pack

**Product:** Veyrnox.ai Social Cinema  
**Version:** 1.0  
**Status:** MVP Baseline  
**Audience:** Engineering, product, security, operations, investors, and technical partners

## Purpose

Veyrnox.ai is a mobile-first short-form episodic entertainment platform where audiences do more than watch. Users discover serialised video, vote on episodes and series, influence story outcomes, and help determine weekly featured content.

The MVP is built around one core loop:

**WATCH → VOTE → RANK → WIN → RETURN**

## Documents

1. [Product & Functional Specification](01-product-functional-spec.md)
2. [Solution Architecture](02-solution-architecture.md)
3. [Data Model & API Specification](03-data-model-api.md)
4. [Video & Media Pipeline](04-video-media-pipeline.md)
5. [Voting & Ranking Engine](05-voting-ranking.md)
6. [Security, Trust & Moderation](06-security-moderation.md)
7. [DevOps, Observability & Operations](07-devops-observability.md)
8. [MVP Delivery Roadmap](08-mvp-delivery-roadmap.md)
9. [Public Technical Overview](09-public-technical-overview.md)

## Proposed implementation baseline

- **Client:** React Native + Expo
- **Backend:** Supabase (Postgres, Auth, Realtime, Edge Functions where appropriate)
- **Video:** Cloudflare Stream
- **Push notifications:** Expo Notifications initially
- **Admin:** Web-based moderation and content operations console
- **Analytics:** Product analytics + video analytics + application telemetry
- **Deployment:** EAS Build / Submit for mobile, managed cloud deployment for backend services

## Reference documentation

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Cloudflare Stream: https://developers.cloudflare.com/stream/
- Cloudflare Direct Creator Uploads: https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
- Expo EAS Build: https://docs.expo.dev/build/introduction/
- Expo Push Notifications: https://docs.expo.dev/push-notifications/overview/
