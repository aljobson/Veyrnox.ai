import { ODDLING_ARCHETYPES, ODDLING_TONES, ODDLING_SHOWS } from '../app/veyrnox/_lib/character.js';
import { ODDLING_PRESET_SOURCES, ODDLING_STUDIO_SECTIONS, ODDLING_MOTIONS } from '../app/veyrnox/_lib/oddlingStudio.js';

// Read the same product-owned data as the builder, not a second, stale roster.
export const ODDLING_KNOWLEDGE = [
  {
    id: 'oddling-roster', title: 'Meet the Oddling characters', routes: ['/app/oddlings'],
    keywords: ['odd', 'odd characters', 'oddlings', 'oddling characters', 'cast', 'roster', 'character roster', 'character names', 'which characters'],
    target: 'oddlings.builder', action: 'show_target',
    summary: `Oddlings are original adult fictional creator characters. The built-in cast includes ${ODDLING_ARCHETYPES.map(({ name }) => name).join(', ')}.`,
    steps: ['Open Oddling Studio.', 'Choose a cast preset, then customise its traits, voice, recurring show and visual canon.', 'Save a browser-local passport or Continue to a prompt draft in Create.'],
    facts: ['Built-in cast presets are not saved passports. Vey cannot see private browser-local passports or the current unsaved character from this knowledge alone.'],
  },
  {
    id: 'oddling-customisation', title: 'Customise an Oddling character', routes: ['/app/oddlings'],
    keywords: ['oddling traits', 'oddling voice', 'oddling show', 'oddling motion', 'hand size', 'foot size', 'character proportions', 'customise oddling'],
    target: 'oddlings.builder', action: 'show_target',
    summary: `The Oddling builder has these sections: ${ODDLING_STUDIO_SECTIONS.map(({ label, hint }) => `${label} (${hint})`).join('; ')}.`,
    steps: ['Choose a preset or build your own original adult.', 'Adjust the available traits and keep a clear never-drift visual canon.', 'Choose portrait or motion and review the prompt before continuing to Create.'],
    facts: [
      `Voice choices: ${ODDLING_TONES.map(([label, detail]) => `${label}: ${detail}`).join('; ')}.`,
      `Recurring shows: ${ODDLING_SHOWS.map(([label, detail]) => `${label}: ${detail}`).join('; ')}.`,
      `Motion choices: ${ODDLING_MOTIONS.map(({ name }) => name).join(', ')}.`,
    ],
  },
  ...ODDLING_ARCHETYPES.map(({ id, name, hook, kind, picks }) => ({
    id: `oddling-${id}`, title: `${name} — Oddling cast preset`, routes: ['/app/oddlings'],
    keywords: [name, id.replaceAll('-', ' ')], target: 'oddlings.builder', action: 'show_target',
    summary: `${name}: ${hook} This is a built-in ${kind} Oddling preset.`,
    steps: [`Open Oddling Studio and choose ${name} from the cast.`, 'Customise the preset, review its prompt, then save a passport or Continue to Create.'],
    facts: [
      `Collections: ${ODDLING_PRESET_SOURCES.filter((source) => source.ids?.includes(id) || source.kind === kind).map(({ label }) => label).join(', ')}.`,
      `Preset traits: ${Object.entries(picks).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join('; ')}.`,
      'These are the built-in preset defaults, not the user’s current edits or saved passport.',
    ],
  })),
];
