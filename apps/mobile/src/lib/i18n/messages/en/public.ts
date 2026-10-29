// English strings for public. Add keys here; keep their original wording and placeholders.
export default {
    'public.vey.back': 'Back',
    'public.account.signOut': 'Sign out',
    'public.TemplateRecipe.exactCommunityPrompt': 'EXACT COMMUNITY PROMPT',
    'public.TemplateRecipe.copyExactCommunityPrompt': 'Copy exact community prompt',
    'public.TemplateRecipe.exactCommunityPromptHelp': 'Copied exactly as received from the public community feed. It may include incomplete reference slots or truncated source text. Veyrnox uses the model-compatible prompt below when generating.',
    'public.TemplateRecipe.sourcePromptUnavailable': 'The source record did not publish a prompt. Veyrnox has not guessed or reconstructed one; the generation prompt below is an adaptation.',
    'public.TemplateRecipe.sourcePromptNotRecorded': 'No exact source prompt is recorded for this preview. The generation prompt below is a Veyrnox adaptation, not copied source text.',
    'public.TemplateRecipe.sourcePromptTruncated': 'The source feed returned this prompt already cut off. It is preserved exactly and must not be treated as complete.',
    'public.TemplateRecipe.sourcePromptDuplicate': 'The source published this same exact prompt for another video. It is retained unchanged and identified as a source duplicate.',
    'public.TemplateRecipe.generationPrompt': 'VEYRNOX GENERATION PROMPT',
} as const;
