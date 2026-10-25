declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { join } = require('path') as { join(...parts: string[]): string };

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const repoSource = (path: string) => readFileSync(join(__dirname, '..', '..', '..', path), 'utf8');

describe('paywall UI wiring', () => {
    test('uses a dismissible prompt instead of the production hard gate', () => {
        const layout = source('src/app/(app)/_layout.tsx');
        const eas = source('eas.json');
        const prompt = source('src/components/PaywallPrompt.tsx');
        expect(layout).toContain('<PaywallPrompt />');
        expect(layout).not.toContain('HardPaywallGate');
        expect(eas).not.toContain('EXPO_PUBLIC_HARD_PAYWALL_ENABLED');
        expect(prompt).toContain('onRequestClose={() => setOpenReason(null)}');
        expect(prompt).toContain("router.push('/credits')");
        expect(prompt).toContain("pathname === '/welcome'");
        expect(prompt).toContain("pathname?.startsWith('/credits')");
        expect(prompt).toContain('depletedKey(owner)');
        expect(prompt).toContain('SecureStore.deleteItemAsync(depletedKey(owner))');
        expect(prompt).toContain('subscriptionsOpen && !billing.paidAccess');
    });

    test('credits screen includes subscriptions, current packs, restore and policy links', () => {
        const credits = source('src/app/(app)/credits.tsx');
        expect(credits).toContain('offerings?.all.generation');
        expect(credits).toContain('offerings?.all.credits');
        expect(credits).toContain('filter(isWebParityPack)');
        expect(credits).toContain('renewalTerms(');
        expect(credits).toContain('billing.restore()');
        expect(credits).toContain('!billing.generationPurchaseReady');
        expect(credits).toContain('billing.refreshGenerationAccess()');
        expect(credits).toContain('{ minimumIncrease: expectedCredits }');
        expect(credits).toContain('LEGAL_LINKS.slice(0, 2)');
    });

    test('generation checkout rechecks web entitlement and Restore requires account binding', () => {
        const provider = source('src/billing/BillingProvider.tsx');
        expect(provider).toContain('generationPurchaseReady = canPurchase && serverGenerationResolved && !generationEntitled');
        expect(provider).toContain('generationPlanFor(pkg.product.identifier) !== null && (generationActive || await refreshGenerationAccess())');
        expect(provider).toContain("if (!canPurchase) throw new Error('billing_not_ready')");
    });

    test('store catalog and owner checklist use the deployed web pack sizes', () => {
        const migration = repoSource('packages/db/schema/supabase/0394_mobile_credit_pack_parity.sql');
        const checklist = repoSource('docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md');
        for (const size of [100, 300, 1000]) {
            expect(migration).toContain(`ai.veyrnox.credits.${size}`);
            expect(checklist).toContain(size === 100 ? '`ai.veyrnox.credits.100`' : `\`.${size}\``);
        }
        expect(checklist).not.toContain('`ai.veyrnox.credits.100`, `.270`, `.1200`, `.3000`');
        expect(migration).toContain('ai.veyrnox.generation.lite.monthly:monthly');
        expect(migration).toContain('ai.veyrnox.publish.annual:annual');
        expect(checklist).toContain('productId:basePlanId');
        expect(checklist).toContain('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
    });
});
