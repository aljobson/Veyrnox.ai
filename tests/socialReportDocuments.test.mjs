import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportDocument, buildReportPdf, buildReportPptx, reportFilename } from '../lib/social/reportDocuments.js';
import { loadSocialReportData } from '../lib/social/reportData.js';

const template = { name: 'Client / October', report_title: 'October performance', range_days: 30, compare_previous: true, include_content: true };
const analytics = { ok: true, account: { id: 'a1', network: 'instagram', display_name: 'Veyrnox' }, sync: { last_ok_at: '2026-10-14T00:00:00Z', failing: false }, evolution: [{ date: '2026-10-01', metrics: { followers: 100 } }, { date: '2026-10-14', metrics: { followers: 110 } }], posts: [{ id: 'p1', published_at: '2026-10-13T12:00:00Z', caption: 'Launch', metrics: { likes: 10, comments: 2, reach: 500 } }] };

test('report loader aggregates current and previous provider data honestly', async () => {
  const calls = [];
  const result = await loadSocialReportData({ template, authId: 'owner', brandId: 'brand', cfg: {}, now: new Date('2026-10-14T12:00:00Z'), rpcCall: async (name, args) => {
    calls.push({ name, args });
    if (name === 'list_social_accounts') return { ok: true, accounts: [{ id: 'a1', network: 'instagram', status: 'active' }] };
    return analytics;
  } });
  assert.equal(result.ok, true); assert.equal(result.current.portfolio.followers, 110); assert.equal(result.current.portfolio.reach, 500);
  assert.equal(result.current.portfolio.views, null); assert.equal(result.previous.portfolio.interactions, 12);
  assert.equal(calls.filter((call) => call.name === 'get_social_analytics').length, 2);
});

test('PDF and PowerPoint exports are valid binary containers with bounded filenames', () => {
  const data = { range: { from: '2026-09-15', to: '2026-10-14' }, current: { entries: [{ account: analytics.account, data: analytics }], portfolio: { accounts: 1, followers: 110, posts: 1, interactions: 12, reach: 500, views: null, rows: [{ account: analytics.account, summary: { followers: 110, posts: 1, interactions: 12 }, reach: 500, views: null }] } }, previous: null };
  const pdf = buildReportPdf(template, data), pptx = buildReportPptx(template, data);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 8)), '%PDF-1.4');
  assert.deepEqual([...pptx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const pptText = new TextDecoder().decode(pptx); assert.match(pptText, /ppt\/presentation\.xml/); assert.match(pptText, /October performance/);
  assert.equal(reportFilename(template, 'pdf'), 'Client-October.pdf');
  assert.equal(buildReportDocument(template, data, 'pptx').contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});

function pdfText(bytes) {
  const source = new TextDecoder().decode(bytes);
  return [...source.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n');
}
function fixture(posts = analytics.posts, evolution = analytics.evolution) {
  const entry = { account: analytics.account, data: { ...analytics, posts, evolution } };
  return { range: { from: '2026-10-01', to: '2026-10-30' }, current: { entries: [entry], portfolio: { accounts: 1, followers: 110, posts: posts.length, reach: null, views: null, rows: [{ account: analytics.account, views: null }] } }, previous: null };
}

test('branded PDF includes chart pages, honest missing metrics and ranked content', () => {
  const data = fixture([{ caption: 'Low views', published_at: '2026-10-12', metrics: { views: 3 } }, { caption: 'High views', published_at: '2026-10-11', metrics: { views: 120 } }]);
  const bytes = buildReportPdf({ ...template, accent_color: '#f97316' }, data);
  const source = new TextDecoder().decode(bytes), text = pdfText(bytes);
  assert.match(source, /\/Count 3\b/); assert.match(source, /0.976 0.451 0.086 rg/);
  for (const label of ['VEYRNOX.ai', 'Performance overview', 'Audience over time', 'Publishing activity', 'Not supplied', 'not zero']) assert.ok(text.includes(label), label);
  assert.ok(text.indexOf('1. High views') < text.indexOf('2. Low views'));
  assert.match(text, /missing dates are not zero/); assert.match(text, /Latest view totals/);
});

test('content paginates rather than dropping rows and summary-only omits content pages', () => {
  const data = fixture(Array.from({ length: 20 }, (_, i) => ({ caption: `Caption ${i}`, published_at: '2026-10-11', metrics: { views: i } })));
  const output = buildReportPdf(template, data);
  assert.match(new TextDecoder().decode(output), /\/Count 5\b/);
  assert.match(pdfText(output), /20. Caption 0/);
  assert.match(new TextDecoder().decode(buildReportPdf({ ...template, include_content: false }, data)), /\/Count 2\b/);
});

test('empty and single-snapshot reports do not fabricate audience trends or metric values', () => {
  const empty = pdfText(buildReportPdf(template, fixture([], [])));
  assert.match(empty, /No audience snapshots supplied/); assert.match(empty, /No content returned/);
  const one = pdfText(buildReportPdf(template, fixture([], [analytics.evolution[0]])));
  assert.match(one, /a trend needs at least two/);
});

test('PDF safely encodes captions and normalizes typographic punctuation', () => {
  const caption = 'Café — launch (x) \\ BT /Fake 99 Tf';
  const bytes = buildReportPdf({ ...template, report_title: 'October “performance”' }, fixture([{ caption, metrics: {} }]));
  const text = pdfText(bytes), source = new TextDecoder().decode(bytes);
  assert.match(text, /October "performance"/); assert.match(text, /Café - launch/);
  assert.ok(!source.includes('/Fake 99 Tf'));
  assert.ok(!source.includes('NaN')); assert.ok(!source.includes('Infinity'));
});
