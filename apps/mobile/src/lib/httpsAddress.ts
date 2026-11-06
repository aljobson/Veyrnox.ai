// A web address a person typed: https only, a real-looking host, no sign-in details, nothing invisible.
// Checked before any request so a typo gets an inline message, not a server round trip. The server still decides.

// Whitespace, control/invisible characters, bidirectional controls and dot lookalikes.
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\u00ad\u034f\u115f\u1160\u180e\u200b-\u200f\u2024\u2028\u2029\u202a-\u202e\u2060-\u2069\u2800\u3002\u3164\ud800-\udfff\ufe00-\ufe0f\ufe52\ufeff\uff0e\uff61\uffa0]/;
const ADDRESS = /^https:\/\/([a-z0-9\u00a1-\uffff-]+(?:\.[a-z0-9\u00a1-\uffff-]+)+)(?::(\d{1,5}))?(?:[/?#]\S*)?$/i;

export function httpsAddress(value: unknown, maxLength = 2048): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > maxLength || !text.startsWith('https://') || UNSAFE.test(text)) return null;
    const match = ADDRESS.exec(text);
    if (!match) return null;
    if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return null;
    return match[1].split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')) ? text : null;
}
