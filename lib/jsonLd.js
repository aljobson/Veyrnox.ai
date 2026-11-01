/**
 * Serialize structured data for an HTML script element.
 *
 * React writes a script element's text verbatim. Escaping every less-than
 * sign keeps data containing an HTML end tag inside the JSON text while
 * remaining valid JSON for crawlers.
 */
export function serializeJsonLd(data) {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}

const SITE = 'https://veyrnox.ai';
const abs = (href) => (/^https?:/.test(href) ? href : `${SITE}${href === '/' ? '' : href}`);

/** BreadcrumbList from [{ name, href }] in order, root first. */
export function breadcrumbLd(items) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: item.name,
            item: abs(item.href),
        })),
    };
}

/** HowTo from the same title/summary/steps the guide page renders. */
export function howToLd({ name, description, href, steps, dateModified }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        '@id': `${abs(href)}#howto`,
        name,
        description,
        url: abs(href),
        ...(dateModified ? { dateModified } : {}),
        step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text })),
    };
}

const usd = (cents) => (cents / 100).toFixed(2);

/**
 * Service for one model page. `range` is { minCents, maxCents } from the
 * Credit Pack rates (creditValueRange) or null; with no range the markup
 * carries no offer rather than a guessed price.
 */
export function modelServiceLd({ name, description, href, range }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Service',
        '@id': `${abs(href)}#service`,
        name,
        description,
        url: abs(href),
        serviceType: 'AI generation',
        provider: { '@id': `${SITE}/#organization` },
        ...(range ? {
            offers: {
                '@type': 'AggregateOffer',
                priceCurrency: 'USD',
                lowPrice: usd(range.minCents),
                highPrice: usd(range.maxCents),
                offerCount: 1,
                availability: 'https://schema.org/InStock',
                url: abs(href),
            },
        } : {}),
    };
}

/** Article for a guide that explains rules rather than steps. */
export function articleLd({ name, description, href, dateModified }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        '@id': `${abs(href)}#article`,
        headline: name,
        description,
        url: abs(href),
        ...(dateModified ? { dateModified } : {}),
        author: { '@id': `${SITE}/#organization` },
        publisher: { '@id': `${SITE}/#organization` },
    };
}

/** ItemList for an index page: [{ name, href }] in the order the page shows them. */
export function itemListLd(items) {
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        numberOfItems: items.length,
        itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, url: abs(item.href) })),
    };
}
