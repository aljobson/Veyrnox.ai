// Shared audit/runtime evidence. Generic motion, choreography, camera and identity
// preservation are generation directions, not proof that an external video exists.
const patterns = [
  ['numbered-video', /@video\s*[_-]?\d+\b|<<<\s*video[_\s-]*\d+\s*>>>|\bvideo\s+\d+\b(?!\s*(?::\s*\d|seconds?\b|secs?\b|minutes?\b|fps\b|k\b|of\s+the\s+series\b))|\bvideo[_-]\d+\.(?:mp4|mov|webm)\b/gi],
  ['video-reference', /@video\b/gi],
  ['external-video', /\b(?:original|source|reference|uploaded|provided|supplied|input)\s+(?:video|footage|clip)\b/gi],
  ['named-uploaded-video', /\b(?:uploaded|supplied)\s+(?:[\w'-]+\s+){1,6}(?:video|footage|clip)\b/gi],
  ['preserved-video', /\bkeep the rest of the video (?:intact|unchanged)\b/gi],
  ['same-video-motion', /\b(?:same|identical)\s+(?:motion|movement|choreography|timing)\b[^.!?\n]{0,60}\b(?:video|footage|clip)\b/gi],
  ['motion-from-video', /\b(?:motion|camera work|timing)\b[^.!?\n]{0,100}\bfrom the (?:\w+\s+)?video\b/gi],
  ['video-authority', /\bVIDEO\s+(?:alone supplies|is the SINGLE SOURCE OF TRUTH)\b[^.!?\n]{0,80}/g],
];
export function templateVideoEvidence(prompt) {
  const text = String(prompt || '');
  return patterns.flatMap(pair => {
    const family = pair[0], pattern = pair[1];
    return Array.from(text.matchAll(pattern)).filter(m => {
    const before = text.slice(0, m.index).split(/[.!?\n]/).pop();
    // A new/original video being generated, or an explicitly unused reference,
    // is not an external dependency. Do NOT erase "do not modify source video".
    return !(family === 'named-uploaded-video' && /\b(?:images?|photos?|pictures?|to|for|and|with|create|generate|make)\b/i.test(m[0]))
      && !/\b(?:create|generate|invent)\s+(?:an?\s+)?$/i.test(before)
      && !/\b(?:no|without)\s+(?:an?\s+)?$/i.test(before)
      && !/\b(?:do not|don't|never)\s+(?:use|follow|copy|reference)\s+(?:the\s+)?$/i.test(before);
  }).map(m => ({ family, phrase: m[0], offset: m.index }));
  });
}
export const templateVideoDependency = prompt => templateVideoEvidence(prompt).length > 0;
