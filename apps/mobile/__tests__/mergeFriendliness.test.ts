export {};
declare const require: (name: string) => any;
declare const __dirname: string;
const { execFileSync, spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join, dirname } = require('path');
const root = join(__dirname, '..');
const probe = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10000 });
const available = probe.status === 0;
if (!available) console.warn(`SKIP merge-friendliness: git unavailable (sandbox launcher included): ${probe.error?.message ?? probe.stderr ?? probe.status}`);
const gitTest = available ? test : test.skip;

function scenario(run: (dir: string, git: (...args: string[]) => string, write: (path: string, text: string) => void) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'mobile-merge-'));
    // Isolate hooks, signing, rerere, merge drivers and user Git configuration.
    const env = { ...require('process').env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const write = (path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
    try {
        git('init', '-b', 'main');
        git('config', 'user.name', 'Merge proof'); git('config', 'user.email', 'merge-proof@example.invalid');
        git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');
        write('docs/adr/README.md', '# Frozen historical index\n');
        write('src/lib/i18n/messages/en/_order.ts', 'export default [] as const;\n');
        write('src/lib/i18n/messages/en/alpha.ts', "export default {\n    'alpha.old': 'Old alpha',\n} as const;\n");
        write('src/lib/i18n/messages/en/beta.ts', "export default {\n    'beta.old': 'Old beta',\n} as const;\n");
        mkdirSync(join(dir, 'scripts'));
        for (const name of ['gen-en-registry.mjs', 'sync-web-i18n.mjs', 'escape-cell.mjs']) copyFileSync(join(root, 'scripts', name), join(dir, 'scripts', name));
        registry(dir);
        git('add', '.'); git('commit', '-m', 'fixture');
        run(dir, git, write);
    } finally { rmSync(dir, { recursive: true, force: true }); }
}
function registry(dir: string) { execFileSync('node', ['scripts/gen-en-registry.mjs'], { cwd: dir }); }
function catalog(dir: string) {
    return JSON.parse(execFileSync('node', ['--input-type=module', '-e', "import { readEnglishCatalog } from './scripts/sync-web-i18n.mjs'; console.log(JSON.stringify(readEnglishCatalog()));"], { cwd: dir, encoding: 'utf8' }));
}
function branches(git: (...args: string[]) => string, left: () => void, right: () => void) {
    git('checkout', '-b', 'left'); left(); git('add', '.'); git('commit', '-m', 'left change');
    git('checkout', '-b', 'right', 'main'); right(); git('add', '.'); git('commit', '-m', 'right change');
    git('checkout', 'left');
}
const area = (name: string) => `src/lib/i18n/messages/en/${name}.ts`;

gitTest('consecutive new ADR numbers merge cleanly with both files and the frozen README intact', () => {
    scenario((dir, git, write) => {
        // Above every baseline number. Filename identity also permits amendments below this number.
        const numbers = require('fs').readdirSync(join(root, '../../docs/adr')).map((name: string) => Number(name.match(/^(\d+)-/)?.[1] ?? 0));
        const next = Math.max(...numbers) + 1;
        const names = [next, next + 1].map(number => `docs/adr/${String(number).padStart(4, '0')}-new-feature.md`);
        branches(git, () => write(names[0], '# First feature\nStatus: Proposed\n'), () => write(names[1], '# Second feature\nStatus: Proposed\n'));
        git('merge', '--no-edit', 'right');
        expect(readFileSync(join(dir, names[0]), 'utf8')).toContain('First feature');
        expect(readFileSync(join(dir, names[1]), 'utf8')).toContain('Second feature');
        expect(git('diff', 'main', '--', 'docs/adr/README.md')).toBe('');
    });
}, 60000);

gitTest('keys added to different existing areas merge cleanly and both survive', () => {
    scenario((dir, git, write) => {
        const add = (name: string) => write(area(name), readFileSync(join(dir, area(name)), 'utf8').replace('} as const;', `    '${name}.new': '${name} addition',\n} as const;`));
        branches(git, () => add('alpha'), () => add('beta'));
        git('merge', '--no-edit', 'right');
        expect(catalog(dir)).toMatchObject({ 'alpha.new': 'alpha addition', 'beta.new': 'beta addition' });
    });
}, 60000);

gitTest('same-area additions in the same end gap can conflict; no clean-merge promise', () => {
    scenario((dir, git, write) => {
        const add = (name: string) => write(area('alpha'), readFileSync(join(dir, area('alpha')), 'utf8').replace('} as const;', `    'alpha.${name}': '${name}',\n} as const;`));
        branches(git, () => add('left'), () => add('right'));
        expect(() => git('merge', '--no-edit', 'right')).toThrow();
        expect(git('diff', '--name-only', '--diff-filter=U').trim()).toBe(area('alpha'));
        const text = readFileSync(join(dir, area('alpha')), 'utf8');
        expect(text).toContain('alpha.left'); expect(text).toContain('alpha.right');
    });
}, 60000);

gitTest('new-area additions conflict only in the generated registry, which the generator resolves', () => {
    scenario((dir, git, write) => {
        const add = (name: string) => { write(area(name), `export default { '${name}.new': '${name} addition' } as const;\n`); registry(dir); };
        branches(git, () => add('gamma'), () => add('delta'));
        expect(() => git('merge', '--no-edit', 'right')).toThrow();
        expect(git('diff', '--name-only', '--diff-filter=U').trim()).toBe('src/lib/i18n/messages/en.ts');
        registry(dir);
        expect(readFileSync(join(dir, 'src/lib/i18n/messages/en.ts'), 'utf8')).not.toMatch(/<<<<<<<|=======|>>>>>>>/);
        git('add', 'src/lib/i18n/messages/en.ts'); git('commit', '-m', 'resolve by regenerating');
        expect(git('status', '--porcelain')).toBe('');
        execFileSync('node', ['scripts/gen-en-registry.mjs', '--check'], { cwd: dir });
        expect(catalog(dir)).toMatchObject({ 'gamma.new': 'gamma addition', 'delta.new': 'delta addition' });
    });
}, 60000);
