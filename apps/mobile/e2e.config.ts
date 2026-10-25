import { mobile } from '@e2e-dev/mobile';
import type { E2EConfig } from 'e2e';

const iphone = mobile({
  platform: 'ios',
  device: 'iPhone 17 Pro',
});

export default {
  tests: 'tests/**/*.e2e.ts',
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
          args: ['dev/e2e-stack.mjs'],
          log: '.e2e/logs/stack.log',
          reuseExisting: true,
          startupTimeout: 120_000,
        },
        readyUrl: 'http://localhost:8081/status',
        environment: 'test',
      },
    },
  ],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  launchTimeout: 120_000,
  actionTimeout: 15_000,
  assertionTimeout: 15_000,
  trace: 'retain-on-failure',
  video: 'retain-on-failure',
} satisfies E2EConfig;
