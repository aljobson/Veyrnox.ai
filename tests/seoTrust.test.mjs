import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('JSON-LD serialization preserves data without allowing a script breakout', async () => {
  const { serializeJsonLd } = await import('../lib/jsonLd.js');
  const data = { name: '</script><script>alert("xss")</script>', detail: 'A&B > C' };
  const serialized = serializeJsonLd(data);

  assert.equal(serialized.includes('<'), false);
  assert.deepEqual(JSON.parse(serialized), data);
});

test('site entity data identifies the web application and its factual publisher', () => {
  const seo = read('app/seo.js');
  assert.match(seo, /'@type': 'WebApplication'/);
  assert.match(seo, /applicationCategory: 'MultimediaApplication'/);
  assert.match(seo, /operatingSystem: 'Web'/);
  assert.match(seo, /provider: \{ '@id': `\$\{SITE_URL\}\/\#organization` \}/);
  assert.doesNotMatch(seo, /aggregateRating|review|offers|sameAs/);
  assert.match(seo, /serializeJsonLd\(data\)/);
});

test('route-level Open Graph metadata keeps the shared brand card', () => {
  const files = [
    'app/veyrnox/app/create/layout.js',
    'app/veyrnox/app/credits/layout.js',
    'app/veyrnox/app/library/layout.js',
    'app/veyrnox/design-system/layout.js',
    'app/veyrnox/guides/[id]/page.js',
    'app/veyrnox/guides/page.js',
    'app/veyrnox/mcp/page.js',
    'app/veyrnox/models/[id]/page.js',
    'app/veyrnox/models/page.js',
    'app/veyrnox/presets/[id]/page.js',
    'app/veyrnox/presets/layout.js',
    'app/veyrnox/pricing/layout.js',
    'app/veyrnox/tools/page.js',
  ];

  for (const file of files) {
    const source = read(file);
    assert.match(source, /import \{ OPEN_GRAPH_BASE \} from /, `${file} imports the shared base`);
    assert.match(source, /openGraph: \{ \.\.\.OPEN_GRAPH_BASE, /, `${file} retains the shared card`);
  }
});

test('About publishes only verified company facts and is discoverable', () => {
  const about = read('app/veyrnox/about/page.js');
  const sitemap = read('app/sitemap.js');
  const tokens = read('app/veyrnox/_lib/tokens.js');
  const footer = read('app/veyrnox/_sections/footer.js');

  assert.match(about, /ENTITY\.name/);
  assert.match(about, /ENTITY\.companyNo/);
  assert.match(about, /ENTITY\.jurisdiction/);
  assert.match(about, /ENTITY\.office/);
  assert.match(about, /ENTITY\.email/);
  assert.doesNotMatch(about, /customers|trusted by|award|testimonial/i);
  assert.match(sitemap, /page\('\/about', 'yearly', 0\.4\)/);
  assert.match(tokens, /href: '\/about',\s+label: 'About'/);
  assert.match(footer, /ENTITY\.companyNo/);
  assert.match(footer, /ENTITY\.jurisdiction/);
});

test('commercial-use copy directs visitors to current provider terms without promising rights', () => {
  const tokens = read('app/veyrnox/_lib/tokens.js');

  assert.match(tokens, /Commercial use varies by model and provider/);
  assert.match(tokens, /check the current provider terms before publishing/);
  assert.doesNotMatch(tokens, /Outputs are yours to use commercially/);
});

test('model sitemap entries use validated catalog timestamps without dating static pages', () => {
  const sitemap = read('app/sitemap.js');

  assert.match(sitemap, /m\.updatedAt/);
  assert.doesNotMatch(sitemap, /lastModified: now|const now = new Date/);
});
