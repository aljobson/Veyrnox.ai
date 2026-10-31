// English strings for public. Add keys here; keep their original wording and placeholders.
export default {
    'public.vey.back': 'Back',
    'public.account.signOut': 'Sign out',
    'public.TemplateRecipe.exactCommunityPrompt': 'EXACT COMMUNITY PROMPT',
    'public.TemplateRecipe.copyExactCommunityPrompt': 'Copy exact community prompt',
    'public.TemplateRecipe.exactCommunityPromptHelp': 'Copied exactly as received from the public community feed. This is the prompt Veyrnox sends when you generate. Fill in any reference slots before you start.',
    'public.TemplateRecipe.promptTooLong': 'This prompt is {count} characters. The model takes up to {max}. Shorten it to generate.',
    'public.TemplateRecipe.productPromptTooLong': 'This prompt is {count} characters. Veyrnox accepts up to {max}. Shorten it to continue.',
    'public.TemplateRecipe.chatMessageTooLong': 'This message is {count} characters. Chat accepts up to {max}. Shorten it to send.',
    'public.TemplateRecipe.topicTooLong': 'This topic is {count} characters. Auto Short accepts up to {max}. Shorten it to generate.',
    'public.TemplateRecipe.sourcePromptModelLimitCopyOnly': 'This exact prompt exceeds the assigned model’s verified {max}-character limit. It remains complete and copyable, but generation is disabled.',
    'public.TemplateRecipe.sourcePromptCopyOnly': 'This exact prompt needs required reference media or preserved audio that this model cannot receive. Copy it to use elsewhere.',
    'public.TemplateRecipe.sourcePromptUnavailable': 'The source record did not publish a prompt. Veyrnox has not guessed or reconstructed one; the generation prompt below is an adaptation.',
    'public.TemplateRecipe.sourcePromptNotRecorded': 'No exact source prompt is recorded for this preview. The generation prompt below is a Veyrnox adaptation, not copied source text.',
    'public.TemplateRecipe.sourcePromptTruncated': 'The source feed returned this prompt already cut off. It is preserved exactly and must not be treated as complete.',
    'public.TemplateRecipe.sourcePromptDuplicate': 'The source published this same exact prompt for another video. It is retained unchanged and identified as a source duplicate.',
    'public.TemplateRecipe.generationPrompt': 'GENERATION PROMPT',
} as const;
