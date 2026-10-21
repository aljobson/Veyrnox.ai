declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { resolve } = require('path') as { resolve(...paths: string[]): string };
import { AI_DISCLOSURES, CINEMA_POLICY_VERSION, CINEMA_RATINGS, CINEMA_WARNING_CODES, creatorMessage, draftBody, emptyDraft, MALWARE_TEXT, MAX_UPLOAD_BYTES, RIGHTS_TEXT, RIGHTS_VERSION, SAFETY_TEXT, submitBody, UPLOAD_CHUNK_BYTES } from '../src/lib/cinemaDrafts';
const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');
const quoted = (text: string) => [...text.matchAll(/'([^']*)'/g)].map(x => x[1]);
const array = (text: string, name: string) => text.match(new RegExp(`${name} = Object.freeze\\(\\[([\\s\\S]*?)\\]\\);`))![1];
const literal = (text: string, name: string) => text.match(new RegExp(`${name} = '([^']*)'`))![1];
const withoutPolicyLink = (text: string) => {
    const open = text.indexOf('<a '), content = text.indexOf('>', open), close = text.indexOf('</a>', content);
    return open < 0 || content < 0 || close < 0 ? text : text.slice(0, open) + text.slice(content + 1, close) + text.slice(close + 4);
};

test('pinned declarations, vocabulary and byte limits drift against source text', () => {
    const publish = source('lib/cinema/publishApi.js'), safety = source('lib/cinema/safetyPolicy.js');
    const workspace = source('app/veyrnox/social-cinema/creator/CreatorWorkspace.js');
    expect(RIGHTS_VERSION).toBe(literal(publish, 'RIGHTS_VERSION'));
    expect(CINEMA_POLICY_VERSION).toBe(literal(safety, 'CINEMA_POLICY_VERSION'));
    expect(CINEMA_RATINGS.flat()).toEqual(quoted(array(safety, 'CINEMA_RATINGS')));
    expect(CINEMA_WARNING_CODES.flat()).toEqual(quoted(array(safety, 'CINEMA_WARNING_CODES')));
    expect(AI_DISCLOSURES).toEqual(quoted(array(source('lib/cinema/domain.js'), 'AI_DISCLOSURES')));
    expect(RIGHTS_TEXT).toBe(literal(workspace, 'RIGHTS_TEXT'));
    const declarations = [...workspace.matchAll(/<span lang="en" dir="ltr">([\s\S]*?)<\/span>/g)].map(x => withoutPolicyLink(x[1]));
    expect(declarations).toContain(SAFETY_TEXT); expect(declarations).toContain(MALWARE_TEXT);
    const policy = source('lib/cinema/uploadPolicy.js');
    for (const [name, value] of Object.entries({ MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES })) expect(value).toBe(Number(policy.match(new RegExp(`${name}=(\\d+)`))![1]));
});
test('draft and submit bodies have exactly the server key sets and chosen values', () => {
    const content = source('lib/cinema/contentApi.js');
    const fields = quoted(content.match(/const fields = \[([^\]]+)\]/)![1]);
    const optional = quoted(content.match(/const optional = \[([^\]]+)\]/)![1]);
    const body = draftBody({ ...emptyDraft(), title: ' A film ', categories: ['drama'], ai_disclosures: ['generated_video'] });
    expect(Object.keys(body).sort()).toEqual([...fields, ...optional].sort());
    expect(body).toMatchObject({ title: 'A film', parent_id: null, position: null, language: 'en', categories: ['drama'] });
    const submission = submitBody('content-id', '12', ['violence']);
    expect(Object.keys(submission).sort()).toEqual(quoted(source('lib/cinema/publishApi.js').match(/submit: \[([^\]]+)\]/)![1]).sort());
    expect(submission).toEqual({ content_id: 'content-id', rights_version: RIGHTS_VERSION, policy_version: CINEMA_POLICY_VERSION, audience_rating: '12', content_warnings: ['violence'], safety_confirmed: true, malware_confirmed: true });
});
test.each([
    { title: ' ' }, { title: 'x'.repeat(161) }, { synopsis: 'x'.repeat(2001) }, { language: 'EN' },
    { categories: ['drama', 'horror', 'comedy'] }, { categories: ['drama', 'drama'] }, { ai_disclosures: ['unknown'] }, { content_type: 'SERIES' },
])('rejects invalid draft %j', bad => expect(() => draftBody({ ...emptyDraft(), title: 'Film', ...bad })).toThrow());
test('unicode title length uses characters, matching the server', () => {
    expect(draftBody({ ...emptyDraft(), title: '🎬'.repeat(160) }).title).toHaveLength(320);
});

test.each([
    ['video_not_ready', 'videoNotReady'], ['category_required', 'categoryRequired'], ['safety_checks_pending', 'checksPending'],
    ['safety_checks_failed', 'checksFailed'], ['already_submitted', 'alreadySubmitted'], ['rights_version_required', 'declarationChanged'],
    ['policy_version_required', 'declarationChanged'], ['publishing_not_open', 'closed'],
])('submission error %s has a human message key', (code, key) => {
    const { ApiError } = require('../src/lib/api');
    expect(creatorMessage(new ApiError(409, code))).toBe(`cinemaUpload.${key}`);
});
