import { expect } from '@playwright/test';

export async function settleStreamedPage(page) {
  // React Fizz removes S: segment containers after reveal; recheck this
  // runtime contract when upgrading React or Next.js.
  await expect.poll(
    () => page.locator('[id^="S:"]').count(),
    { message: 'Next.js streamed segments must be consumed after load', timeout: 10_000 },
  ).toBe(0);
}
