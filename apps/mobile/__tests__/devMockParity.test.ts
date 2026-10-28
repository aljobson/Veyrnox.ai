// The simulator mock is part of the mobile development contract: every shipped signed-in surface must be
// previewable without silently falling through to a 404 from an older route set.
declare const require: (id: string) => any;
declare const __dirname: string;

const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const path = require('path') as { join: (...parts: string[]) => string };
const source = fs.readFileSync(path.join(__dirname, '..', 'dev', 'mock-server.mjs'), 'utf8');

describe('development mock parity', () => {
    test.each([
        '/auth/v1/user',
        '/auth/v1/passkeys',
        '/auth/v1/user/oauth/grants',
        '/api/v1/checkin',
        '/api/v1/social/reports',
        '/api/v1/ledger',
        '/api/v1/ledger/usage',
        '/api/v1/top-ups',
        '/api/v1/uploads',
        '/api/v1/cinema/entitlement',
        '/api/v1/cinema/retention',
        '/api/v1/cinema/voting',
        '/api/v1/cinema/story-polls',
        '/api/v1/cinema/progress',
    ])('serves %s', (route) => {
        expect(source).toContain(route);
    });

    test('serves workspace brand kits and assets', () => {
        expect(source).toContain('brand-kit$/);');
        expect(source).toContain('brand-assets$/);');
    });

    test('accepts the raw upload target minted for generation sources', () => {
        expect(source).toContain("path.startsWith('/mock-upload/')");
    });

    test('starts with completed image and video assets for Library and Quick edit', () => {
        expect(source).toContain("kind: 'text-to-image'");
        expect(source).toContain("kind: 'text-to-video'");
        expect(source).toContain("created: Date.now() - 20_000");
    });
});

test('mock accounts reports viewer for the Agency brand', () => {
    const flags = source.match(/const publishDashboardFlags = [\s\S]*?\n\}\);/)![0];
    const branch = source.split('\n').find(line => line.includes("path === '/api/v1/social/accounts' && brandHeader === BRAND_VIEW"));
    expect(branch).toBeDefined();
    const respond = new Function('path', 'brandHeader', 'BRAND_VIEW', 'uploadsEnabled', 'send', 'res', `${flags}\n${branch}`);
    const send = jest.fn();
    respond('/api/v1/social/accounts', 'agency', 'agency', false, send, {});
    expect(send).toHaveBeenCalledWith({}, 200, expect.objectContaining({ brandRole: 'viewer', accounts: [] }));
    expect(source.indexOf(branch!)).toBeLessThan(source.indexOf("if (path === '/api/v1/social/accounts')"));
});
