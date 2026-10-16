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
