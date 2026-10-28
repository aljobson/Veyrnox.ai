import { parseInline, parseMarkdown } from '../src/lib/chatMarkdown';
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../../../lib/chatMarkdown.js'), 'utf8');
const web = new Function(source.replace(/export /g, '') + '\nreturn { parseInline, parseMarkdown };')();
const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) ![x](http://evil/p.png)';
const fixtures = [
    '# Title\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2) b\n\n```js\nconst a = 1\n\nconst b = 2\n```\nafter',
    'Here:\n\n```python\nprint("hi")\nmore', 'use `npm test` and **be careful**', '2 ** 3 and `unclosed', '**`both`**', evil,
    `${evil}\n\n- ${evil}\n\n\`\`\`html\n${evil}\n\`\`\``, 'see [Node](https://nodejs.org/x?a=1#b) now', '[a](http://example.com)',
    '[one](https://a.example/) and [two](https://b.example/p_%28x%29)', '[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](vbscript:x)',
    '[x](ftp://example.com/f)', '[x](mailto:a@b.c)', '[x](/relative)', '[x](https://)', '[x](https://user:pw@example.com/)', '![x](https://example.com/p.png)',
    '[x](https://a.example/ b)', '[](https://example.com)', '[x](HTTPS:/\\example.com)', '**bold** `code` [l](https://x.example/) tail', '', '\n\n  \n', 'a\r\nb',
    '```\n```', '*x*', '**[a](https://x)**', '* one\n* two', '### Three', '[x](javascript:x)', '![img](https://x)',
];
test.each(fixtures)('web parser parity: %s', text => {
    expect(parseInline(text)).toEqual(web.parseInline(text));
    expect(parseMarkdown(text)).toEqual(web.parseMarkdown(text));
});
test('null input parity', () => expect(parseMarkdown(null)).toEqual(web.parseMarkdown(null)));
