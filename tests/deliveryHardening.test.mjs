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
    assert.match(workflow, /gh run list --workflow deploy-production\.yml --branch main --status completed --limit 100/);
    assert.match(workflow,
        /\.jobs\[\] \| select\(\.name == "deploy" and \.conclusion == "success"\)[\s\S]*\.steps\[\] \| select\(\.name == "Deploy" and \.conclusion == "success"\)/,
        'history requires both a successful deploy job and an actual successful Deploy step');
    assert.match(workflow, /successful_deploy_runs\+=\("\$previous_run"\)/);
    assert.match(workflow, /retention_bootstrap_predecessor=12448acb867057589159f312cf0e7eabb28a3ff0/);
    assert.match(workflow, /latest successful production deployment has no retained static artifact; refusing an unprotected cutover/,
        'missing or expired baselines fail closed after the one approved bootstrap');
    assert.match(workflow, /for previous_run in "\$\{successful_deploy_runs\[@\]\}"/);
    assert.match(workflow, /max_retained_bytes=2147483648/);
    assert.match(workflow, /\[0\]\.size_in_bytes \/\/ empty/);
    assert.match(workflow, /gh run download "\$previous_run" --name production-next-static/);
    assert.match(workflow, /node scripts\/retain-next-static\.mjs "previous-next-static\/\$previous_run" \.open-next\/assets\/_next\/static/);
    assert.match(workflow, /uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
    assert.match(workflow, /name: production-next-static/);
    assert.match(workflow, /path: \.next\/static/);
    assert.match(workflow, /retention-days: 90/);
    assert.match(workflow, /at most 21 releases/);
});

test('production bootstraps retention once, then enforces old references on every later deploy', () => {
    const captureAt = workflow.indexOf('node scripts/check-site-health.mjs --capture-assets previous-build-assets.json');
    const deployAt = workflow.indexOf('- name: Deploy');
    const verifyAt = workflow.indexOf('node scripts/check-site-health.mjs --asset-manifest previous-build-assets.json');
    assert.ok(captureAt !== -1 && captureAt < deployAt, 'old asset references are captured before deploy');
    assert.match(workflow,
        /Record currently referenced production assets\n\s+if: .*steps\.retained_static\.outputs\.available == 'true'/,
        'old references are captured only when their complete build artifact was retained');
    assert.ok(verifyAt > deployAt, 'old and current references are checked after deploy');
    assert.match(workflow,
        /Smoke test the live site with retained assets[\s\S]*steps\.retained_static\.outputs\.available == 'true'[\s\S]*--asset-manifest previous-build-assets\.json/);
    assert.match(workflow,
        /Smoke test the first retention-enabled deploy[\s\S]*steps\.retained_static\.outputs\.available != 'true'[\s\S]*node scripts\/check-site-health\.mjs\n/);
    assert.match(workflow,
        /steps\.smoke_retained\.outcome == 'failure' \|\| steps\.smoke_first\.outcome == 'failure'/,
        'either strict smoke path can trigger rollback');
    assert.match(workflow, /node scripts\/check-site-health\.mjs --allow-nonimmutable-assets/,
        'rollback accepts the previous release cache policy while still checking asset availability');
    assert.doesNotMatch(workflow, /preview_urls:\s*true|workers_dev:\s*true/);
});

// 2026-10-19: the revert of a broken dependency bump could not deploy, because the step that records the live site's
// assets runs the health check against the live site, which was already returning 500. Deploying over an unhealthy site
// is now allowed, but only because the NEW build still gets the full strict smoke test and still rolls back.
test('an unhealthy live site no longer blocks a deploy, and the new build is still fully smoke tested', () => {
    const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'), workflow.indexOf('\n  report-failure:'));
    const stepText = (name) => {
        const at = deployJob.indexOf(`- name: ${name}`);
        assert.notEqual(at, -1, `no step named ${name}`);
        const next = deployJob.indexOf('\n      - ', at + 1);
        return deployJob.slice(at, next === -1 ? undefined : next);
    };
    const baseline = stepText('Record currently referenced production assets');
    assert.match(baseline, /\n        id: baseline\n/);
    assert.match(baseline, /if node scripts\/check-site-health\.mjs --capture-assets previous-build-assets\.json; then/,
        'the capture is a condition, so its failure no longer stops the job');
    assert.match(baseline, /echo "baseline=captured" >> "\$GITHUB_OUTPUT"/);
    assert.match(baseline, /echo "baseline=skipped" >> "\$GITHUB_OUTPUT"/);
    assert.match(baseline, /::warning::/, 'skipping the baseline is visible, never silent');
    assert.doesNotMatch(baseline, /continue-on-error/, 'the step handles the failure itself instead of ignoring every error');

    // Exactly one strict post-deploy smoke test runs for any baseline outcome.
    const retained = stepText('Smoke test the live site with retained assets');
    const first = stepText('Smoke test the first retention-enabled deploy');
    assert.match(retained, /steps\.retained_static\.outputs\.available == 'true' && steps\.baseline\.outputs\.baseline == 'captured'/,
        'old-asset enforcement runs only when a baseline exists');
    assert.match(first, /\(steps\.retained_static\.outputs\.available != 'true' \|\| steps\.baseline\.outputs\.baseline == 'skipped'\)/,
        'with no baseline the plain strict check runs instead');
    assert.match(first, /run: sleep 20 && node scripts\/check-site-health\.mjs\n/, 'the strict check keeps every page, asset and immutability rule');
    assert.doesNotMatch(first, /allow-nonimmutable-assets|continue-on-error/, 'the post-deploy check is not weakened');
    assert.doesNotMatch(retained, /continue-on-error/);

    // A failed post-deploy check still rolls back and still opens the deploy-failure issue.
    assert.match(workflow,
        /steps\.smoke_retained\.outcome == 'failure' \|\| steps\.smoke_first\.outcome == 'failure' \|\| steps\.secret_check\.outcome == 'failure'/);
    assert.match(workflow, /report-failure:\n    needs: \[ci-green, deploy\]\n    if: failure\(\)/);
});
