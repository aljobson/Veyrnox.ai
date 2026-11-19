// Shared byte contract for FilmCraft 0.20.1. Scan before decoding/parsing an object graph.
export const CURRENT_SCHEMA = 17;
export const MAX_SCHEMA = CURRENT_SCHEMA + 2;
export const PROJECT_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_STRING_BYTES = 1024 * 1024;
export const MAX_TOKENS = 1500000;
export const MAX_ENVELOPE_MEMBERS = 32; // a FilmCraft envelope has about five: format, schema_version, generator, project, view
const UTF8_CHUNK = 64 * 1024;
const fail = reason => { throw Object.assign(new Error(reason), { reason }); };
export function scanProProject(input) {
    try {
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
        if (!(bytes instanceof Uint8Array) || !bytes.length) fail('invalid_json');
        if (bytes.length > PROJECT_MAX_BYTES) fail('too_large');
        let i = 0, tokens = 0;
        const members = new Map();
        const token = () => { if (++tokens > MAX_TOKENS) fail('too_complex'); };
        const ws = () => { while ([32, 9, 10, 13].includes(bytes[i])) i++; };
        const string = () => {
            const start = i++;
            while (i < bytes.length) {
                if (i - start > MAX_STRING_BYTES) fail('too_complex');
                const c = bytes[i++];
                if (c === 34) return;
                if (c < 32) fail('invalid_json');
                if (c === 92) {
                    const e = bytes[i++];
                    if (e === 117) {
                        for (let n = 0; n < 4; n++) {
                            const h = bytes[i++];
                            if (!(h >= 48 && h <= 57 || h >= 65 && h <= 70 || h >= 97 && h <= 102)) fail('invalid_json');
                        }
                    } else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(e)) fail('invalid_json');
                }
            }
            fail('invalid_json');
        };
        const value = depth => {
            if (depth > 64) fail('too_deep');
            token();
            ws();
            const c = bytes[i];
            if (c === 34) { string(); return; }
            if (c === 123 || c === 91) {
                i++; ws();
                const close = c === 123 ? 125 : 93;
                if (bytes[i] === close) { token(); i++; return; }
                for (;;) {
                    let key;
                    if (c === 123) {
                        token();
                        if (bytes[i] !== 34) fail('invalid_json');
                        const start = i; string();
                        if (depth === 1) {
                            if (members.size >= MAX_ENVELOPE_MEMBERS) fail('too_complex'); // before decoding or storing this key
                            if (i - start > 1024) fail('too_complex');
                            key = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, i)));
                            if (members.has(key)) fail('invalid_json');
                        }
                        ws(); if (bytes[i++] !== 58) fail('invalid_json'); token(); ws();
                    }
                    const start = i;
                    value(depth + 1);
                    if (key !== undefined) members.set(key, [start, i]);
                    ws();
                    if (bytes[i] === close) { token(); i++; return; }
                    if (bytes[i++] !== 44) fail('invalid_json'); token(); ws();
                }
            }
            for (const literal of ['true', 'false', 'null']) {
                if (c === literal.charCodeAt(0)) {
                    for (const char of literal) if (bytes[i++] !== char.charCodeAt(0)) fail('invalid_json');
                    return;
                }
            }
            const digit = n => n >= 48 && n <= 57;
            if (bytes[i] === 45) i++;
            if (bytes[i] === 48) i++;
            else { if (!digit(bytes[i]) || bytes[i] === 48) fail('invalid_json'); while (digit(bytes[i])) i++; }
            if (bytes[i] === 46) { i++; if (!digit(bytes[i])) fail('invalid_json'); while (digit(bytes[i])) i++; }
            if (bytes[i] === 101 || bytes[i] === 69) {
                i++; if (bytes[i] === 43 || bytes[i] === 45) i++;
                if (!digit(bytes[i])) fail('invalid_json'); while (digit(bytes[i])) i++;
            }
        };
        ws(); if (bytes[i] !== 123) fail('invalid_shape');
        value(1); ws(); if (i !== bytes.length) fail('invalid_json');
        // No object graph is ever built: UTF-8 is validated in bounded chunks (output discarded) and
        // only the two tiny envelope members are parsed, from their recorded byte ranges.
        try {
            const utf8 = new TextDecoder('utf-8', { fatal: true });
            for (let at = 0; at < bytes.length; at += UTF8_CHUNK) utf8.decode(bytes.subarray(at, Math.min(at + UTF8_CHUNK, bytes.length)), { stream: true });
            utf8.decode();
        } catch { fail('invalid_utf8'); }
        const small = (name, limit, reason) => {
            const range = members.get(name);
            if (!range || range[1] - range[0] > limit) fail(reason);
            try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(range[0], range[1]))); } catch { return fail(reason); }
        };
        if (small('format', 64, 'invalid_format') !== 'filmcraft.project') fail('invalid_format');
        const schemaVersion = small('schema_version', 16, 'invalid_schema');
        if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > MAX_SCHEMA) fail('invalid_schema');
        const project = members.get('project');
        if (!project || bytes[project[0]] !== 123) fail('invalid_project'); // an object, by its first byte
        return { ok: true, schemaVersion, projectBytes: bytes.subarray(project[0], project[1]), projectRange: [...project] };
    } catch (error) { return { ok: false, reason: error.reason || 'invalid_json' }; }
}
