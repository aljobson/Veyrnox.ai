import { cleanWorkflowDraft, deleteWorkflow, draftOf, parseWorkflows, saveWorkflow, type WorkflowDraft } from '../src/lib/publishWorkflows';
import type { ApiClient } from '../src/lib/api';

const ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const draft: WorkflowDraft = { id: ID, accountId: null, name: ' Welcome ', kind: 'comment', matchMode: 'contains', keyword: ' hello ', replyText: ' Welcome aboard ', enabled: true };

function fakeApi() {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return { id: ID }; } } as unknown as ApiClient;
    return { api, calls };
}

describe('workflow drafts', () => {
    test('trims, and refuses what the route refuses', () => {
        expect(cleanWorkflowDraft(draft)).toMatchObject({ name: 'Welcome', keyword: 'hello', replyText: 'Welcome aboard' });
        expect(cleanWorkflowDraft({ ...draft, name: '  ' })).toBeNull();
        expect(cleanWorkflowDraft({ ...draft, keyword: 'k'.repeat(101) })).toBeNull();
        expect(cleanWorkflowDraft({ ...draft, replyText: 'r'.repeat(8001) })).toBeNull();
    });
    test('a saved workflow keeps its account when switched on or off', () => {
        const [w] = parseWorkflows({ workflows: [{ id: ID, name: 'Welcome', kind: 'comment', match_mode: 'exact', keyword: 'hi', reply_text: 'Hello', enabled: false, account_id: ACCOUNT }] });
        expect(draftOf(w)).toEqual({ id: ID, accountId: ACCOUNT, name: 'Welcome', kind: 'comment', matchMode: 'exact', keyword: 'hi', replyText: 'Hello', enabled: false });
        expect(draftOf({ ...w, enabled: true } as typeof w).enabled).toBe(true);
    });
});

describe('workflow writes', () => {
    test('save is a PUT of the whole workflow', async () => {
        const { api, calls } = fakeApi();
        await saveWorkflow(api, draft);
        expect(calls[0].path).toBe('/api/v1/social/workflows');
        expect(calls[0].init?.method).toBe('PUT');
        expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ id: ID, accountId: null, kind: 'comment', matchMode: 'contains', enabled: true });
    });
    test('delete names the workflow in the query', async () => {
        const { api, calls } = fakeApi();
        await deleteWorkflow(api, ID);
        expect(calls[0].path).toBe(`/api/v1/social/workflows?id=${ID}`);
        expect(calls[0].init?.method).toBe('DELETE');
    });
});
