import { readFileSync } from 'node:fs';
import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

// Route sweep: opens every static screen by deep link against the disposable mock account, takes a screenshot, and
// fails on a crash, an unmatched route or a generic error screen. It never taps controls or initiates paid actions;
// a route may still run its documented mock-only mount effects (for example, beats/new creates a seed project).
const routes: string[] = JSON.parse(readFileSync(new URL('./crawl-routes.json', import.meta.url), 'utf8'));
const CHUNK_SIZE = 12;
const CHUNKS: string[][] = Array.from({ length: Math.ceil(routes.length / CHUNK_SIZE) }, (_, index) =>
  routes.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));

const BAD = ['Unmatched Route', 'Something went wrong', 'Uncaught Error', 'This screen doesn\u2019t exist', "This screen doesn't exist"];

CHUNKS.forEach((routes, index) => {
  test(`route sweep ${index + 1}/${CHUNKS.length}: ${routes[0]} .. ${routes[routes.length - 1]}`, { tags: ['sweep'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);
    const failures: string[] = [];
    for (const route of routes) {
      await device.openLink(`ai.veyrnox.app://${route}`);
      await new Promise(resolve => setTimeout(resolve, 1_500));
      for (const text of BAD) {
        if (await screen.getByText(text).isVisible()) failures.push(`${route}: shows "${text}"`);
      }
      await app.screenshot(`sweep-${route.replace(/\//g, '_')}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
