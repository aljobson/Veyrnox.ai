// Parsing and matching of the generated `_headers` rules. Shared by the local dev server and the
// serving Worker so both apply exactly the headers the build produced.

export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) { current = { path: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    if (current && i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

function matches(pattern, path) {
  if (!pattern.includes('*')) return pattern === path;
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(path);
}

/** Merged headers of every rule that matches `path` (later rules win). */
export function headersFor(rules, path) {
  const out = {};
  for (const rule of rules) if (matches(rule.path, path)) Object.assign(out, rule.headers);
  return out;
}
