import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// A dynamic route's file name ("create/[modelId]") is what the header shows when a screen returns early (loading or an
// error) before it sets its own title. The signed-in layout gives each one a static fallback title.
const root = join(__dirname, '../src/app/(app)');
const dynamicRoutes = (dir: string, prefix = ''): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return dynamicRoutes(path, `${prefix}${name}/`);
    return /\[.+\]\.tsx$/.test(name) ? [`${prefix}${name.replace(/\.tsx$/, '')}`] : [];
});
const layout = readFileSync(join(root, '_layout.tsx'), 'utf8');

test('every dynamic route under (app) has a static fallback title in the layout', () => {
    const routes = dynamicRoutes(root);
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(layout).toMatch(new RegExp(`<Stack.Screen name="${route.replace(/[\\[\]]/g, '\\$&')}" options=\\{\\{ title: t\\('[A-Za-z.]+'\\) \\}\\} />`));
});
