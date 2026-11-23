# Mobile template source compatibility

This is the Wave 4 contract for videos attached to a generation or template form. It records the remaining web-to-mobile gap without weakening the upload boundary.

| Source | Web | Mobile now | Required before mobile acceptance |
| --- | --- | --- | --- |
| MP4 | Accepted | Accepted | Existing rights, byte-size, duration, resolution, MIME and server checks remain authoritative. |
| MOV / QuickTime | Accepted and decoded in the browser editor | Refused by the general source picker | Convert on iOS with `AVAssetExportSession` to a new MP4. Cancellation must remove partial output. The converted file must be inspected again for MIME/signature, size, duration and dimensions before upload. Original rights confirmation and account/session fencing still apply. |
| WebM | Accepted where the browser codec is available | Refused by the general source picker | Add a verified native decoder/transcoder, bounded resource use, cancellation and cleanup. Prove VP8/VP9 plus supported audio combinations with device fixtures before exposing the picker type. |

The Photos picker continues to request iOS's compatible representation, which normally returns H.264 MP4 instead of HEVC/QuickTime. The Files picker advertises only types that the mobile upload boundary can inspect and submit today. Merely adding `video/quicktime` or `video/webm` to the picker, renaming a file, or sending those bytes with `video/mp4` would be a defect.

`apps/mobile/__tests__/sources.test.ts` freezes the current matrix and carries executable pending contracts for MOV and WebM. When a conversion lane is implemented, replace the corresponding pending contract with fixtures that exercise success, cancellation, cleanup, oversize output, unknown duration, unsupported codec and account/session invalidation.

This contract covers generation/template source attachment. Cinema and Smart Cut have separate admission rules and do not imply general template-source compatibility.
