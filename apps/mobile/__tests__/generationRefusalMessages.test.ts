import { ApiError } from '../src/lib/api';
import { generationMessage } from '../src/lib/generationSubmit';
import messages from '../src/lib/i18n/messages/en/app';
import { CATALOGS } from '../src/lib/i18n';
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-idempotency' }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => undefined, hasAgreed: async () => true } }));
const codes = ['source_count_exceeded','sources_too_large','source_size_unknown','references_invalid','references_ambiguous','body_too_large','idempotency_conflict'] as const;
test.each(codes)('%s gives a specific actionable generation message', code => {
    const key = `app.create.error.${code}` as const;
    expect(generationMessage(new ApiError(code === 'idempotency_conflict' ? 409 : 400, code))).toBe(messages[key]);
    expect(messages[key]).toMatch(/Remove|Reattach|Clear|Shorten|Open Library/);
    for (const catalog of Object.values(CATALOGS)) expect(catalog[key]).toBeTruthy();
});
