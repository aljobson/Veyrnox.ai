export const MUSIC_LYRICIST_NAME_PREFIX = 'Lyricist · ';
export const MUSIC_LYRICIST_INSTRUCTION_PREFIX = 'Veyrnox Music lyricist profile v1.';
export const MUSIC_LYRICIST_NAME_MAX = 40;
export const MUSIC_LYRICIST_DIRECTION_MAX = 500;
export const MUSIC_LYRICIST_EXAMPLES_MAX = 2500;

export function isMusicLyricistProfile(persona) {
  return Boolean(persona && typeof persona.id === 'string'
    && typeof persona.name === 'string' && persona.name.startsWith(MUSIC_LYRICIST_NAME_PREFIX)
    && typeof persona.instructions === 'string' && persona.instructions.startsWith(MUSIC_LYRICIST_INSTRUCTION_PREFIX));
}

export function musicLyricistLabel(persona) {
  return isMusicLyricistProfile(persona) ? persona.name.slice(MUSIC_LYRICIST_NAME_PREFIX.length) : '';
}

export function buildMusicLyricistProfile({ name = '', direction = '', examples = '', ownsExamples = false } = {}) {
  const cleanName = String(name).trim().slice(0, MUSIC_LYRICIST_NAME_MAX);
  const cleanDirection = String(direction).replace(/\r\n?/g, '\n').trim().slice(0, MUSIC_LYRICIST_DIRECTION_MAX);
  const cleanExamples = String(examples).replace(/\r\n?/g, '\n').trim().slice(0, MUSIC_LYRICIST_EXAMPLES_MAX);
  if (!cleanName || !cleanDirection || !cleanExamples || ownsExamples !== true) return null;
  return {
    name: `${MUSIC_LYRICIST_NAME_PREFIX}${cleanName}`,
    instructions: [
      MUSIC_LYRICIST_INSTRUCTION_PREFIX,
      'The user attested that they wrote or own the private examples below.',
      'Infer only broad craft traits such as imagery, cadence, density and structure.',
      'Never reproduce a distinctive line from an example. Write new lyrics for the current request.',
      'Do not imitate a living artist or claim the profile is a trained model.',
      '',
      'Preferred writing direction:',
      cleanDirection,
      '',
      'BEGIN PRIVATE OWNED EXAMPLES',
      cleanExamples,
      'END PRIVATE OWNED EXAMPLES',
    ].join('\n'),
    model_id: null,
    thinking: false,
    web: false,
  };
}
