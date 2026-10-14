const MAX_ITEMS = 50;
const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal)$/i;

export function safeFeedUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !host || BLOCKED_HOSTS.test(host)) return null;
  // URL canonicalises unusual IPv4 forms before this check. Feed fetches never need literal IPs.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^\[.*\]$/.test(host)) return null;
  url.hostname = host;
  return url.toString();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
}

function text(value, max) {
  return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return match[1];
  }
  return '';
}

function atomLink(block) {
  const candidates = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of candidates) {
    const attrs = match[1] || '';
    const rel = attrs.match(/\brel\s*=\s*['"]([^'"]+)['"]/i)?.[1]?.toLowerCase();
    const href = attrs.match(/\bhref\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    if (href && (!rel || rel === 'alternate')) return decodeXml(href).trim();
  }
  return '';
}

function dateOrNull(value) {
  const raw = text(value, 100);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseRssOrAtom(xml) {
  if (typeof xml !== 'string' || !xml.trim() || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('unsafe_xml');
  const isAtom = /<feed(?:\s|>)/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!blocks.length) throw new Error('unsupported_feed');
  const seen = new Set();
  const items = [];
  for (const match of blocks) {
    const block = match[1];
    const title = text(tag(block, ['title']), 500);
    const rawLink = isAtom ? atomLink(block) : text(tag(block, ['link']), 2048);
    const link = safeFeedUrl(rawLink);
    const externalId = text(tag(block, isAtom ? ['id'] : ['guid']), 512) || link;
    if (!title || !link || !externalId || seen.has(externalId)) continue;
    seen.add(externalId);
    items.push({
      external_id: externalId.slice(0, 512),
      title,
      link,
      summary: text(tag(block, isAtom ? ['summary', 'content'] : ['description', 'content:encoded']), 4000) || null,
      published_at: dateOrNull(tag(block, isAtom ? ['published', 'updated'] : ['pubDate', 'dc:date'])),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  if (!items.length) throw new Error('empty_feed');
  return items;
}
