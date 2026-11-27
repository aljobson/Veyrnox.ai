import { publicTemplateCards } from '../../../lib/clientTemplates.js';
import { MUSIC_DISCOVER_BEATS } from '../../../lib/musicDiscover.js';
import { VEO_TEMPLATE_RECIPES } from './veoTemplateRecipes.js';
import { modelNameForId, templateModelId } from './tokens.js';

// The local part of the unified Templates catalogue. Both /app and
// /app/templates consume this exact projection; the interactive catalogue
// then loads the live Kling, Seedance and Vidu indexes itself.
export function readyTemplateCatalog() {
  const kling = publicTemplateCards().filter(card => card.kind !== 'image').map(card => {
    const modelId = templateModelId(card);
    return {
      id: card.id,
      name: card.name,
      category: card.category,
      model: modelNameForId(modelId) || card.model,
      modelId,
      credits: card.credits,
      poster: card.clip?.poster || null,
      video: card.clip?.video || null,
      durationSeconds: card.durationSeconds,
    };
  });
  const suno = MUSIC_DISCOVER_BEATS.map(beat => ({
    id: beat.id,
    name: beat.title,
    category: beat.mood,
    artwork: beat.artwork,
    bpm: beat.bpm,
    musicalKey: beat.musicalKey,
    mood: beat.mood,
    root: beat.root,
    wave: beat.wave,
    bass: beat.bass,
    lead: beat.lead,
    model: 'ace-step',
    credits: 4,
  }));

  return { kling, seedance: [], veo: VEO_TEMPLATE_RECIPES, suno };
}
