// The text a visitor sees in rendered HTML: everything outside <...> tags. A character scan, not a
// tag-stripping regex, so no input can leave a half-removed tag behind.
export function visibleText(html) {
  let text = '';
  let inTag = false;
  for (const character of String(html)) {
    if (character === '<') inTag = true;
    else if (character === '>' && inTag) inTag = false;
    else if (!inTag) text += character;
  }
  return text;
}
