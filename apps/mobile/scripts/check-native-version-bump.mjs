#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NATIVE_EXACT_PATHS = new Set([
  "apps/mobile/app.json",
  "apps/mobile/app.config.js",
  "apps/mobile/eas.json",
  "apps/mobile/package.json",
  "apps/mobile/package-lock.json",
]);

const NATIVE_PATH_PREFIXES = [
  "apps/mobile/android/",
  "apps/mobile/ios/",
  "apps/mobile/modules/",
  "apps/mobile/plugins/",
];

export function isNativeAffectingPath(path) {
  return (
    NATIVE_EXACT_PATHS.has(path) ||
    NATIVE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function requiresVersionBump(paths) {
  return paths.some(isNativeAffectingPath);
}

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function appVersionAt(repoRoot, ref) {
  const raw = git(repoRoot, ["show", `${ref}:apps/mobile/app.json`]);
  const version = JSON.parse(raw)?.expo?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`apps/mobile/app.json at ${ref} has no expo.version`);
  }
  return version;
}

export function checkNativeVersionBump({ paths, baseVersion, headVersion }) {
  const nativePaths = paths.filter(isNativeAffectingPath);
  return {
    nativePaths,
    versionChanged: baseVersion !== headVersion,
    valid: nativePaths.length === 0 || baseVersion !== headVersion,
  };
}

function main() {
  const [baseRef, headRef = "HEAD"] = process.argv.slice(2);
  if (!baseRef) {
    console.error("Usage: check-native-version-bump.mjs <base-ref> [head-ref]");
    process.exitCode = 2;
    return;
  }

  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const paths = git(repoRoot, ["diff", "--name-only", `${baseRef}...${headRef}`])
    .split("\n")
    .filter(Boolean);

  if (!requiresVersionBump(paths)) {
    console.log("No native-affecting mobile files changed.");
    return;
  }

  const baseVersion = appVersionAt(repoRoot, baseRef);
  const headVersion = appVersionAt(repoRoot, headRef);
  const result = checkNativeVersionBump({ paths, baseVersion, headVersion });

  if (!result.valid) {
    console.error(
      `Native-affecting mobile files changed without bumping expo.version (${baseVersion}).`,
    );
    for (const path of result.nativePaths) console.error(`- ${path}`);
    console.error("Bump expo.version in apps/mobile/app.json before merging.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Native mobile change is paired with expo.version ${baseVersion} -> ${headVersion}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
