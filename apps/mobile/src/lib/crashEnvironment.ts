import type { AppEnv } from './config';

// A build running on a simulator or emulator is our own testing, never a customer's phone.
// It reports under its own environment so production alerts only fire for real devices.
export type CrashEnvironment = AppEnv | 'simulator';

export function crashEnvironment(appEnv: AppEnv, isDevice: boolean): CrashEnvironment {
    return isDevice ? appEnv : 'simulator';
}
