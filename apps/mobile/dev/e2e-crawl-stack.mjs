#!/usr/bin/env node
import { spawn } from 'node:child_process';

const baseEnv = {
  ...process.env,
  EXPO_PUBLIC_DEV_API_BASE: 'http://localhost:8799',
  EXPO_PUBLIC_EDITOR_ENABLED: 'true',
  EXPO_PUBLIC_FULL_EDITOR_ENABLED: 'true',
  EXPO_PUBLIC_HARD_PAYWALL_ENABLED: 'false',
};

const children = [
  spawn(process.execPath, ['dev/mock-server.mjs'], {
    env: { ...baseEnv, MOCK_PORT: '8800' },
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['dev/fault-proxy.mjs'], {
    env: { ...baseEnv, PROXY_PORT: '8799', TARGET_PORT: '8800' },
    stdio: 'inherit',
  }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '--', '--port', '8081'], {
    env: baseEnv,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code ?? 1;
    }
  });
}
