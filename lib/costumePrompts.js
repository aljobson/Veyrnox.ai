// Costumes (face-costume): the customer picks a style; the wording is ours. Nothing
// here is ever taken from the client, so a style cannot be turned into a different
// request. No trademarked character appears in a name or a prompt.
export const COSTUME_STYLES = [
    'clown', 'creepy_clown', 'ghost', 'zombie', 'skeleton', 'vampire', 'masquerade', 'jester',
    'wig_blonde', 'wig_pink', 'wig_curly', 'wig_powdered',
];

const FRAME = 'Edit this photo so the person is wearing a costume. Keep the same person: face shape, features, expression, skin tone, pose, framing, lighting and background stay the same except for the costume. '
    + 'The look is theatrical costume and stage make-up, suitable for all ages: no blood, no wounds or injuries, no weapons, no nudity or sexual content, no text, logos or brand characters, and nobody else added to the picture. ';

const LOOKS = {
    clown: 'Classic circus clown: white face paint, bright red nose, big painted smile, colourful curly wig and a ruffled collar.',
    creepy_clown: 'Spooky stage clown: pale white face paint, smeared painted smile, dark shadowed eyes, a faded ruffled costume and a moody, eerie atmosphere. Stylised theatrical make-up only.',
    ghost: 'Friendly storybook ghost: the person wrapped in a flowing white sheet or translucent shroud with a soft pale glow, hollow dark eyes and a misty background glow.',
    zombie: 'Stylised zombie make-up: pale grey-green skin tint, sunken shadowed eyes, messy hair and tattered dusty clothes. Theatrical prosthetic look with no wounds or blood.',
    skeleton: 'Skeleton face paint: black and white painted skull on the face, bone-pattern costume and a dark moody backdrop.',
    vampire: 'Elegant vampire: pale skin, dark dramatic eye make-up, small fangs, slicked hair and a high-collared dark cape.',
    masquerade: 'Ornate masquerade ball mask over the eyes with gold filigree, feathers and jewels, with an elegant evening look.',
    jester: 'Medieval court jester: a two-coloured jingle hat with bells, a diamond-patterned collar and bold painted cheeks.',
    wig_blonde: 'A long, voluminous blonde wig styled naturally.',
    wig_pink: 'A bright pink bob wig, glossy and neat.',
    wig_curly: 'A big, bouncy curly wig in a rich dark brown.',
    wig_powdered: 'A tall powdered white wig with rolled curls, in the style of an 18th-century courtier.',
};

// The web has no style picker yet, so an omitted style is the friendliest one.
export const DEFAULT_COSTUME = 'clown';

export function costumePrompt(style = DEFAULT_COSTUME) {
    if (!COSTUME_STYLES.includes(style)) throw new Error('invalid_costume_style');
    return FRAME + LOOKS[style];
}
