# 2. Solution Architecture

## 2.1 Logical architecture

```text
                     ┌─────────────────────────┐
                     │      Veyrnox.ai App     │
                     │ React Native + Expo     │
                     └────────────┬────────────┘
                                  │
                    HTTPS / JWT / signed actions
                                  │
            ┌─────────────────────┴──────────────────────┐
            │                                            │
┌───────────▼───────────┐                    ┌───────────▼───────────┐
│ Supabase Platform     │                    │ Cloudflare Stream     │
│ Auth                  │                    │ Direct Uploads        │
│ Postgres              │                    │ Encoding              │
│ RLS                   │                    │ Adaptive Playback     │
│ Realtime              │                    │ Signed Playback       │
│ Edge Functions        │                    │ Video Analytics       │
└───────────┬───────────┘                    └───────────┬───────────┘
            │                                            │
            ├───────────────┐                            │
            │               │                            │
┌───────────▼───────┐ ┌────▼─────────────┐   ┌──────────▼─────────┐
│ Ranking Jobs      │ │ Notifications    │   │ Creator Upload     │
│ Weekly Scoring    │ │ Expo / FCM/APNs  │   │ One-time URLs      │
└───────────┬───────┘ └──────────────────┘   └────────────────────┘
            │
┌───────────▼───────────┐
│ Admin / Moderation UI │
│ Web application       │
└───────────────────────┘
```

## 2.2 Architecture principles

1. **Managed media infrastructure:** Veyrnox.ai does not build its own transcoding/CDN stack in MVP.
2. **Direct creator uploads:** video bytes travel from creator device to the video platform rather than through the application backend.
3. **Least privilege:** privileged keys exist only in secure server-side environments.
4. **Database-enforced authorization:** exposed application tables use Postgres Row Level Security.
5. **Separate content metadata from media:** episode records reference external media identifiers.
6. **Event-oriented analytics:** viewing and voting events are recorded separately from canonical content records.
7. **Moderation by design:** content states and moderator controls are first-class architecture components.
8. **Replaceable integrations:** media, notification and analytics providers are abstracted behind service interfaces where practical.

## 2.3 Client architecture

Recommended:
- React Native
- Expo Router
- TypeScript
- TanStack Query or equivalent server-state library
- local secure token storage
- platform-native share sheet
- Expo Notifications
- native video player compatible with HLS/adaptive streaming

Key client modules:
- authentication
- feed
- player
- series
- voting
- creator studio
- notifications
- reporting
- settings

## 2.4 Backend architecture

Supabase provides:
- user authentication
- Postgres relational data
- RLS authorization
- realtime updates where useful
- scheduled/server-side functions for ranking and operational workflows

Privileged operations must execute server-side, including:
- generating creator upload URLs
- confirming media readiness
- score aggregation
- winner finalisation
- moderation actions
- bulk notifications

## 2.5 Media architecture

Cloudflare Stream is proposed for MVP because it supports direct creator uploads, storage, encoding, adaptive playback and signed access controls in one managed service.

Recommended upload flow:

```text
Creator App
   │
   │ 1. Request upload session
   ▼
Veyrnox Backend
   │
   │ 2. Validate creator + episode
   │ 3. Request one-time upload URL
   ▼
Cloudflare Stream
   ▲
   │ 4. Return upload URL
   │
Creator App
   │
   │ 5. Upload video directly
   ▼
Cloudflare Stream
   │
   │ 6. Encode/process
   ▼
Webhook / status check
   │
   ▼
Veyrnox Backend → Episode status = Ready
```

For unreliable connections or files larger than 200 MB, the upload implementation should use the resumable tus path supported by Cloudflare Stream.

## 2.6 Environment separation

At minimum:
- Development
- Staging
- Production

Each environment must use separate:
- Supabase project or equivalent isolation
- Cloudflare media credentials
- notification credentials
- analytics project
- secrets
- moderation/admin access

Production data must not be copied into lower environments except through an approved sanitised process.

## 2.7 Trust boundaries

1. Mobile device is untrusted.
2. Public internet is untrusted.
3. JWT represents authenticated identity but does not itself grant unrestricted database rights.
4. RLS policies enforce per-row permissions.
5. Service-role credentials are server-side only.
6. Media upload URLs are scoped, time-limited and single-purpose.
7. Admin capabilities use stronger authorization than creator/viewer capabilities.
