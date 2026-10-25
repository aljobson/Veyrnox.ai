#!/usr/bin/env node
import { spawn } from 'node:child_process';

const baseEnv = {
  ...process.env,
  EXPO_PUBLIC_DEV_API_BASE: 'http://localhost:8799',
  EXPO_PUBLIC_EDITOR_ENABLED: 'true',
  EXPO_PUBLIC_FULL_EDITOR_ENABLED: 'true',
};

const mock = spawn(process.execPath, ['dev/mock-server.mjs'], {
  env: baseEnv,
  stdio: 'inherit',
});
const metro = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '--', '--port', '8081'], {
  env: baseEnv,
  stdio: 'inherit',
});

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  mock.kill(signal);
  metro.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
mock.on('exit', (code) => {
  if (!stopping) {
    stop();
    process.exitCode = code ?? 1;
  }
});
metro.on('exit', (code) => {
  if (!stopping) {
    stop();
    process.exitCode = code ?? 1;
  }
});
