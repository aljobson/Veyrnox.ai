import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export const readEditorSource = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
export function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
// Hook harness following editorServerRenderComponents: real component bodies/effects,
// deterministic mocked transport/timers. No DOM, browser or provider claims.
export function hookHarness() {
    let cursor = 0, stateIndex = 0, changed = false;
    const slots = [], effects = [], states = [], timers = new Map();
    let timerId = 0;
    const hooks = {
        useState(initial) {
            const index = cursor++, at = stateIndex++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            const set = value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) changed = true; slots[index] = next; };
            states[at] = set;
            return [slots[index], set];
        },
        useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
        useRef(current) { const index = cursor++; return slots[index] ||= { current }; },
        useMemo(fn, deps) {
            const index = cursor++, prev = slots[index];
            if (!prev || !deps || deps.some((v, i) => !Object.is(v, prev.deps?.[i]))) slots[index] = { deps, value: fn() };
            return slots[index].value;
        },
        useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
        useEffect(fn, deps) {
            const index = cursor++, prev = slots[index];
            if (!prev || !deps || deps.some((v, i) => !Object.is(v, prev.deps?.[i]))) {
                prev?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = fn(); });
            }
        },
    };
    return {
        states, timers,
        load(file, mocks = {}, expose = []) {
            const exports = {};
            const code = ts.transpileModule(readEditorSource(file) + (expose.length ? `\nexport { ${expose.join(', ')} };` : ''), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
            const imports = { react: hooks, ...mocks };
            new Function('require', 'exports', 'window', 'setInterval', 'clearInterval', code)(id => id === 'react/jsx-runtime' ? require(id) : imports[id] || {}, exports,
                { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
            return exports;
        },
        render(Component, props) {
            let tree, rounds = 0;
            do { changed = false; cursor = 0; stateIndex = 0; tree = Component(props); } while (changed && ++rounds < 10);
            while (effects.length) effects.shift()();
            return tree;
        },
        async tick() { for (const fn of [...timers.values()]) await fn(); },
        dispose() { for (const slot of slots) slot?.cleanup?.(); },
    };
}
