// Like the neighbouring mobile wiring tests, guard the native surface without a native build.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');
const read = (file: string): string => readFileSync(join(__dirname, '..', 'src', file), 'utf8');

test('Publish has one Workflows entry and the destination has the plan and expandable details', () => {
    const menu = read('app/(app)/(tabs)/publish.tsx');
    expect(menu.match(/'\/publish\/workflows'/g)).toHaveLength(1);
    const screen = read('app/(app)/publish/workflows.tsx');
    expect(screen).toContain('fetchWorkflows');
    expect(screen).toContain('fetchWorkflowPlan');
    expect(screen).toContain('accessibilityState={{ expanded:');
    expect(screen).toContain('item.replyText');
    expect(screen).toContain('publishWorkflows.lastEdited');
    expect(screen).toContain('publishWorkflows.accountLimit');
    expect(screen).toContain('publishWorkflows.analyticsDays');
    expect(screen).toContain('publishWorkflows.bestTime');
    expect(screen).toContain('accessibilityRole="header"');
    expect(screen).toContain('touchTarget');
});

test('the new surface cannot purchase, send, toggle or open billing and has no custom motion', () => {
    const screen = read('app/(app)/publish/workflows.tsx');
    const client = read('lib/publishWorkflows.ts');
    expect(screen).not.toMatch(/UnlockCard|paywall|purchase|checkout|\/plan\/portal|Switch|TextInput|Animated|LayoutAnimation/);
    expect(client).not.toMatch(/method:\s*['"](?:POST|PATCH|PUT|DELETE)/);
    expect(screen).toContain('`${API_BASE}/app/publish/workflows`');
    expect(screen.match(/openBrowserAsync/g)).toHaveLength(1);
    expect(screen).toMatch(/<Text[^>]*>\{t\(managementKey\)\}<\/Text>/);
    expect(screen).not.toMatch(/last.run|never.run|\bseats\b|price_usd_cents/i);
});
