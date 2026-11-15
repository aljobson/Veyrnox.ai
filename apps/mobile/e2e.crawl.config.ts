import { mobile } from '@e2e-dev/mobile';
import type { E2EConfig } from 'e2e';

const iphone = mobile({
  platform: 'ios',
  device: 'iPhone 17 Pro',
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
          'http://localhost:8081',
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
        readyUrl: 'http://localhost:8081/status',
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
