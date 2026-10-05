/**
 * A small, safe markdown reader for chat replies (ADR-0067). Pure: text in, plain data out.
 *
 * Model output is untrusted and this repo forbids raw-markup escape hatches, so the result is never HTML:
 * the page turns these blocks into React elements, and every piece of text stays a text node. Supported:
 * paragraphs, headings (shown as bold lines), bullet and numbered lists, fenced code, `inline code`, **bold**.
 * Links are supported only as `[text](address)` with a plain http(s) address, no embedded credentials and no
 * spaces; they come back as link nodes whose address is normalised by URL. Not supported on purpose: images, tables,
 * raw HTML, and any other address scheme. Those are shown as the text the model wrote.
 *
 * An unclosed fence is code until the end, so a reply that is still streaming looks right.
 */

const FENCE = /^\s*```\s*([A-Za-z0-9_+.-]{0,20})\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

const LINK = /(!?\[[^\]\n]{1,200}\]\([^\s()]{1,2000}\))/;
const LINK_PARTS = /^\[([^\]\n]{1,200})\]\(([^\s()]{1,2000})\)$/;

/** The normalised address of a plain http(s) link, or null: no other scheme, no credentials, must parse. */
function safeHref(raw) {
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
        const u = new URL(raw);
        return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && u.hostname ? u.href : null;
    } catch { return null; }
}

/** @returns {{t:'text'|'code'|'strong'|'link', v:string, href?:string}[]} */
export function parseInline(text) {
    const out = [];
    const push = (t, v, extra) => {
        if (!v) return;
        // Neighbouring text is one node, so a piece that was only split to look for links comes back whole.
        if (t === 'text' && out.length && out[out.length - 1].t === 'text') out[out.length - 1].v += v;
        else out.push({ t, v, ...extra });
    };
    text.split(/(`[^`\n]+`)/).forEach((chunk) => {
        if (/^`[^`\n]+`$/.test(chunk)) { push('code', chunk.slice(1, -1)); return; }
        chunk.split(/(\*\*[^*\n]+\*\*)/).forEach((piece) => {
            if (/^\*\*[^*\n]+\*\*$/.test(piece)) { push('strong', piece.slice(2, -2)); return; }
            piece.split(LINK).forEach((part) => {
                const m = !part.startsWith('!') && LINK_PARTS.exec(part);
                const href = m ? safeHref(m[2]) : null;
                if (m && href && m[1].trim()) push('link', m[1], { href });
                else push('text', part);
            });
        });
    });
    return out;
}

/**
 * @param {string} src
 * @returns {({type:'p'|'h', inline:object[]}|{type:'ul'|'ol', items:object[][]}|{type:'code', lang:string, text:string})[]}
 */
export function parseMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let para = [];
    const flush = () => { if (para.length) { blocks.push({ type: 'p', inline: parseInline(para.join('\n')) }); para = []; } };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            flush();
            const body = [];
            i++;
            while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
            blocks.push({ type: 'code', lang: fence[1], text: body.join('\n') });
            continue;
        }
        const list = BULLET.exec(line) ? 'ul' : NUMBERED.exec(line) ? 'ol' : null;
        if (list) {
            flush();
            const items = [];
            const re = list === 'ul' ? BULLET : NUMBERED;
            while (i < lines.length && re.exec(lines[i])) items.push(parseInline(re.exec(lines[i++])[1]));
            i--;
            blocks.push({ type: list, items });
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) { flush(); blocks.push({ type: 'h', inline: parseInline(heading[1]) }); continue; }
        if (!line.trim()) { flush(); continue; }
        para.push(line);
    }
    flush();
    return blocks;
}
