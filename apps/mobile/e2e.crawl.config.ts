import { mobile } from '@e2e-dev/mobile';
import type { E2EConfig } from 'e2e';

const e2eDevice = process.env.E2E_DEVICE ?? 'iPhone 17 Pro';
const metroPort = process.env.E2E_METRO_PORT ?? '8084';

const iphone = mobile({
  platform: 'ios',
  device: e2eDevice,
});

export default {
  // Keep the exhaustive crawl suites opt-in. The normal E2E configuration
  // deliberately matches only *.e2e.ts and must stay fast enough for CI.
  tests: 'tests/**/*.crawl.ts',
  targets: [
    {
      name: 'ios-simulator',
      engine: iphone,
      app: {
        bundleId: 'ai.veyrnox.app',
        launchArguments: [
          '--initialUrl',
          `http://localhost:${metroPort}`,
          '-EXDevMenuShowsAtLaunch',
          'NO',
          '-EXDevMenuIsOnboardingFinished',
          'YES',
          '-EXDevMenuShowFloatingActionButton',
          'NO',
        ],
        command: {
          executable: 'node',
          args: ['dev/e2e-crawl-stack.mjs'],
          log: '.e2e/logs/crawl-stack.log',
          // A regular E2E stack on the same Metro port does not include the
          // fault proxy. Reusing it would make the fault suites false-pass.
          reuseExisting: false,
          startupTimeout: 120_000,
        },
        readyUrl: `http://localhost:${metroPort}/status`,
        environment: 'test',
      },
    },
  ],
  workers: 1,
  retries: 0,
  timeout: 400_000,
  launchTimeout: 120_000,
  actionTimeout: 15_000,
  assertionTimeout: 15_000,
  trace: 'retain-on-failure',
  video: 'off',
} satisfies E2EConfig;
