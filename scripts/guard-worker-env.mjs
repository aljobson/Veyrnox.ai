// Guard against baking repo-root .env secrets into the Worker bundle.
// `opennextjs-cloudflare build` reads a repo-root .env*/.env.local and inlines
// those values into the bundle and process.env. CI has no such files; the risk
// is a hand-run `build:worker` on a machine that does. Runs as prebuild:worker.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env.example is a safe, committed template — allow it.
const forbidden = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.staging.local',
];

const offenders = forbidden.filter((name) => existsSync(join(repoRoot, name)));

if (offenders.length > 0) {
    console.error(
        `Refusing to build the Worker: found ${offenders.join(', ')} in the repo root.\n` +
            'opennextjs-cloudflare bakes these into the bundle and process.env. ' +
            'Secrets belong in `wrangler secret put`, never a repo-root .env file.\n' +
            'Remove the file(s) above (keep .env.example) and run the build again.',
    );
    process.exit(1);
}
