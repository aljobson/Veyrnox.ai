import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/deploy-production.yml');
const config = read('next.config.mjs');

test('hashed Next assets receive a one-year immutable browser cache policy', () => {
    const headers = read('public/_headers');
    assert.match(headers, /\/_next\/static\/\*\n\s+Cache-Control: public, ?max-age=31536000, ?immutable/);
});

test('production builds use a validated GitHub commit as the Next deployment id', () => {
    assert.match(config, /const deploymentId = .*GITHUB_SHA/);
    assert.match(config, /deploymentId,/);
    assert.match(config, /\^\[a-fA-F0-9\].*\{40\}/);
});

test('the canonical About URL routes to the internal About page', () => {
    assert.match(config, /source: '\/veyrnox\/about', destination: '\/about', permanent: true/);
    assert.match(config, /source: '\/about', destination: '\/veyrnox\/about'/);
});

test('production rolls retained static assets forward across releases', () => {
    assert.match(workflow, /permissions:\n\s+actions: read\n\s+contents: read/);
    assert.match(workflow, /gh run list --workflow deploy-production\.yml --branch main --status success --limit 20/);
    assert.match(workflow, /for previous_run in \$previous_runs/);
    assert.match(workflow, /gh run download "\$previous_run" --name production-next-static/);
    assert.match(workflow, /node scripts\/retain-next-static\.mjs "previous-next-static\/\$previous_run" \.open-next\/assets\/_next\/static/);
    assert.match(workflow, /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
    assert.match(workflow, /name: production-next-static/);
    assert.match(workflow, /path: \.next\/static/);
    assert.match(workflow, /retention-days: 90/);
    assert.match(workflow, /at most 21 releases/);
});

test('production captures old references and validates them with the new references after deploy', () => {
    const captureAt = workflow.indexOf('node scripts/check-site-health.mjs --capture-assets previous-build-assets.json');
    const deployAt = workflow.indexOf('- name: Deploy');
    const verifyAt = workflow.indexOf('node scripts/check-site-health.mjs --asset-manifest previous-build-assets.json');
    assert.ok(captureAt !== -1 && captureAt < deployAt, 'old asset references are captured before deploy');
    assert.ok(verifyAt > deployAt, 'old and current references are checked after deploy');
    assert.doesNotMatch(workflow, /preview_urls:\s*true|workers_dev:\s*true/);
});
