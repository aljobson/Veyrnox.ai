import { renderErrorReport } from '../src/lib/renderErrorReport';

const hermesStack = [
    'RangeError: Invalid time zone: person@example.com',
    '    at format (native)',
    '    at SignInScreen (address at main.jsbundle:1:20481)',
    '    at renderWithHooks (address at main.jsbundle:1:1201)',
].join('\n');

test('keeps the class name and every stack frame, and drops the message', () => {
    const error = new RangeError('Invalid time zone: person@example.com');
    error.stack = hermesStack;
    const report = renderErrorReport(error);
    expect(report.name).toBe('RangeError');
    expect(report.message).toBe('render_error');
    expect(report.stack).toBe([
        'RangeError: render_error',
        '    at format (native)',
        '    at SignInScreen (address at main.jsbundle:1:20481)',
        '    at renderWithHooks (address at main.jsbundle:1:1201)',
    ].join('\n'));
    expect(JSON.stringify({ ...report, stack: report.stack })).not.toContain('person@example.com');
});

test('a message spread over several lines never reaches the report', () => {
    const error = new Error('first line\nsecond line holds private text\n  more');
    error.stack = 'Error: first line\nsecond line holds private text\n  more\n    at Screen (address at main.jsbundle:1:9)';
    expect(renderErrorReport(error).stack).toBe('Error: render_error\n    at Screen (address at main.jsbundle:1:9)');
});

test('an odd class name is reported as Error', () => {
    const error = new Error('x');
    error.name = 'Bad name with spaces';
    expect(renderErrorReport(error).name).toBe('Error');
});

test('an error without a stack still reports its class name', () => {
    const error = new TypeError('x');
    error.stack = undefined;
    expect(renderErrorReport(error).stack).toBe('TypeError: render_error');
});
