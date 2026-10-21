# ADR-0248: Draw to edit on the phone with React Native Skia

Status: Accepted

The mobile Create form supports the web's draw-to-edit workflow. There is no inpaint mask input today: `app/api/v1/generations/route.js:44` defines the input allowlist without a mask key, and the capability record fields in `lib/modelCapabilities.js:20-36` declare no mask media slot. Unknown input keys are refused. A true mask would require a server allowlist change, a capability slot and a provider accepting that slot; it is outside this change.

Coloured marks are flattened over the upright photo into one opaque PNG, replacing the start image through SourcePicker's existing validation and upload path. There is no second upload or generation input. The prompt explains what the marks mean. Only image models declaring both an image slot and a prompt input are eligible; models unable to receive instructions would have no useful interpretation for the marks. Library choices and other source slots are excluded. This intentionally narrows the web's image-model rule.

The existing native image manipulator prepares the photo at a 2048-pixel maximum edge before Skia decodes it. The slot's optional maxPixels limit can reduce that size further, preserving the aspect ratio with integer dimensions. Operations use image pixels. A shared drawOps renderer draws the photo first and the marks on a separate layer, so erasing removes only marks. The preview records the same renderer as the CPU PNG export, whose surface has exactly the prepared dimensions.

React Native Skia 2.14.0 is the host-installed Expo SDK 58 version. Its CPU surfaces provide exact pixel-size exports and its pictures reuse the same drawing operations on screen. SVG plus view-shot would require two packages and capture at view scale; a WebView canvas would require a large base64 round trip. The estimated native binary cost is about 6 MB on iOS and 4 MB on Android. PanResponder supplies gestures without adding gesture or animation dependencies. A lazy, guarded module load hides Draw on older binaries without Skia.

Install with `cd apps/mobile && npx expo install @shopify/react-native-skia`, which resolves the 2.14.0 that Expo SDK 58 pins. The package needs a native rebuild (pod install or prebuild), done only in the single consolidated mobile build environment. It has no config plugin and needs no app.json change. Clean the generated caches afterwards.

Each picker claims its own drawing file. A once-per-process sweep before the first write removes unclaimed previous-launch files, preserving mounted owners. Replacement, removal and unmount release ownership. Account changes clear all drawing files and invalidate affected picker state. Operation tokens dispose late images and delete late temporary JPEGs/PNGs after cancellation, unmount or an account change.

S7's pass criterion is: the flattened PNG at the prepared size is accepted as the same image input. Automated CanvasKit pixel proof checks dimensions, opaque output and erasing back to the photo. The host still performs the staging dev-build device row: pick a 12 MP photo, draw, upload, Generate at the displayed price, observe acceptance, verify the prepared dimensions and confirm cleanup after leaving the form. Native builds remain in the consolidated mobile environment.
