import { legalKnowledgeSource } from './legal-knowledge-source.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveI18nSource, controlLabels, referencedControlLabels } from './vey-knowledge-i18n.mjs';

const PAGE_FILE = /\/page\.(?:js|jsx|mjs|tsx)$/;
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.tsx'];
const DOCUMENT_SOURCES = Object.freeze([
  'docs/product/ai-mascot.md',
  'docs/product/APP-FLOW.md',
  'docs/product/film-studio.md',
  'docs/social-publisher/01-product-spec.md',
  'docs/social-publisher/04-user-flows.md',
  'docs/operations/mcp.md',
]);

function unique(values, limit = 32) {
  return [...new Set(values.map((value) => normalText(value)).filter(Boolean))].slice(0, limit);
}

function normalText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#123;/g, '{').replace(/&#125;/g, '}')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function jsxText(value) {
  if (/[{}]/.test(value)) return '';
  return normalText(value.replace(/<[^>]+>/g, ' '));
}

function humaniseRoute(route) {
  const segment = route.split('/').filter(Boolean).at(-1) || 'Veyrnox';
  if (/^\[.+\]$/.test(segment)) return 'Item details';
  return segment.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(absolute));
    else paths.push(absolute);
  }
  return paths;
}

function routeFromPage(root, file) {
  const appRoot = path.join(root, 'app');
  const relative = path.relative(appRoot, file).replaceAll(path.sep, '/')
    .replace(/^veyrnox\//, '')
    .split('/').filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith('@')).join('/');
  const routePath = relative
    .replace(/^page\.(?:js|jsx|mjs|tsx)$/, '')
    .replace(/\/page\.(?:js|jsx|mjs|tsx)$/, '');
  const route = `/${routePath}`.replace(/\/$/, '') || '/';
  return route;
}

async function resolveImport(specifier, importer, productRoot) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  if (!base.startsWith(`${productRoot}${path.sep}`) && base !== productRoot) return null;
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function collectRouteSources(pageFile, productRoot, sourceCache) {
  const visited = new Set();
  const queue = [pageFile];
  while (queue.length && visited.size < 96) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    let source = sourceCache.get(file);
    if (source === undefined) {
      source = await readFile(file, 'utf8');
      sourceCache.set(file, source);
    }
    const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const resolved = await resolveImport(match[1], file, productRoot);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  // Breadth-first insertion order deliberately keeps the page and its closest
  // feature components ahead of shared navigation and authentication modules.
  return [...visited].map((file) => ({ file, source: sourceCache.get(file) }));
}

function extractRouteKnowledge(root, pageFile, modules, knowledgeCache, labels) {
  const route = routeFromPage(root, pageFile);
  const resolved = modules.map(({ source }) => {
    if (!knowledgeCache.has(source)) knowledgeCache.set(source, {
      copy: resolveI18nSource(source),
      // Preserve nested links while resolving their localized href attributes.
      references: resolveI18nSource(source, undefined, { attributesOnly: true }),
    });
    return knowledgeCache.get(source);
  });
  const combined = resolved.map(value => value.copy).join('\n');
  const references = resolved.map(value => value.references).join('\n');
  const headings = [];
  const primaryHeadings = [];
  const controls = modules.flatMap(({ source }) => referencedControlLabels(source, labels));
  const descriptions = [];
  const targets = [];
  const links = [];

  for (const match of combined.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const value = jsxText(match[2]);
    if (value.length >= 2 && value.length <= 160) {
      headings.push(value);
      if (match[1] === '1') primaryHeadings.push(value);
    }
  }
  for (const match of combined.matchAll(/<(?:button|label|summary)\b[^>]*>([\s\S]*?)<\/(?:button|label|summary)>/gi)) {
    const value = jsxText(match[1]);
    if (value.length >= 2 && value.length <= 120) controls.push(value);
  }
  for (const match of combined.matchAll(/\b(?:aria-label|placeholder|title)\s*=\s*(['"])(.*?)\1/gi)) {
    if (match[2].length >= 2 && match[2].length <= 160) controls.push(match[2]);
  }
  for (const match of combined.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const value = jsxText(match[1]);
    if (value.length >= 20 && value.length <= 320) descriptions.push(value);
  }
  for (const match of references.matchAll(/\bdata-assistant-target\s*=\s*(['"])(.*?)\1/gi)) targets.push(match[2]);
  for (const match of references.matchAll(/\bhref\s*=\s*(['"])(\/[^'"]*)\1/gi)) links.push(match[2]);

  const cleanHeadings = unique(headings, Infinity);
  const cleanControls = unique(controls, Infinity);
  const cleanDescriptions = unique(descriptions, Infinity);
  const relativePage = path.relative(root, pageFile).replaceAll(path.sep, '/');
  const sourceHash = createHash('sha256')
    .update(modules.map(({ file, source }) => `${path.relative(root, file)}\n${source}`).join('\n---\n'))
    .digest('hex')
    .slice(0, 16);

  return {
    id: `route:${route}`,
    route,
    title: unique(primaryHeadings, 1)[0] || cleanHeadings[0] || humaniseRoute(route),
    headings: cleanHeadings,
    controls: cleanControls,
    descriptions: cleanDescriptions,
    targets: unique(targets, Infinity),
    links: unique(links, Infinity),
    source: relativePage,
    sourceHash,
  };
}

function stripMarkdown(value) {
  return normalText(value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s*[|>-]+/gm, ' ')
    .replace(/[*_#]/g, ' '));
}

function extractDocumentKnowledge(relativeFile, markdown) {
  const sections = [];
  const headingPattern = /^(#{1,3})\s+(.+)$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const text = stripMarkdown(markdown.slice(start, end));
    if (text.length < 30) continue;
    const title = normalText(match[2]);
    sections.push({
      id: `doc:${relativeFile}#${index + 1}`,
      title,
      text: text.slice(0, 900),
      source: relativeFile,
      sourceHash: createHash('sha256').update(`${title}\n${text}`).digest('hex').slice(0, 16),
    });
  }
  return sections;
}

export async function buildVeyKnowledgeArtifact(root) {
  const productRoot = path.join(root, 'app');
  const sourceCache = new Map();
  const knowledgeCache = new Map();
  const layoutModules = new Map();
  const files = await walk(productRoot);
  const labels = new Map();
  for (const file of files.filter(file => SOURCE_EXTENSIONS.includes(path.extname(file)) && !file.includes(`${path.sep}api${path.sep}`))) {
    const source = await readFile(file, 'utf8');
    sourceCache.set(file, source);
    if (source.includes('data-testid=') && source.includes('aria-label=')) {
      for (const [hook, label] of controlLabels(source)) labels.set(hook, label);
    }
  }
  const pages = files
    .filter((file) => PAGE_FILE.test(file.replaceAll(path.sep, '/')))
    .sort();
  const routes = [];
  for (const page of pages) {
    const modules = await collectRouteSources(page, productRoot, sourceCache);
    const document = /LegalDocument\(\{ document: '([a-z-]+)' \}\)/.exec(modules[0]?.source || '')?.[1];
    if (document) modules.splice(1, 0, await legalKnowledgeSource(root, document));
    // Next renders ancestor layouts without an explicit import from the page.
    // Include their UI so shared notice knowledge comes from the rendered
    // component, rather than incidentally from an English DOM selector.
    const included = new Set(modules.map(({ file }) => file));
    for (let directory = path.dirname(page); directory.startsWith(productRoot); directory = path.dirname(directory)) {
      const layout = await resolveImport('./layout', path.join(directory, 'page.js'), productRoot);
      if (!layout) continue;
      if (!layoutModules.has(layout)) layoutModules.set(layout, await collectRouteSources(layout, productRoot, sourceCache));
      for (const module of layoutModules.get(layout)) {
        if (!included.has(module.file)) { included.add(module.file); modules.push(module); }
      }
    }
    routes.push(extractRouteKnowledge(root, page, modules, knowledgeCache, labels));
  }

  const documents = [];
  for (const relativeFile of DOCUMENT_SOURCES) {
    try {
      documents.push(...extractDocumentKnowledge(relativeFile, await readFile(path.join(root, relativeFile), 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const version = createHash('sha256')
    .update(JSON.stringify({ routes, documents }))
    .digest('hex')
    .slice(0, 20);
  return { version, routes, documents };
}

export function renderVeyKnowledgeModule(artifact) {
  return `// Generated by scripts/sync-vey-knowledge.mjs. Do not edit by hand.\n` +
    `export const GENERATED_KNOWLEDGE_VERSION = ${JSON.stringify(artifact.version)};\n\n` +
    `export const AUTO_PRODUCT_INVENTORY = Object.freeze(${JSON.stringify(artifact.routes, null, 2)});\n\n` +
    `export const AUTO_PRODUCT_DOCS = Object.freeze(${JSON.stringify(artifact.documents, null, 2)});\n`;
}

export const VEY_KNOWLEDGE_DOCUMENT_SOURCES = DOCUMENT_SOURCES;
