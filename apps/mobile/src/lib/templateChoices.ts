import type { Preset } from './presets';
import { isSupported, kindOf, type CatalogModel } from './media';
import { optionsFor } from './createOptions';
import { nearestAspect, parseRatio } from './templateHandoff';

// Match the web's prompt-only template starts, including its exact modality rule.
export function templateModelEligible(template: Pick<Preset, 'modality'>, candidate: CatalogModel): boolean {
    const inputs = candidate.capabilities?.inputs ?? {};
    return !!template.modality && candidate.modality === template.modality && isSupported(candidate)
        && !('topic' in inputs) && !('clips' in inputs) && !('plan_id' in inputs);
}

export interface TemplateChoices {
    readonly modelId?: string;
    readonly aspect?: string | null;
    readonly duration?: number | null;
    readonly prompt?: string;
}

export function templateOptions(preset: Preset, model: CatalogModel, choices: TemplateChoices = {}) {
    const aspects = optionsFor(model).aspects;
    const durations = kindOf(model.modality) === 'video' ? model.durations : [];
    return {
        aspects, durations,
        aspect: choices.aspect && aspects.includes(choices.aspect) ? choices.aspect
            : nearestAspect(parseRatio(preset.previewAspect) ?? parseRatio(preset.sourceAspect), aspects) ?? aspects[0] ?? null,
        duration: choices.duration != null && durations.includes(choices.duration) ? choices.duration
            : preset.durationSeconds != null && durations.includes(preset.durationSeconds) ? preset.durationSeconds : durations[0] ?? null,
    };
}
