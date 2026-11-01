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
export function howToLd({ name, description, href, steps }) {
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        '@id': `${abs(href)}#howto`,
        name,
        description,
        url: abs(href),
        step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text })),
    };
}
