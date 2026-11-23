declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { join } = require('path') as { join(...parts: string[]): string };

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const repoSource = (path: string) => readFileSync(join(__dirname, '..', '..', '..', path), 'utf8');

describe('paywall UI wiring', () => {
    test('uses a dismissible prompt; the hard gate is wired but ships off (ADR-0108 amendment 2)', () => {
        const layout = source('src/app/(app)/_layout.tsx');
        const eas = source('eas.json');
        const prompt = source('src/components/PaywallPrompt.tsx');
        expect(layout).toContain('<PaywallPrompt />');
        expect(layout).toContain('<HardPaywallGate>');
        expect(eas).not.toMatch(/EXPO_PUBLIC_HARD_PAYWALL_ENABLED"\s*:\s*"true"/);
        expect(prompt).toContain('hardPaywallEnabled()');
        expect(source('src/components/paywall/PaywallSheet.tsx')).toContain('onRequestClose={close}');
        expect(prompt).toContain("if (operation.phase === 'store') return false");
        expect(source('src/components/paywall/PaywallSheet.tsx')).toContain('variant="tertiary" label={t(\'credits.paywall.allOptions\')}');
        expect(prompt).toContain("router.push('/credits')");
        expect(prompt).toContain("pathname === '/welcome'");
        expect(prompt).toContain("pathname?.startsWith('/credits')");
        expect(prompt).toContain('depletedKey(owner)');
        expect(prompt).toContain('SecureStore.deleteItemAsync(depletedKey(owner))');
        expect(source('src/components/paywall/PaywallSheet.tsx')).toContain('subscriptionsOpen && !billing.generationActive');
        expect(prompt).toContain("pathname?.startsWith('/legal/')");
    });

    test('QA-008: a failed offerings load can be retried from the provider', () => {
        const provider = source('src/billing/BillingProvider.tsx');
        expect(provider).toContain('retryOfferings');
        expect(provider).toContain('[beginSessionTask, offeringsLoad]');
    });

    test('credits screen includes subscriptions, current packs, restore and policy links', () => {
        const credits = source('src/app/(app)/credits.tsx');
        expect(credits).toContain('offerings?.all.generation');
        expect(credits).toContain('offerings?.all.credits');
        expect(credits).toContain('webParityPacks(toDisplayPackages(packPackages))');
        expect(credits).toContain('renewalTerms(');
        expect(credits).toContain("runPurchase({ kind: 'restore' })");
        expect(source('src/billing/storePurchaseStore.ts')).toContain('deps.billing.restore()');
        expect(credits).toContain('!billing.generationPurchaseReady');
        expect(credits).toContain('billing.refreshGenerationAccess()');
        expect(source('src/billing/storePurchaseStore.ts')).toContain('minimumIncrease: pack.expectedCredits, deadlineMs: Date.now() + 40_000');
        expect(credits).toContain('[billing.generationSource, billing.publishSource]');
        expect(credits).toContain('purchase.actions.manage');
        expect(credits).toContain('LEGAL_LINKS.slice(0, 2)');
    });

    test('generation checkout rechecks web entitlement and Restore requires account binding', () => {
        const provider = source('src/billing/BillingProvider.tsx');
        expect(provider).toContain('generationPurchaseReady = canPurchase && serverGenerationResolved && !generationEntitled');
        expect(provider).toContain('generationPlanFor(pkg.product.identifier) !== null && (generationActive || await refreshGenerationAccess(task))');
        expect(provider).toContain("if (!canRestore || bound.current?.gen !== task.gen) throw new Error('billing_not_ready')");
    });

    test('store catalog and owner checklist use the deployed web pack sizes', () => {
        const packMigration = repoSource('packages/db/schema/supabase/0541_store_packs_follow_new_plan_rate.sql');
        const migration = repoSource('packages/db/schema/supabase/0394_mobile_credit_pack_parity.sql');
        const checklist = repoSource('docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md');
        for (const size of [156, 392, 1177]) {
            expect(packMigration).toContain(`ai.veyrnox.credits.${size}`);
            expect(checklist).toContain(size === 156 ? '`ai.veyrnox.credits.156`' : `\`.${size}\``);
        }
        expect(checklist).not.toContain('`ai.veyrnox.credits.100`, `.270`, `.1200`, `.3000`');
        expect(migration).toContain('ai.veyrnox.generation.lite.monthly:monthly');
        expect(migration).toContain('ai.veyrnox.publish.annual:annual');
        expect(checklist).toContain('productId:basePlanId');
        expect(checklist).toContain('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
    });
});
