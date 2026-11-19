import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { englishBeatImports } from './musicBeatI18n.mjs';
const require = createRequire(import.meta.url);
export function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); }
  else if (node?.props) { yield node; yield* elements(node.props.children); }
}
export function harness() {
  const slots = [], pending = [];
  let cursor = 0, dirty = true, render, tree;
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true; }];
    },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || !deps || deps.some((d, n) => d !== old.deps?.[n])) {
        slots[i] = { deps, cleanup: old?.cleanup };
        pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    useCallback(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((d, n) => d !== old.deps[n])) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useId: () => 'beat-test',
  };
  react.useLayoutEffect = react.useEffect;
  function load(name, stubs = {}, extension = 'jsx') {
    const source = readFileSync(`app/veyrnox/_components/music/beat/${name}.${extension}`, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} }, imports = { ...englishBeatImports, react, './beatStyles': {}, ...stubs };
    new Function('require', 'module', 'exports', code)(id => imports[id] || require(id), module, module.exports);
    return module.exports;
  }
  return { load, get tree() { return tree; },
    render(fn = render) { render = fn; cursor = 0; dirty = false; tree = render(); return tree; },
    effects() { for (const effect of pending.splice(0)) effect(); },
    async settle() { for (let i = 0; i < 8; i++) { if (dirty) this.render(); this.effects(); await new Promise(resolve => setImmediate(resolve)); } },
    close() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
export const find = (tree, predicate) => [...elements(tree)].find(predicate);
export const button = (tree, text) => find(tree, node => node.type === 'button' && node.props.children === text);
