declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native Video Agent mirrors the website flow', () => {
    const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
    const screen = read('src', 'app', '(app)', 'create', 'agent.tsx');
    const montage = read('src', 'lib', 'montage.ts');
    const mock = read('dev', 'mock-server.mjs');

    test('keeps the same brief, plan, price and approval hierarchy', () => {
        expect(screen).toContain("t('videoAgent.title')");
        expect(screen).toContain('STEPS.map');
        expect(screen).toContain("t('videoAgent.narration')");
        expect(screen).toContain('requestPlan(api, brief, aspect, narration)');
        expect(screen).toContain('useBalance()');
        expect(screen).toContain("t('videoAgent.before')");
        expect(screen).toContain('minHeight: MIN_TARGET');
    });

    test('carries exact narration through both plan and approval', () => {
        expect(montage).toContain("{ narration_text: narration.text }");
        expect(montage).toContain("{ narration_text: plan.narrationText }");
    });

    test('the development backend can demonstrate the whole flow', () => {
        expect(mock).toContain("path === '/api/v1/montage/plan'");
        expect(mock).toContain("body.model_id === 'video-agent'");
        expect(mock).toContain('state.agentPlans.set');
    });
});
