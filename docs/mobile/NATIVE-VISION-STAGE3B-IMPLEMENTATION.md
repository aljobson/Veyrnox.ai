# Native vision stage 3B — PR record

Frozen plan SHA256: `ff1e8f8c915f3128294ca202477ad73ef4c011bcb8bd79bbdd82b8fea1d75188`. This is the PR-facing dependency, rebuild and verification record; the host may move it into the eventual PR description. No PR, commit, push or publication was performed.

Still-photo and template-swap inference use a local Swift/Kotlin Expo module with unchanged result validators, CPU/IMAGE models, token cancellation, one running/one queued request, coalesced initialization and separate initialization/admission/inference deadlines. The plugin replaces stale prepared models only from a verified public copy or download, and checks model and notice sizes and SHA256 against `scripts/editor-vision-assets.mjs` before bundling. **`apps/mobile/app.json` changed; a store/development rebuild is required.** Missing native modules degrade to unavailable. Photo Studio stays disabled; camera/runtime retirement remains outside this slice.

## Pins and host-measured sizes

Use iOS `MediaPipeTasksVision 1.0.1` (requires `MediaPipeTasksCommon 1.0.1`) and Android `com.google.mediapipe:tasks-vision:1.0.0` (requires `tasks-core:1.0.0`). These are the host-confirmed closest releases to web `1.0.1`; Android has no `1.0.1`. The host checked arm64 JNI LOAD alignment at `0x4000`. The rejected `0.10.21` pin predates Android 16 KB page-size support introduced in `0.10.26`. The iOS pod minimum is 15.0; this module retains its existing 16.4 minimum.

All measurements below were supplied by the host, not measured by this implementation run.

| Artifact | Compressed archive | Unpacked/device detail |
| --- | ---: | --- |
| iOS MediaPipeTasksVision 1.0.1 | 292,695 bytes | ios-arm64 framework: 368 KB |
| iOS MediaPipeTasksCommon 1.0.1 | 368,421,556 bytes | ios-arm64 framework: 4.3 MB |
| iOS force-loaded device graph library | Included in Common | `libMediaPipeTasksCommon_device_graph.a`: 430,319,048 bytes, unlinked |
| Android tasks-vision 1.0.0 AAR | 495,413 bytes | Java/API artifact |
| Android tasks-core 1.0.0 AAR | 22,510,915 bytes | JNI sizes below |
| Bundled models | — | 20,130,433 bytes combined |

| `libmediapipe_tasks_jni.so` ABI | Unpacked bytes |
| --- | ---: |
| arm64-v8a | 11,015,096 |
| armeabi-v7a | 7,719,876 |
| x86_64 | 13,677,720 |
| x86 | 15,621,548 |

Android transitives: Guava `27.0.1-android`, Flogger `0.6`, protobuf-javalite `4.26.1`, Google transport-api `3.0.0`, transport-backend-cct `3.1.0`, transport-runtime `3.1.0`, annotation `1.1.0`.

Final IPA delta requires a device link and remains unmeasured; `.app`/`.apk` deltas are also unmeasured. Archive/static-library sizes are not installed-app size estimates.

## Android telemetry — owner decision pending

Host inspection: tasks-core 1.0.0 `TasksStatsLoggerFactory` always creates `TasksStatsProtoLogger`, which uses `RemoteLoggingClient` → `com.google.android.datatransport` (CCT destination) to send `MediaPipeLogExtension` usage records: task/solution names, invocation counts and sessions, not image data according to the proto class names. This is an artifact inspection, not a device traffic audit. No documented opt-out was found in the AAR. Excluding the datatransport group would likely cause `NoClassDefFoundError` when creating a task; no guard was seen.

Owner options: (1) keep it and disclose it in the privacy policy; (2) exclude it and ship a no-op datatransport API shim, requiring a device test; (3) another approach. **Unresolved here: this blocks enabling Photo Studio on Android, not merging.** Photo Studio stays dark. No telemetry code was changed; iOS telemetry has not been assessed.

## API compatibility audit

No MediaPipe call-site names or signatures needed changing. The audit covers constructors/builders, options, CPU/IMAGE enums, inference, label access, result/landmark access, mask dimensions/data and Android resource closing. It is not a native compile or accuracy result.

**iOS 1.0.1:** inspected the host's pod archive device headers at `frameworks/MediaPipeTasksVision.xcframework/ios-arm64/MediaPipeTasksVision.framework/Headers/`. Files checked: `MPPBaseOptions.h`, `MPPTaskOptions.h`, `MPPRunningMode.h`, `MPPImage.h`, `MPPMask.h`, `MPPLandmark.h`, `MPPFaceLandmarker.h`, `MPPFaceLandmarkerOptions.h`, `MPPFaceLandmarkerResult.h`, `MPPImageSegmenter.h`, `MPPImageSegmenterOptions.h`, `MPPImageSegmenterResult.h`. The headers retain the used Swift imports, including `detect(image:)`, `segment(image:)`, confidence-mask options and `float32Data`. Package identity/pin follows the [host-confirmed 1.0.1 podspec](https://github.com/CocoaPods/Specs/blob/master/Specs/9/9/0/MediaPipeTasksVision/1.0.1/MediaPipeTasksVision.podspec.json).

**Android 1.0.0:** checked these tagged source files:

- [BaseOptions.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/core/BaseOptions.java), [Delegate.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/core/Delegate.java), [BaseVisionTaskApi.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/vision/core/BaseVisionTaskApi.java).
- [FaceLandmarker.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/vision/facelandmarker/FaceLandmarker.java), [FaceLandmarkerResult.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/vision/facelandmarker/FaceLandmarkerResult.java), [NormalizedLandmark.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/components/containers/NormalizedLandmark.java), [ImageSegmenter.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/tasks/java/com/google/mediapipe/tasks/vision/imagesegmenter/ImageSegmenter.java).
- [BitmapImageBuilder.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/java/com/google/mediapipe/framework/image/BitmapImageBuilder.java), [ByteBufferExtractor.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/java/com/google/mediapipe/framework/image/ByteBufferExtractor.java), [MPImage.java](https://raw.githubusercontent.com/google-ai-edge/mediapipe/v1.0.0/mediapipe/java/com/google/mediapipe/framework/image/MPImage.java).

Also inspected the actual host-provided `tasks-vision`/`tasks-core` 1.0.0 `classes.jar` public signatures with JDK 17 `javap`: all classes above, option builders, `RunningMode` and `ImageSegmenterResult`. The last two source URLs were unavailable through the web reader; their artifact signatures confirm `IMAGE`, optional confidence/category masks and the existing accessor types. iOS header-member provenance and Android signatures are retained in `/private/tmp/veyrnox-s3b-proof/fix1-api/`.

## Verification and remaining limits

**Native proof supplied by the host:** iOS scratch prebuild and pod install included MediaPipeTasksVision/Common 1.0.1 and VeyrnoxVision. `xcodebuild -sdk iphonesimulator -configuration Debug -jobs 2 CODE_SIGNING_ALLOWED=NO build`: **BUILD SUCCEEDED**. `VeyrnoxVisionModels.bundle` contains `face_landmarker.task` (3,758,596 B) and `selfie_multiclass_256x256.tflite` (16,371,837 B). CocoaPods warns that MediaPipeTasksVision/Common are deprecated in favour of Swift Package Manager; migration is a follow-up. This is the host's build evidence, not a rerun after the plugin-only fixes below.

**Android: NOT built.** The host reports no JDK on the host Mac. Kotlin and the Gradle snippet remain unverified until the owner's Android build; earlier signature inspection does not establish compilation.

Fix round 2 changes only `apps/mobile/modules/veyrnox-vision/app.plugin.js`, `apps/mobile/__tests__/nativeVisionPlugin.test.ts` and this record. Stale model copies fall through to verified public/download sources. All three notice files are checked against inventory size/SHA256 before any resources are written; `FACE-NOTICE.txt` is matched by source because its inventory path is `NOTICE.txt`. Tests cover both platforms, local/download fallback, no valid source and each tampered notice.

Agreed proof: `cd apps/mobile && npx jest liveEdit swap vision`.

```text
Test Suites: 30 passed, 30 total
Tests:       184 passed, 184 total
Snapshots:   0 total
Time:        18.377 s
Ran all test suites matching liveEdit|swap|vision.
```

Exit 0. Mobile `tsc --noEmit`, lint on the changed plugin/test and `git diff --check` also passed. Local log: `/private/tmp/veyrnox-s3b-proof/jest-fix2.log`. Existing `MODULE_TYPELESS_PACKAGE_JSON` warning for `packages/live-edit/regions.js`.

Full Jest, both Metro exports and recorded real-output comparison still lack supplied proof. Earlier sandbox attempts were blocked by the shared build-slot lock and download DNS; ARTEMIS/ADB device access was unavailable. Existing fixtures are synthetic, so native/device accuracy is unverified. The camera/wig WebView paths remain outside this slice. No new denied action or deviation in fix round 2; no native builds, installations, previews or simulators were started here. No task-created worktrees need archiving. Small proof logs are retained; host native-build disk use/cleanup and linked application deltas were not supplied.
