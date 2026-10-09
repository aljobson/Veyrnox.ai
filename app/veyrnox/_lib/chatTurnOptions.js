// The options object a turn request carries (ADR-0070). `research` is sent only when it is on, so a turn without it keeps exactly the
// shape it always had. It was once dropped on the way to the server: the button said 7 Credits, the request said nothing, and a plain
// 4-Credit reply came back. This module has no imports so the exact request shape can be tested without the bundler.
export function turnOptions(options) {
  return { thinking: options?.thinking === true, web: options?.web === true, ...(options?.research === true ? { research: true } : {}) };
}
