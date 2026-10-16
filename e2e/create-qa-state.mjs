// Staging only: e2e/env.mjs enforces the production refusal.
import { chromium } from '@playwright/test';
import { BASE_URL, HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';
import { chmod } from 'node:fs/promises';

if (!HAS_ACCOUNT) throw new Error('Page QA requires confirmed staging E2E_EMAIL and E2E_PASSWORD');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ baseURL: BASE_URL });
  await signedIn(page);
  const accountResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/account');
  await page.goto('/app/account');
  if (!(await accountResponse).ok()) throw new Error('Page QA staging account failed its account read');
  const cookies = await page.context().cookies();
  if (!cookies.some(({ name, httpOnly }) => name === '__Host-veyrnox_refresh' && httpOnly)) {
    throw new Error('Page QA requires the deployed HttpOnly refresh-session flow');
  }
  const output = process.env.QA_STORAGE_STATE || '.scratch/qa-session.json';
  await page.context().storageState({ path: output });
  await chmod(output, 0o600);
} finally { await browser.close(); }
