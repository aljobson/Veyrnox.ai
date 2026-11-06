// A web address a person typed: https only, a real-looking host, no sign-in details, nothing invisible.
// Checked before any request so a typo gets an inline message, not a server round trip. The server still decides.

// Whitespace, control characters, zero-width and bidirectional override/isolate characters.
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/;
const ADDRESS = /^https:\/\/([a-z0-9\u00a1-\uffff-]+(?:\.[a-z0-9\u00a1-\uffff-]+)+)(?::\d{1,5})?(?:[/?#]\S*)?$/i;

export function httpsAddress(value: unknown, maxLength = 2048): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > maxLength || UNSAFE.test(text)) return null;
    const match = ADDRESS.exec(text);
    if (!match) return null;
    return match[1].split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')) ? text : null;
}
