# Mobile competitor and policy research (2026-10-17)

Read-only web research. Confidence tags: [P] primary source fetched, [S] secondary/third-party, [U] could not verify.
Search snippets were not all opened; anything tagged [S] needs a recheck before a product decision.

## 1. Competitor mobile vs web

### Higgsfield (AI generation)
- Official help page says: no mobile or desktop app; browser only; look-alike apps are copies. Page last modified 2026-09-24. [P] https://higgsfield.ai/creator-hub/help-center/getting-started/official-higgsfield-platforms
- Homepage meta copy says "generate content on web and mobile", with no app badge or download link. [P] https://higgsfield.ai
- CONFLICT: a third-party guide (dated 2026-10-09, updated 10-11) says Higgsfield, Inc. publishes a mobile app "Diffuse" (iOS 16+, Android): photo or prompt to short video only; Soul, Cinema Studio 4.0 and Genjutsu stay web-only; free download, in-app subscriptions, no prices given. [S] https://videogen.io/blog/does-higgsfield-ai-have-an-app
- Not verified: no App Store/Play listing opened for Diffuse. An iTunes Search API query for "higgsfield" returned no Higgsfield app. [U]
- A fake "Higgsfield: AI Video Generator" iOS app (other developer) was removed Sept 2025. [S] same videogen URL
- Takeaway: the closest competitor treats mobile as a thin generate-from-photo surface at most; the full studio is web. Navigation model of Diffuse: unknown. [U]

### CapCut (editor)
- iOS app is ByteDance Pte. Ltd., bundle com.lemon.lvoverseas, v19.7.0, listing advertises keyframes and chroma key. [P] iTunes Search API (itunes.apple.com/search?term=capcut)
- Mobile suits quick social edits and is where trending templates originate; desktop has the multi-track timeline, full AI toolkit; web is basic edits and templates, slower. [S] https://bigvu.tv/blog/capcut-complete-guide-2026-download-templates-pricing-when-switch/
- CapCut says Auto Cut is on mobile and desktop but not Web (2026). [S] https://jackrighteous.com/blogs/mont-real/capcut-desktop-mobile-web-2026
- Screens and navigation model (tabs, Templates, Edit): not verified. [U]

### Metricool (publishing)
- Mobile has: plan/edit/duplicate posts (files up to 500 MB), basic best times, AI text, image-only editor, post library, Drive and Canva, analytics, inbox, report generation (templates web-only), brand management, approvals, review requests. [P] https://help.metricool.com/en/article/features-available-in-the-mobile-app-ut3sji/
- Web-only: edit per network, threads, social calendars, SmartLinks, ads campaigns, Adobe Express, user management, subscription management. Video editing is web-only. [P] same URL; video-editing line [S] https://metricool.com/metricool-app/
- Listing: Metricool Software SL, bundle com.ionicframework.metricool185346 (suggests an Ionic/Capacitor hybrid, inference), v3.24.7 released 2026-10-08, first release 2016. [P] iTunes Search API (term=metricool)
- iOS sign-in is email/password only; Android also offers Google and Facebook. [S] https://metricool.com/metricool-app/

### ReelShort (Social Cinema analogue)
- App Store: NewLeaf Publishing, Entertainment, 13+, 166.5 MB, v4.2.00 (Sep 28 per listing), vertical one-minute episodes, interactive "choose what happens" shorts, new series daily, 21 extra languages. [P] https://apps.apple.com/us/app/-/id1636235979
- Release notes mention "earning more coins". Coins also earned by watching ads (secondary). [P]/[S] https://en.wikipedia.org/wiki/ReelShort
- Tab structure, player gestures, episode-unlock UX: not verified. [U]

## 2. Mobile billing

| App | Mobile billing found | Source |
|---|---|---|
| Higgsfield | Diffuse (if real): free download, in-app subscriptions, no prices. Web: credit plans, third-party price figures conflict ($9 vs $15 vs $19 entry) | [S] videogen URL above; https://www.hooked.so/compare/higgsfield-pricing |
| CapCut | Pro/Standard subscriptions on mobile and desktop at different prices; CapCut says the gap is intentional. Reported Pro $7.99-$19.99, Standard about $9.99; not confirmed. Whether web subscribing is cheaper than store: [U] | [P] https://www.capcut.com/help/different-price-for-capcut-mobile-and-desktop ; [S] https://bigvu.tv/blog/capcut-free-vs-pro-what-2026s-restructure-gives-you/ |
| Metricool | Plans bought on the website; changing or cancelling is website-only, except plans bought through app stores (so a store-purchase path exists). Subscription management is not in the app | [P] https://help.metricool.com/en/article/features-available-in-the-mobile-app-ut3sji/ |
| ReelShort | iOS: 10 IAPs: 3 weekly subscriptions at $19.99 (7-day, auto-renew, "all series while active"), consumables $4.99 to $29.99. Coins plus subscription pass model. Also a web store (reelshort.com) with no store commission; MPA projects $785M revenue 2025, $1.05B 2026; no web-share figure published | [P] App Store URL above; [S] https://www.techtimes.com/articles/323399/20260806/reelshort-hits-1-billion-microdrama-revenue-first-profit-driven-app-store-bypass.htm |

Pattern: virtual currency (coins) and subscriptions sold through store IAP and mirrored on a web store. Management/cancel and heavy workflows sit on web.

## 3. Store policy facts

### Apple
- App Review Guidelines 1.2 explicitly names "AI content creation apps" as UGC apps. Required: objectionable-content filtering, report mechanism with timely response, block abusive users, published contact info. [P] https://developer.apple.com/app-store/review/guidelines/ (page shows no date)
- 1.2.1(a) Creator apps: identify content above the app's age rating and apply an age restriction mechanism based on verified or declared age. [P] same. A Nov 2025 update is reported as adding this. [S] https://ppc.land/apple-tightens-app-store-age-controls-and-data-sharing-disclosure/
- 5.1.2(i): must clearly disclose where personal data goes "including with third-party AI" and get explicit permission first. Reported as a 2025-11-13 revision. [P] guideline text; date [S] https://www.radom.com/insights/apple-updates-app-review-guidelines-to-strengthen-privacy-protections-against-third-party-ai-data-sharing . Applies to us: prompts, uploaded photos/voice go to fal, kie, OpenRouter, etc. Apple has not clarified on-device vs cloud scope [S].
- 3.1.1: digital content/features unlocked in-app must use IAP; 3.1.1(a): link-out entitlements exist; text says the prohibition on buttons/links to other purchase methods does not apply on the United States storefront. [P] guidelines URL
- US external links: district court (Apr 2025) found Apple in contempt and barred any commission on linked purchases; Ninth Circuit (Dec 2025) upheld contempt but allowed a commission limited to costs "genuinely and reasonably necessary", and allows Apple to require IAP prompts as prominent as link-outs; remanded to set rate. Supreme Court declined a stay (May 2026) and on 2026-06-30 agreed to review the contempt finding; argument expected in the term starting Oct 2026. Commission on US link-outs currently not being collected per reporting, but this is unsettled. [S] https://courthousenews.com/apples-fight-over-commissions-for-linked-out-app-store-purchases-continues-in-federal-court/ ; https://thenextweb.com/news/supreme-court-apple-epic-contempt-app-store-commission ; https://www.neonpay.com/blog/the-latest-epic-v.-apple-appeal-ruling-december-2025-what-changed-for-game-developers . Not checked against court dockets. [U]
- EU: new terms announced 2026-08-18, effective 2026-10-01 per secondary coverage: Core Technology Fee replaced by 5% Core Technology Commission on off-store digital sales; reported tiers 26% IAP, 20% alternative processing, 15% link-out; link-outs prohibited in Kids category; old addenda replaced by Attachment 14 of the DPLA. Developer open letter disputes the economics. [S] https://phiture.com/blog/apple-new-app-store-terms-2026/ ; https://ppc.land/apple-kills-eu-per-install-fee-for-5-commission-on-non-app-store-sales/ . Not verified on Apple's developer site. [U]

### Google Play
- AI-Generated Content policy: apps generating content from text, voice or image prompts (chatbots, image/video generation) must follow Play policies, block restricted content (CSAM, deceptive content), provide in-app reporting/flagging without leaving the app, and use reports to tune moderation. [P] https://support.google.com/googleplay/android-developer/answer/13985936?hl=en (page shows no effective date). Announced Oct 2023, enforcement early 2024 [S] https://9to5google.com/2023/10/25/google-play-gen-ai-policy/
- Apps that only host AI content fall under the UGC policy instead [S] (search summary of the same help page; not re-read).
- Play external-offer/billing rules after the Epic v. Google remedies: NOT researched. [U]

Implication for Social Cinema: it hosts, not generates, but our generation tabs are AI content creation apps; build report, block, age gate and contact info into both.

## 4. Technical hard parts (React Native / Expo)

- Vertical feed: standard pattern is a paging virtualized list (FlatList or FlashList) with only the active item playing and a separate preload manager. [S] https://www.mux.com/docs/frameworks/react-native-stories-reels-ui ; https://www.mux.com/blog/slop-social
- FlashList v2 reportedly needs the New Architecture; performance claims unverified. [S] https://reactnativerelay.com/fa/article/rahnamaye-flashlist-v2-react-native-mohajerat-flatlist-2026
- expo-video: known Android issue when two VideoViews overlap with `cover` fit (one renders out of bounds); workaround `surfaceType="textureView"`. Matters if adjacent players stay mounted. [P-ish] https://docs.expo.dev/versions/latest/sdk/video.md
- Expo-video preload API specifics and memory limits for a 3-player window: not verified; measure on a low-end Android. [U]
- FFmpegKit is retired by its maintainer; 16 KB page-size breakage on Android reported; forks exist (e.g. ffmpeg-kit-extended) with unverified maintenance. Do not plan on FFmpegKit for on-device work. [S] https://cdn.jsdelivr.net/gh/arthenica/ffmpeg-kit@main/README.md ; https://dev.to/akashskypatel/flutter-react-native-cross-platform-plugin-ffmpeg-kit-extended-2161
- Skia: react-native-skia has a `useVideo` hook exposing the current frame as a Reanimated shared value (needs Reanimated 3+, Android API 26+). Community `@azzapp/react-native-skia-video` adds composition and export but is marked very unstable beta. [S] https://www.mintlify.com/shopify/react-native-skia/images/video ; https://unpkg.com/@azzapp/react-native-skia-video@0.8.3/README.md
- On-device encoding (AVAssetWriter / MediaCodec bridge from Skia frames): nothing found. Practical options for us: (a) preview on device, final render on server using our existing web/Fly render path; (b) custom native module. Decision needs a spike. [U]
- Reanimated drives playhead and gestures on the UI thread (Skia docs). [S] https://www.mintlify.com/shopify/react-native-skia/animations/overview
- Competitor evidence: Metricool keeps video editing web-only; CapCut mobile is limited for multi-track work. Supports a server-render, simple-trim mobile scope. [S]/[P] sources in section 1.

## 5. Push notifications and deep links

- Competitor push/deep-link patterns (ReelShort new-episode pushes, CapCut template links, Metricool publish notifications): only Metricool's listing mentions "publishing notifications" [P] iTunes Search API (term=metricool). Everything else about competitors: [U], not researched beyond this.
- Platform mechanics: Universal Links (iOS) and App Links (Android) need a domain you control plus verification files (apple-app-site-association, assetlinks.json); Expo Router enables deep links for all screens; test in a development build, not Expo Go; iOS needs `associatedDomains` without protocol. [P] https://docs.expo.dev/guides/linking ; https://docs.expo.dev/guides/deep-linking/
- Cold-start push taps: handle the destination only after the router is ready. [S] https://docs.customer.io/integrations/sdk/expo/push-notifications/deep-links
- Our constraint (CLAUDE.md): OAuth return URLs must be origins we control; refresh tokens never in URLs. Deep links to checkout or sign-in must not carry tokens.

## 6. Open items to verify before design lock
1. Does Diffuse exist (App Store/Play listing, price, screens)? Higgsfield's own help page says no app.
2. Current US link-out commission status after the Supreme Court term (check docket / Apple developer news).
3. Apple EU terms on developer.apple.com.
4. Google Play external offers/alternative billing rules (not researched).
5. Competitor push categories and deep-link schemes (needs device capture, not web search).
6. On-device export feasibility spike (Skia frames to encoder) vs server render.
