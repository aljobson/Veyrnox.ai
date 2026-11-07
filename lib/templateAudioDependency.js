// External preserved audio only. Native generated dialogue/music and silence do
// not need an audio upload. Evidence retains exact source bytes for review.
const patterns = [
  ['audio-token', /@audio\s*[_-]?\d+\b|<<<\s*audio[^>]*>>>/gi],
  ['external-audio', /\b(?:original|source|reference|uploaded|provided|existing)\s+(?:audio|music(?!\s+video)|soundtrack|speech|dialogue|vocals|rap|lip[ -]?sync)\b/gi],
  ['audio-from-source', /\b(?:audio|soundtrack|vocals|dialogue)\b[^.!?\n]{0,60}\b(?:from|of|in)\s+(?:the\s+)?(?:source|original|reference)\b|\b(?:audio|soundtrack|sounds|dialogue)\s+from\s+(?:@video\s*\d+|<<<\s*video_\d+\s*>>>)/gi],
  ['preserved-audio', /\b(?:keep|preserve|retain)\b[^.!?\n]{0,180}\b(?:audio|soundtrack)\s+(?:(?:completely|exactly)\s+)?(?:unchanged|intact|exactly)\b/gi],
  ['preserved-original-soundtrack', /\b(?:keep|preserve|retain)\b[^.!?\n]{0,180}\b(?:original|source)\b[^.!?\n]{0,220}\b(?:soundtrack|audio)\b/gi],
];
export function templateAudioEvidence(prompt) {
  const text = String(prompt || '');
  return patterns.flatMap(pair => {
    const family = pair[0], pattern = pair[1];
    return Array.from(text.matchAll(pattern)).filter(m => {
    const before = text.slice(0, m.index).split(/[.!?\n]/).pop();
    return !(family === 'external-audio' && /\b(?:create|generate|compose|write)\b[^.!?\n]{0,100}\bwith\s+$/i.test(before))
      && !/\b(?:create|generate|compose|write)\s+(?:an?\s+)?$/i.test(before)
      && !/\b(?:no|without)\s+(?:an?\s+)?$/i.test(before)
      && !/\b(?:do not|don't|never)\s+(?:infer|generate|use|copy)(?:\s+or\s+\w+)?\s+(?:any\s+|the\s+)?$/i.test(before);
  }).map(m => ({ family, phrase: m[0], offset: m.index }));
  });
}
export const templateAudioDependency = prompt => templateAudioEvidence(prompt).length > 0;
