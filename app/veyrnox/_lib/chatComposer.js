export const REPLY_MODES = Object.freeze({
  STANDARD: 'standard',
  THINKING: 'thinking',
  RESEARCH: 'research',
});

export function replyMode(opts = {}) {
  if (opts.research === true) return REPLY_MODES.RESEARCH;
  if (opts.thinking === true) return REPLY_MODES.THINKING;
  return REPLY_MODES.STANDARD;
}

// Deep research is its own text-only run. Standard and Thinking can both keep
// Web search on, so moving between those two modes does not quietly remove it.
export function optionsForReplyMode(mode, opts = {}) {
  if (mode === REPLY_MODES.RESEARCH) return { thinking: false, web: false, research: true };
  return {
    ...opts,
    thinking: mode === REPLY_MODES.THINKING,
    research: false,
  };
}
