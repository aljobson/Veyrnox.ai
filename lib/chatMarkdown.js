/**
 * A small, safe markdown reader for chat replies (ADR-0067). Pure: text in, plain data out.
 *
 * Model output is untrusted and this repo forbids raw-markup escape hatches, so the result is never HTML:
 * the page turns these blocks into React elements, and every piece of text stays a text node. Supported:
 * paragraphs, headings (shown as bold lines), bullet and numbered lists, fenced code, `inline code`, **bold**.
 * Not supported on purpose: links, images, tables, raw HTML. They are shown as the text the model wrote.
 *
 * An unclosed fence is code until the end, so a reply that is still streaming looks right.
 */

const FENCE = /^\s*```\s*([A-Za-z0-9_+.-]{0,20})\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** @returns {{t:'text'|'code'|'strong', v:string}[]} */
export function parseInline(text) {
    const out = [];
    const push = (t, v) => { if (v) out.push({ t, v }); };
    text.split(/(`[^`\n]+`)/).forEach((chunk) => {
        if (/^`[^`\n]+`$/.test(chunk)) { push('code', chunk.slice(1, -1)); return; }
        chunk.split(/(\*\*[^*\n]+\*\*)/).forEach((piece) => {
            if (/^\*\*[^*\n]+\*\*$/.test(piece)) push('strong', piece.slice(2, -2));
            else push('text', piece);
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
