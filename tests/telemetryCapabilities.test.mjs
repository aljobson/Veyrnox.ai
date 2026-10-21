import test from 'node:test';
import assert from 'node:assert/strict';
import { pathOnlyUrl, replayAllowedOnPath, sanitisePostHogEvent } from '../app/lib/analyticsPrivacy.js';
import { scrubEvent } from '../lib/sentryScrub.js';
import { capabilityPath, scrubTelemetryTree, scrubTelemetryUrl, telemetryPath, unlocalizedTelemetryPath } from '../lib/telemetryUrl.js';

const locales = ['', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi'];
const paths = ['social/review', 'social/team/invite', 'media/social', 'api/social/approvals', 'api/social/team'];
test('SDK Date timestamps survive redaction as independent Date copies', () => {
  const timestamp = new Date('2026-10-21T12:34:56.789Z');
  const event = { timestamp, properties: { nested: { receivedAt: timestamp }, $pathname: '/social/review/SYNTHETIC_BEARER' } };
  const clean = sanitisePostHogEvent(event);
  const sentry = scrubEvent({ timestamp, breadcrumbs: [{ category: 'fetch', timestamp }] });
  for (const date of [clean.timestamp, clean.properties.nested.receivedAt, sentry.timestamp, sentry.breadcrumbs[0].timestamp]) {
    assert.ok(date instanceof Date);
    assert.equal(date.getTime(), timestamp.getTime());
    assert.notEqual(date, timestamp);
  }
  assert.equal(JSON.parse(JSON.stringify(clean)).timestamp, '2026-10-21T12:34:56.789Z');
  clean.timestamp.setUTCFullYear(2000);
  assert.equal(timestamp.toISOString(), '2026-10-21T12:34:56.789Z');
  assert.equal(event.properties.$pathname, '/social/review/SYNTHETIC_BEARER');
});
test('shared telemetry boundary tolerates malformed URLs, primitive values and circular SDK structures', () => {
  assert.equal(scrubTelemetryUrl(null), null);
  assert.equal(scrubTelemetryUrl('/models/%invalid?private=x'), '/models/%invalid');
  assert.equal(telemetryPath(null), '/');
  assert.equal(telemetryPath('pricing'), '/pricing');
  assert.equal(unlocalizedTelemetryPath('/ja'), '/');
  assert.equal(capabilityPath('/social/review'), true);
  const tree = { count: 3, text: 'ordinary SDK metadata', absent: null };
  tree.circular = tree;
  assert.deepEqual(scrubTelemetryTree(tree), { count: 3, text: 'ordinary SDK metadata', absent: null, circular: '[Circular]' });
});
test('separator variants cannot bypass capability redaction', () => {
  for (const value of ['https://veyrnox.ai/social//review/SYNTHETIC_BEARER', '/social\\review\\SYNTHETIC_BEARER', '/social/%2Freview/SYNTHETIC_BEARER', '/social/review//SYNTHETIC_BEARER', '/social/./review/SYNTHETIC_BEARER', '/social/x/../review/SYNTHETIC_BEARER', '/social/%2e/review/SYNTHETIC_BEARER', '/social%2Freview/SYNTHETIC_BEARER%invalid', '/social/review/%20SYNTHETIC_BEARER']) {
    assert.ok(!pathOnlyUrl(value).includes('SYNTHETIC_BEARER'), value);
    assert.equal(replayAllowedOnPath(value.replace('https://veyrnox.ai', '')), false, value);
  }
});
test('all localized capability URLs lose the bearer path, query and fragment', () => {
  for (const locale of locales) for (const route of paths) {
    const path = `/${locale ? `${locale}/` : ''}${route}/SYNTHETIC_BEARER`;
    for (const value of [path, path.replaceAll('/', '%2F'), encodeURIComponent(encodeURIComponent(path))]) {
      assert.ok(!pathOnlyUrl(`${value}?secret=x#secret`).includes('SYNTHETIC_BEARER'), value);
      assert.equal(replayAllowedOnPath(value), false, value);
    }
  }
});

test('PostHog sanitizes pathname and nested SDK URL and frame fields without changing input', () => {
  const url = 'https://veyrnox.ai/fr/social/review/SYNTHETIC_BEARER?secret=x#hash';
  const event = { properties: { $pathname: '/social/review/SYNTHETIC_BEARER', $current_url: url,
    $exception_list: [{ value: 'private text', stacktrace: { frames: [{ filename: url, abs_path: url, vars: { private: true } }] } }],
    $exception_person: { sdk: { request: { url } } }, custom: { from: url, to: '/media/social/SYNTHETIC_BEARER' } } };
  const original = structuredClone(event);
  const clean = sanitisePostHogEvent(event);
  assert.ok(!JSON.stringify(clean).includes('SYNTHETIC_BEARER'));
  assert.ok(!JSON.stringify(clean).includes('?secret='));
  assert.deepEqual(event, original);
  assert.equal(clean.properties.$exception_list[0].value, 'Browser error');
});

test('Sentry removes capabilities across request, breadcrumb, tag, transaction and exception frames', () => {
  const url = 'https://veyrnox.ai/api/social/approvals/SYNTHETIC_BEARER?secret=x';
  const event = { request: { url }, tags: { url }, transaction: 'GET /social/review/SYNTHETIC_BEARER',
    breadcrumbs: [{ category: 'fetch', data: { url, nested: { from: url } } }],
    exception: { values: [{ value: 'secret', stacktrace: { frames: [{ filename: url, vars: { token: 'SYNTHETIC_BEARER' }, context_line: 'secret' }] } }] } };
  const original = structuredClone(event);
  const clean = scrubEvent(event);
  assert.ok(!JSON.stringify(clean).includes('SYNTHETIC_BEARER'));
  assert.ok(!JSON.stringify(clean).includes('?secret='));
  assert.equal(clean.exception.values[0].stacktrace.frames[0].vars, undefined);
  assert.deepEqual(event, original);
});
