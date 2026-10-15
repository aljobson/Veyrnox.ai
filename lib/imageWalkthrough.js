// Reviewed steps only point or focus. They never change inputs or submit a job.
export const IMAGE_WALKTHROUGH = Object.freeze([
    { target: 'create.models', title: 'Choose an image model', message: 'Choose a model labelled IMAGE. Its price and any free allowance appear beside it. Then select Next.' },
    { target: 'create.prompt', title: 'Describe your image', message: 'Describe the subject, composition, lighting and style. Keep or edit your draft here.', focus: true },
    { target: 'create.upload', title: 'Add a source if needed', message: 'This model offers source files. Add your own file or choose From library when available. Required sources must be supplied before generating.', optional: true },
    { target: 'create.consent', title: 'Review source rights', message: 'Read the rights and consent statement and confirm it yourself only if it is true. Vey cannot tick this for you.', optional: true },
    { target: 'create.aspect', title: 'Choose the image shape', message: 'Choose an offered aspect ratio: for example 1:1 for a square, 16:9 for landscape, or 9:16 for portrait.', optional: true },
    { target: 'create.count', title: 'Choose how many images', message: 'Choose the number of images. More images can increase the total cost or use more of your free allowance.', optional: true },
    { target: 'create.character', title: 'Optional character styling', message: 'Use these controls if you want a fictional character. Leave them off to use your prompt as written.', optional: true },
    { target: 'create.settings', title: 'Optional advanced settings', message: 'Use a seed or negative prompt only if this model offers them. Leaving the defaults is fine.', optional: true },
    { target: 'create.camera', title: 'Optional camera styling', message: 'Camera settings can add a photographic look. Leave this off if you do not need it.', optional: true },
    { target: 'create.cost', title: 'Review the total cost', message: 'Check the current total and free allowance below this heading. Review your model, prompt, sources and image count before continuing.' },
    { target: 'create.generate', title: 'You decide when to generate', message: 'This is the final Generate button. Vey only points: you personally press it when the inputs and price are right. Your result will appear here and in Library.' },
]);

export function nextImageStep(current, visibleTargets) {
    const visible = new Set(visibleTargets);
    for (let index = current + 1; index < IMAGE_WALKTHROUGH.length; index += 1) {
        const step = IMAGE_WALKTHROUGH[index];
        if (visible.has(step.target)) return { index, step };
        if (!step.optional) return { missing: step.target };
    }
    return { complete: true };
}
