#!/usr/bin/env node
// Keeps the iOS simulator build number equal to the current TestFlight/production one.
//   node scripts/simulator-build-number.mjs number   print the production build number (read only)
//   node scripts/simulator-build-number.mjs sync     store it as the EAS variable app.config.js reads
//   node scripts/simulator-build-number.mjs build    sync, then start a production-simulator EAS build
//   node scripts/simulator-build-number.mjs verify [udid]   compare the installed app with production
// Nothing here runs a production build or raises the production counter.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BUNDLE_ID = 'ai.veyrnox.app';
export const VARIABLE = 'VEYRNOX_SIMULATOR_BUILD_NUMBER';
const DEFAULT_UDID = 'booted';
// Pinned so a newly published eas-cli cannot run unreviewed in a build script; bump deliberately.
export const EAS_CLI = 'eas-cli@27.10.0';

export function parseBuildNumber(output) {
    const match = /buildNumber\s*-\s*([1-9][0-9]{0,8})\b/.exec(String(output));
    if (!match) throw new Error(`Could not read the build number from: ${String(output).trim().slice(-200)}`);
    return match[1];
}

export function describeMatch(installed, production) {
    return installed === production
        ? `OK: installed CFBundleVersion ${installed} matches production ${production}`
        : `MISMATCH: installed CFBundleVersion ${installed}, production ${production}`;
}

function eas(args, options = {}) {
    return spawnSync('npx', ['-y', EAS_CLI, ...args], { encoding: 'utf8', ...options });
}

export function productionBuildNumber() {
    const r = eas(['build:version:get', '-p', 'ios', '--profile', 'production', '--non-interactive']);
    if (r.status !== 0) throw new Error(`eas build:version:get failed:\n${r.stderr || r.stdout}`);
    return parseBuildNumber(r.stdout);
}

function simctl(args) {
    const r = spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`simctl ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout.trim();
}

export function installedBuildNumber(udid = DEFAULT_UDID) {
    const container = simctl(['get_app_container', udid, BUNDLE_ID]);
    const plist = `${container}/Info.plist`;
    const read = (key) => {
        const r = spawnSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`plutil could not read ${key} from ${plist}`);
        return r.stdout.trim();
    };
    return { version: read('CFBundleShortVersionString'), build: read('CFBundleVersion') };
}

function sync() {
    const n = productionBuildNumber();
    const r = eas(['env:set', 'production', '--name', VARIABLE, '--value', n, '--visibility', 'plaintext', '--non-interactive'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`eas env:set failed (status ${r.status})`);
    console.log(`${VARIABLE}=${n} stored for the production-simulator profile.`);
    return n;
}

function main([command, arg]) {
    if (command === 'number') return console.log(productionBuildNumber());
    if (command === 'sync') return void sync();
    if (command === 'build') {
        const n = sync();
        console.log(`Starting production-simulator build; it should report build number ${n}.`);
        const r = eas(['build', '-p', 'ios', '--profile', 'production-simulator', '--non-interactive'], { stdio: 'inherit' });
        process.exit(r.status ?? 1);
    }
    if (command === 'verify') {
        const production = productionBuildNumber();
        const installed = installedBuildNumber(arg);
        const line = describeMatch(installed.build, production);
        console.log(`${BUNDLE_ID} ${installed.version} (${installed.build})\n${line}`);
        process.exit(installed.build === production ? 0 : 1);
    }
    console.error('Usage: simulator-build-number.mjs number | sync | build | verify [udid]');
    process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
