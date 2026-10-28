// A copy of a render error that is safe to send: its class name and stack frames, never its message
// (a message can hold user text). Frames name only functions and bundle positions, so the crash can be
// traced to a line once the build's source maps are in Sentry.
const SAFE_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const FRAME = /^\s+at /;

export function safeErrorName(error: Error): string {
    return SAFE_NAME.test(error.name) ? error.name : 'Error';
}

export function renderErrorReport(error: Error): Error {
    const name = safeErrorName(error);
    const frames = typeof error.stack === 'string' ? error.stack.split('\n').filter((line) => FRAME.test(line)) : [];
    const report = new Error('render_error');
    report.name = name;
    report.stack = [`${name}: render_error`, ...frames].join('\n');
    return report;
}
