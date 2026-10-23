declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { resolve } = require('path') as { resolve(...parts: string[]): string };

test('the native MCP surface exposes the production endpoint, setup steps and live grant controls', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/(app)/mcp.tsx'), 'utf8');
    expect(source).toContain("'https://veyrnox.ai/api/v1/mcp'");
    expect(source).toContain('<GrantsCard />');
    expect(source).toContain("router.push('/credits')");
    expect(source).toContain('Share.share');
});

test('theme switching uses dynamic iOS colours and skips the bundle reload there', () => {
    const source = readFileSync(resolve(__dirname, '../src/theme.ts'), 'utf8');
    expect(source).toContain('DynamicColorIOS');
    expect(source).toContain("if (platform() !== 'ios')");
    expect(source).toContain('THEME_RETURN_KEY');
});
