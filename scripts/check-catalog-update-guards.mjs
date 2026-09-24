#!/usr/bin/env node
// A deliberately narrow SQL convention checker, not a general SQL parser.
// Applied migrations through 0110 are immutable; new direct catalog UPDATEs
// must immediately assert a positive, exact ROW_COUNT (see schema README).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIRST_GUARDED_MIGRATION = 111;

function tokens(sql, offset = 0) {
    const out = [];
    for (let i = 0; i < sql.length;) {
        const rest = sql.slice(i);
        let m;
        if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue; }
        if (rest.startsWith('--')) {
            const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; continue;
        }
        if (rest.startsWith('/*')) {
            let depth = 1; i += 2;
            while (i < sql.length && depth) {
                if (sql.startsWith('/*', i)) { depth++; i += 2; }
                else if (sql.startsWith('*/', i)) { depth--; i += 2; }
                else i++;
            }
            if (depth) throw new Error('unterminated block comment');
            continue;
        }
        if ((m = /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(rest))) {
            const start = i + m[0].length, end = sql.indexOf(m[0], start);
            if (end < 0) throw new Error('unterminated dollar-quoted body');
            // Inspect PL/pgSQL bodies, including nested DO/function definitions.
            // Dynamic SQL is outside this convention and must not be used for
            // catalog migrations; dollar bodies are inspected conservatively.
            out.push(...tokens(sql.slice(start, end), offset + start));
            i = end + m[0].length; continue;
        }
        if (rest[0] === "'" || rest[0] === '"') {
            const quote = rest[0], start = i++;
            let value = '', closed = false;
            while (i < sql.length) {
                if (sql[i] === quote) {
                    if (sql[i + 1] === quote) { value += quote; i += 2; continue; }
                    i++; closed = true; break;
                }
                // E'...' escape sequences cannot inject fake SQL tokens.
                if (quote === "'" && sql[i] === '\\') { value += sql.slice(i, i + 2); i += 2; }
                else value += sql[i++];
            }
            if (!closed) throw new Error('unterminated quoted value');
            out.push({ value: quote === '"' ? value : '<string>', at: offset + start });
            continue;
        }
        m = /^(?:[a-z_][a-z_0-9$]*|\d+|<>|!=|:=)/i.exec(rest);
        const value = m ? m[0] : rest[0];
        out.push({ value: value.toLowerCase(), at: offset + i });
        i += value.length;
    }
    return out;
}

export function checkCatalogUpdates(sql, filename) {
    const number = /^(\d{4})_.*\.sql$/.exec(filename);
    if (!number || Number(number[1]) < FIRST_GUARDED_MIGRATION) return [];
    let ts;
    try { ts = tokens(sql); } catch (err) { return [`${filename}: ${err.message}`]; }
    const errors = [];
    const values = ts.map((t) => t.value);
    for (let i = 0; i < ts.length; i++) {
        if (values[i] !== 'update') continue;
        let target = i + 1;
        if (values[target] === 'only') target++;
        if (values[target] === 'public' && values[target + 1] === '.') target += 2;
        if (values[target] !== 'model_catalog') continue;
        const end = values.indexOf(';', target);
        const tail = end < 0 ? '' : values.slice(end + 1).join(' ');
        // Require the same variable, a positive expected count, an unconditional
        // RAISE EXCEPTION on mismatch, and no intervening SQL to reset ROW_COUNT.
        const guard = /^get diagnostics ([a-z_][a-z_0-9$]*) (?:=|:=) row_count ; if \1 (?:<>|!=) [1-9]\d* then raise exception [^;]+ ; end if ;/;
        if (!guard.test(tail)) {
            const line = sql.slice(0, ts[i].at).split('\n').length;
            errors.push(`${filename}:${line}: catalog UPDATE needs an immediate exact ROW_COUNT assertion; see packages/db/schema/supabase/README.md`);
        }
    }
    return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../packages/db/schema/supabase');
    const errors = readdirSync(dir).sort().flatMap((name) =>
        name.endsWith('.sql') ? checkCatalogUpdates(readFileSync(join(dir, name), 'utf8'), name) : []);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('catalog UPDATE guards OK (new migrations from 0111)');
}
