// ADR-0067: the reply renderer's reader. Output is plain data, never markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from '../lib/chatMarkdown.js';

const text = (v) => ({ t: 'text', v });

test('paragraphs, headings, lists and code', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2) b\n\n```js\nconst a = 1\n\nconst b = 2\n```\nafter');
    assert.deepEqual(blocks.map((b) => b.type), ['h', 'p', 'ul', 'ol', 'code', 'p']);
    assert.deepEqual(blocks[1].inline, [text('First line\nsecond line')], 'soft line breaks are kept');
    assert.deepEqual(blocks[2].items, [[text('one')], [text('two')]]);
    assert.deepEqual(blocks[3].items, [[text('a')], [text('b')]]);
    assert.deepEqual([blocks[4].lang, blocks[4].text], ['js', 'const a = 1\n\nconst b = 2'], 'blank lines inside code survive');
});

test('a reply still streaming: an unclosed fence is code to the end', () => {
    const blocks = parseMarkdown('Here:\n\n```python\nprint("hi")\nmore');
    assert.deepEqual(blocks.map((b) => b.type), ['p', 'code']);
    assert.equal(blocks[1].text, 'print("hi")\nmore');
});

test('inline code and bold; unmatched markers stay as text', () => {
    assert.deepEqual(parseInline('use `npm test` and **be careful**'), [text('use '), { t: 'code', v: 'npm test' }, text(' and '), { t: 'strong', v: 'be careful' }]);
    assert.deepEqual(parseInline('2 ** 3 and `unclosed'), [text('2 ** 3 and `unclosed')]);
    assert.deepEqual(parseInline('**`both`**'), [text('**'), { t: 'code', v: 'both' }, text('**')], 'no nesting: simple and predictable');
});

test('hostile text comes out as text, never as markup or a link', () => {
    const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) ![x](http://evil/p.png)';
    const [p] = parseMarkdown(evil);
    assert.deepEqual(p.inline, [text(evil)], 'every character is returned unchanged as text for a text node');
    const all = JSON.stringify(parseMarkdown(`${evil}\n\n- ${evil}\n\n\`\`\`html\n${evil}\n\`\`\``));
    assert.ok(!/"t":"(link|html|image)"/.test(all) && !all.includes('"type":"html"'), 'no link, html or image node type exists');
});

test('empty and odd input', () => {
    assert.deepEqual(parseMarkdown(''), []); assert.deepEqual(parseMarkdown(null), []); assert.deepEqual(parseMarkdown('\n\n  \n'), []);
    assert.deepEqual(parseMarkdown('a\r\nb').map((b) => b.type), ['p']);
    assert.deepEqual(parseMarkdown('```\n```').map((b) => [b.type, b.text]), [['code', '']]);
});
