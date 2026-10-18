// A value written into a markdown table cell: the backslash is escaped first, then the pipe, so a backslash in the value
// cannot cancel the pipe's escape.
export const escapeCell = (v) => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
