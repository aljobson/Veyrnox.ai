import assert from "node:assert/strict";
import test from "node:test";

import {
  checkNativeVersionBump,
  isNativeAffectingPath,
  requiresVersionBump,
} from "./check-native-version-bump.mjs";

test("recognizes native-affecting mobile paths", () => {
  assert.equal(isNativeAffectingPath("apps/mobile/package-lock.json"), true);
  assert.equal(isNativeAffectingPath("apps/mobile/plugins/with-widget.js"), true);
  assert.equal(isNativeAffectingPath("apps/mobile/src/screens/Home.tsx"), false);
});

test("allows JavaScript-only changes without a version bump", () => {
  assert.equal(requiresVersionBump(["apps/mobile/src/screens/Home.tsx"]), false);
});

test("rejects a native change when expo.version is unchanged", () => {
  const result = checkNativeVersionBump({
    paths: ["apps/mobile/package.json"],
    baseVersion: "1.0.1",
    headVersion: "1.0.1",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.nativePaths, ["apps/mobile/package.json"]);
});

test("allows a native change when expo.version is bumped", () => {
  const result = checkNativeVersionBump({
    paths: ["apps/mobile/modules/smart-cut/index.ts"],
    baseVersion: "1.0.0",
    headVersion: "1.0.1",
  });

  assert.equal(result.valid, true);
  assert.equal(result.versionChanged, true);
});
