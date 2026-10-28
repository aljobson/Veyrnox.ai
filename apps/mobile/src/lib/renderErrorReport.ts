// A copy of a render error that is safe to send: its class name and stack frames, never its message
// (a message can hold user text). Frames name only functions and bundle positions, so the crash can be
// traced to a line once the build's source maps are in Sentry.
const SAFE_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const FRAME = /^\s+at /;

export function safeErrorName(error: Error): string {
    return SAFE_NAME.test(error.name) ? error.name : 'Error';
}

// The stack after its "Name: message" header. The whole header is cut by its exact text, so a message
// line shaped like a frame never survives; a stack that does not start with that header gives no frames.
function framesOf(error: Error): string[] {
    if (typeof error.stack !== 'string') return [];
    const header = error.message ? `${error.name}: ${error.message}` : error.name;
    if (!error.stack.startsWith(`${header}\n`)) return [];
    return error.stack.slice(header.length + 1).split('\n').filter((line) => FRAME.test(line));
}

export function renderErrorReport(error: Error): Error {
    const name = safeErrorName(error);
    const report = new Error('render_error');
    report.name = name;
    report.stack = [`${name}: render_error`, ...framesOf(error)].join('\n');
    return report;
}
