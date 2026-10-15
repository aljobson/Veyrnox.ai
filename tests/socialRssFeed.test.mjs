import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRssOrAtom, safeFeedUrl } from '../lib/social/rssFeed.js';

test('accepts public HTTPS feed URLs and rejects local or literal hosts', () => {
  assert.equal(safeFeedUrl('https://Example.com/news.xml'), 'https://example.com/news.xml');
  for (const value of ['http://example.com/feed', 'https://localhost/feed', 'https://site.local/feed', 'https://127.0.0.1/feed', 'https://[::1]/feed', 'https://user:pass@example.com/feed', 'https://example.com:8443/feed']) assert.equal(safeFeedUrl(value), null);
});

test('parses bounded RSS items, decodes text and deduplicates IDs', () => {
  const items = parseRssOrAtom(`<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[First &amp; best]]></title><link>https://example.com/first</link><guid>post-1</guid><description><![CDATA[<p>Hello</p>]]></description><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Duplicate</title><link>https://example.com/other</link><guid>post-1</guid></item>
  </channel></rss>`);
  assert.deepEqual(items, [{ external_id: 'post-1', title: 'First & best', link: 'https://example.com/first', summary: 'Hello', published_at: '2026-10-13T10:00:00.000Z' }]);
});

test('parses Atom alternate links and rejects unsafe XML or unusable feeds', () => {
  const [item] = parseRssOrAtom(`<feed><entry><id>tag:example,1</id><title>Update</title><link rel="alternate" href="https://example.com/update"/><summary>News</summary><updated>2026-10-13T11:00:00Z</updated></entry></feed>`);
  assert.equal(item.link, 'https://example.com/update');
  assert.throws(() => parseRssOrAtom('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed/>'), /unsafe_xml/);
  assert.throws(() => parseRssOrAtom('<rss><channel/></rss>'), /unsupported_feed/);
  assert.throws(() => parseRssOrAtom('<rss><channel><item><title>Local</title><link>https://localhost/x</link></item></channel></rss>'), /empty_feed/);
});
