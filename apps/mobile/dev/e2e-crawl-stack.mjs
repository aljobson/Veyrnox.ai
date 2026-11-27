#!/usr/bin/env node
import { spawn } from 'node:child_process';

// Keep the exhaustive crawl isolated from the owner's canonical 8081/8799
// development stack even when no explicit ports are supplied.
const metroPort = process.env.E2E_METRO_PORT || '8084';
const proxyPort = process.env.E2E_PROXY_PORT || '8803';
const mockPort = process.env.E2E_MOCK_PORT || '8802';
const baseEnv = {
  ...process.env,
  EXPO_PUBLIC_DEV_API_BASE: `http://localhost:${proxyPort}`,
  EXPO_PUBLIC_EDITOR_ENABLED: 'true',
  EXPO_PUBLIC_FULL_EDITOR_ENABLED: 'true',
  EXPO_PUBLIC_HARD_PAYWALL_ENABLED: 'false',
};

const children = [
  spawn(process.execPath, ['dev/mock-server.mjs'], {
    env: { ...baseEnv, MOCK_PORT: mockPort },
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['dev/fault-proxy.mjs'], {
    env: { ...baseEnv, PROXY_PORT: proxyPort, TARGET_PORT: mockPort },
    stdio: 'inherit',
  }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '--', '--port', metroPort], {
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
