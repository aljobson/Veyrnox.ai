import { eventProperties, routePattern, safeProperties, sanitizeEnvelope } from '../src/lib/analytics/events';
declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const fixtures = require('./fixtures/analytics-properties.json');
test('mobile and website pin the same primitive-property fixture', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../app/lib/analyticsClient.js'), 'utf8');
    const website = new Function(`${source.slice(source.indexOf('function safeProperties('))}; return safeProperties;`)();
    for (const fixture of fixtures) {
        expect(safeProperties(fixture.input)).toEqual(fixture.output);
        expect(website(fixture.input)).toEqual(fixture.output);
    }
    expect(safeProperties({ text: 'a'.repeat(161), ['a'.repeat(65)]: true })).toEqual({});
});
test('application events reject unknown names, content and unbounded values', () => {
    expect(eventProperties('analytics_choice', { choice: 'denied' })).toBeNull();
    expect(eventProperties('$identify', {})).toBeNull();
    expect(eventProperties('generation_submitted', { kind: 'image', model_id: 'flux-1', prompt: 'private', email: 'person@example.com', url: 'https://private', invalid: [] })).toEqual({ kind: 'image', model_id: 'flux-1' });
    expect(eventProperties('generation_finished', { kind: 'private', outcome: 'secret error' })).toEqual({});
});
test('SDK envelope permits identity linking without person or URL properties', () => {
    expect(sanitizeEnvelope({ event: '$identify', $set: { email: 'private' }, properties: { distinct_id: 'user', $anon_distinct_id: 'anon', $set_once: { name: 'private' }, url: 'secret', $current_url: 'secret', $referrer: 'secret' } })).toEqual({ event: '$identify', properties: { distinct_id: 'user', $anon_distinct_id: 'anon' } });
    expect(sanitizeEnvelope({ event: '$autocapture', properties: {} })).toBeNull();
    expect(sanitizeEnvelope({ event: '$exception', properties: {} })).toBeNull();
    const pattern = routePattern(['(app)', 'job', '[id]']);
    expect(pattern).toBe('/(app)/job/[id]');
    expect(sanitizeEnvelope({ event: '$screen', properties: { $screen_name: pattern, url: 'private?id=123#secret' } })?.properties).toEqual({ $screen_name: pattern });
});
test('only analytics owns SDK imports, and sign-out does not clear device consent', () => {
    const root = path.join(__dirname, '../src');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: any) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    for (const file of walk(root).filter(f => /\.[jt]sx?$/.test(f))) {
        if (fs.readFileSync(file, 'utf8').includes('posthog-react-native')) expect(file).toContain('/lib/analytics/');
    }
    const auth = fs.readFileSync(path.join(root, 'auth/AuthProvider.tsx'), 'utf8');
    expect(auth).toContain('setAnalyticsUser(null)');
    expect(auth).toContain('setAnalyticsUser(userId)');
    expect(auth).not.toContain('CONSENT_KEY');
});
