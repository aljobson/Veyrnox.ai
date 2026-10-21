import { t } from '../src/lib/i18n';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const EXPECTED: Record<string, string> = {
    'plan.navTitle': 'Publish Plan',
    'plan.headline': 'Publish more, everywhere',
    'plan.benefit.accounts': 'Up to five connected accounts',
    'plan.benefit.schedule': 'Schedule posts ahead',
    'plan.benefit.analytics': '366 days of analytics',
    'plan.benefit.bestTime': 'Best-time recommendations',
    'plan.checkFailed': 'We could not check your plan right now. Try again in a moment.',
    'plan.notOpen': 'Purchases are not open yet.',
    'plan.thanks': 'Thank you. Your Publish Plan is on.',
    'plan.notCompleted': 'That did not complete. You were not charged.',
    'plan.restored': 'Purchases restored.',
    'plan.restoreFailed': 'Could not restore purchases. Try again.',
    'plan.menu.accounts': 'Connected accounts',
    'plan.menu.posts': 'Posts',
    'plan.menu.bestTime': 'Best time',
    'plan.terms': 'Terms',
    'plan.privacy': 'Privacy',
    'unlock.plan.week': 'Weekly',
    'unlock.plan.month': 'Monthly',
    'unlock.plan.year': 'Annual',
    'unlock.subscribe': 'Subscribe',
    'account.restore': 'Restore purchases',
    'analytics.title': 'Analytics',
    'calendar.title': 'Calendar',
    'drafts.title': 'Drafts',
    'approvals.title': 'Approvals',
    'brands.title': 'Brand',
    'commerce.title': 'Products',
    'ads.title': 'Ads',
    'reports.title': 'Reports',
    'inbox.title': 'Inbox',
    'contacts.title': 'Contacts',
};

const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/(tabs)/publish.tsx'), 'utf8');

describe('Publish tab copy', () => {
    test.each(Object.entries(EXPECTED))('%s keeps its English wording', (key, text) => {
        expect(t(key)).toBe(text);
    });

    test('the screen has no hard-coded English labels left', () => {
        for (const text of Object.values(EXPECTED)) {
            expect(source).not.toContain(`'${text}'`);
            expect(source).not.toContain(`>${text}<`);
        }
    });

    test('every key it uses resolves to text', () => {
        const used = [...source.matchAll(/'((?:plan|unlock|account|analytics|calendar|drafts|approvals|brands|commerce|ads|reports|inbox|contacts)\.[A-Za-z.]+)'/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(20);
        for (const key of used) expect(t(key)).not.toBe(key);
    });
});
