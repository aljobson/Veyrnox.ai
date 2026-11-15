# Simulator build number matches TestFlight

QA needs to tell which build the simulator is running. The simulator build must carry the same
`CFBundleVersion` as the current TestFlight/production build.

## Why it did not match

`apps/mobile/eas.json` uses `cli.appVersionSource: "remote"`. EAS gives the remote counter to the
`production` profile, which auto-increments it. The `production-simulator` profile extends
`production` with `autoIncrement: false` and `ios.simulator: true`. EAS records **Build number 1**
for those builds (checked 15 Nov 2026: `production` builds 51 to 54, every `production-simulator`
build 1, including f36fe15f from main d726add). So the app on the simulator showed
`CFBundleVersion 1` while TestFlight was at 54.

## How it is fixed

- `apps/mobile/app.config.js` sets `ios.buildNumber` from the EAS variable
  `VEYRNOX_SIMULATOR_BUILD_NUMBER`, and only when `EAS_BUILD_PROFILE` is `production-simulator`.
  Every other profile returns `app.json` unchanged, so the production counter and its behaviour are
  not touched. `ios.buildNumber` is excluded from the Expo fingerprint, so the runtime version (OTA
  compatibility) does not change.
- `apps/mobile/scripts/simulator-build-number.mjs` reads the production number with
  `eas build:version:get -p ios --profile production` (read only, never increments) and stores it
  in that variable (`eas env:set production`, plain text, not secret).

## Commands (run in `apps/mobile`, logged in to EAS)

```bash
npm run sim:build-number      # print the current production/TestFlight build number (read only)
npm run build:ios-simulator   # sync the number, then start one production-simulator EAS build
npm run sim:verify            # compare the installed simulator app with production (exit 1 on mismatch)
```

Always use `npm run build:ios-simulator` for a simulator build. Plain
`eas build --profile production-simulator` still works but warns and builds with number 1, because
the variable can be stale after a new TestFlight build.

A simulator build costs one EAS iOS build (about 8 minutes of build time). The script never runs a
production build or a submission.

## Check what is installed

`npm run sim:verify [udid]` does this for you (default: the booted simulator). By hand:

```bash
U=E6CA7391-3BBB-4650-8E42-F1EDBD81F9F1   # iPhone 17 Pro, the default simulator
P="$(xcrun simctl get_app_container $U ai.veyrnox.app)/Info.plist"
plutil -extract CFBundleVersion raw "$P"
plutil -extract CFBundleShortVersionString raw "$P"
```

## Not covered

The About screen shows the version only. The git commit is not exposed to the app: putting it in
Expo `extra` would change the fingerprint (and so the runtime version) on every commit, so it was
left out. The EAS build page shows the commit for each build.
