# 4. Video & Media Pipeline

## 4.1 Objectives

The media subsystem must:
- accept creator uploads reliably
- avoid exposing provider credentials
- process video asynchronously
- deliver adaptive streaming to mobile clients
- support moderation and visibility states
- provide playback analytics
- scale without Veyrnox.ai operating transcoding servers

## 4.2 Upload lifecycle

Episode states:

`Draft → Uploading → Processing → Ready → Scheduled/Published → Hidden/Removed`

### Direct upload
The creator requests an upload session from the Veyrnox backend. The backend validates the creator and episode, then requests a one-time provider upload URL. The creator uploads directly to Cloudflare Stream.

### Resumable uploads
Use tus for:
- files greater than 200 MB
- unreliable or mobile network conditions
- uploads where resume support materially improves success rates

## 4.3 Media validation

Before publishing:
- supported media type
- maximum duration
- minimum video dimensions
- portrait preferred for feed content
- file/processing status valid
- thumbnail present
- content metadata complete

Suggested MVP limits:
- preferred aspect ratio: 9:16
- maximum episode duration: configurable, initially 10 minutes
- target short-form episode duration: 30 seconds to 5 minutes

## 4.4 Playback

Requirements:
- adaptive bitrate playback
- prefetch metadata for the next feed item
- preload conservatively to avoid excessive mobile data consumption
- preserve user position when navigating within a series
- collect playback errors separately from normal exits

## 4.5 Signed playback

Public free episodes may use public playback initially. Signed playback should be supported for:
- pre-release content
- geo-restricted content
- creator previews
- future premium content
- moderation/review access

## 4.6 Media security

- API tokens stay server-side.
- Direct upload URLs are short-lived.
- Upload sessions map to a specific episode.
- Media UID changes require server-side validation.
- Hidden/Removed episodes are excluded from feeds immediately.
- Admin tooling must not expose reusable provider secrets.

## 4.7 Content moderation hooks

The architecture should allow:
- pre-publication automated media scanning
- audio/video classification services
- hash matching where legally appropriate
- human review
- post-publication user reports

Automated classifiers should support human review rather than being treated as the sole source of truth for difficult cases.

## 4.8 Failure handling

Examples:
- Upload interrupted → resume or restart using a fresh session.
- Provider processing failed → set ProcessingFailed and notify creator.
- Webhook delayed → scheduled reconciliation job checks provider status.
- Published episode media unavailable → temporarily suppress from feed and raise alert.
