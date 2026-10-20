# ADR-0208: Mobile creator upload shell, "Continue on web" (parity P6)

**Status:** Proposed 2026-10-20. A shell only: **no upload is built.** Related: ADR-0143, spike S3 in `docs/mobile/spec/IMPLEMENTATION-PLAN.md`.

## Decision

- A creator (profile role `creator`) sees an "Upload a title" card on the Cinema Profile tab with one button, **Continue on web**, which opens `https://veyrnox.ai/social-cinema/creator` in the in-app browser. The URL carries nothing about the account; the web page signs the person in as it does anywhere. A viewer who is not a creator still sees the application block instead.
- Nothing else about uploading is in the app: no file picker, no draft form, no submit.

## What spike S3 must prove before the real screen is built

S3 is the native resumable upload of a 1 GB file to Cinema, run on a real iPhone and a mid-range Android phone:

1. **Resume after force-quit:** the upload continues from the last confirmed part, not from zero.
2. **Resume after a network change** (Wi-Fi to cellular and back, and offline for a few minutes).
3. **Background:** the upload continues with the app in the background (an iOS background URL session; an Android foreground service), and the phone says so.
4. **The server contract:** the Cinema upload routes (`lib/cinema/uploadApi.js`, `uploadRecovery`, ADR-0052 and ADR-0053) take chunked parts and let a client ask which parts exist; confirm the parts size, the 2 GiB ceiling and the signed-URL lifetime against a real run, and confirm the quarantine scan (`CREATOR_UPLOADS_ENABLED`, device uploads held off in production) before any of it opens.
5. **Policy:** a written App Store 1.2 (user-generated content) and Play AI-content plan before any submission with creator-uploaded video (IMPLEMENTATION-PLAN, owner decision 2026-10-19).

Drafts, the Rights Declaration, ratings and submit follow once upload works; they are large forms and need their own ADR.

## Not proved

Jest only. The link opens in the in-app browser; not run on a device.
