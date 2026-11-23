import { mobile } from '@e2e-dev/mobile';
import type { E2EConfig } from 'e2e';

const e2eDevice = process.env.E2E_DEVICE ?? 'iPhone 17 Pro';
const iphone = mobile({ platform: 'ios', device: e2eDevice });

export default {
  tests: 'tests/**/*.paywall.ts',
  targets: [
    {
      name: 'ios-hard-paywall',
      engine: iphone,
      app: {
        bundleId: 'ai.veyrnox.app',
        launchArguments: [
          '--initialUrl',
          'http://localhost:8084',
          '-EXDevMenuShowsAtLaunch',
          'NO',
          '-EXDevMenuIsOnboardingFinished',
          'YES',
          '-EXDevMenuShowFloatingActionButton',
          'NO',
        ],
        command: {
          executable: 'node',
          args: ['dev/e2e-hard-paywall-stack.mjs'],
          log: '.e2e/logs/hard-paywall-stack.log',
          reuseExisting: false,
          startupTimeout: 120_000,
        },
        readyUrl: 'http://localhost:8084/status',
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
