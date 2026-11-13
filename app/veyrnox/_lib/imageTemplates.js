import { CHRISTMAS_IMAGE_ORIGINALS } from './imageTemplatesChristmasExpansion.js';
import { IMAGE_SOURCE_PROMPT_RECORDS } from './imageSourcePromptRecords.js';

// Publication only; no provider calls, preview generation or prices here.
export function imageTemplatesEnabled(env = process.env) {
  return env?.IMAGE_TEMPLATES_ENABLED === 'true';
}

const original = (template) => ({ ...template, promptOrigin: 'original' });
export const IMAGE_TEMPLATES = Object.freeze([
  { id: 'flying-elf', name: 'FLYING ELF', model: 'nano-banana-kie', aspect: '16:9',
    prompt: IMAGE_SOURCE_PROMPT_RECORDS['flying-elf'].prompt, promptOrigin: 'community-source-exact' },
  original({ id: 'family-christmas-card-portrait', name: 'FAMILY CHRISTMAS CARD PORTRAIT', model: 'nano-banana-pro-grsai', aspect: '4:3',
    prompt: 'A warm illustrated Christmas card portrait of an invented family gathered beside a softly glowing tree. Two parents, two children and a grandparent wear cosy knitted clothes and share relaxed smiles. Paper stars, handmade ornaments and wrapped gifts fill the room. Gentle watercolour texture, natural faces, warm amber light, balanced group composition, room above for a greeting but no lettering, no logos.' }),
  original({ id: 'snow-globe-scene', name: 'SNOW GLOBE SCENE', model: 'nano-banana-kie', aspect: '1:1',
    prompt: 'A tiny snow-covered village inside a clear glass snow globe on a wooden table. A winding path connects warmly lit cottages and a decorated evergreen tree. Soft snowflakes float inside the globe, with delicate glass reflections and a carved wooden base. Magical miniature craftsmanship, warm window light against cool blue snow, shallow depth of field, no text or logos.' }),
  original({ id: 'gingerbread-village', name: 'GINGERBREAD VILLAGE', model: 'nano-banana-kie', aspect: '16:9',
    prompt: 'A cheerful Christmas village made entirely from gingerbread, white icing and colourful sweets. Little biscuit cottages surround a town square with a sugar-dusted tree. Candy paths curve between houses, icing icicles hang from rooftops, and warm light shines through sugar-glass windows. Detailed handmade confectionery, inviting storybook composition, soft golden light, no writing or logos.' }),
  original({ id: 'cosy-fireplace-evening', name: 'COSY FIREPLACE EVENING', model: 'nano-banana-kie', aspect: '16:9',
    prompt: 'A peaceful Christmas evening in a cosy cottage living room. A small fire glows safely behind a hearth guard, knitted stockings hang above the mantel, and a soft armchair holds a folded plaid blanket. A mug of cocoa rests on a side table beside an open storybook. Snow falls beyond the window. Warm amber lighting, tactile wool and wood, calm painterly realism, no readable text or logos.' }),
  original({ id: 'ugly-sweater-party', name: 'UGLY-SWEATER PARTY', model: 'nano-banana-pro-grsai', aspect: '4:3',
    prompt: 'A joyful group of invented adult friends at a Christmas sweater party, wearing wonderfully silly knitted jumpers decorated with snowflakes, stars and smiling reindeer. They laugh together beneath paper garlands, holding mugs of cocoa beside a table of biscuits. Candid friendly expressions, warm indoor light, colourful editorial illustration, modest clothing, no alcohol, no text or logos.' }),
  original({ id: 'santas-workshop', name: "SANTA'S WORKSHOP", model: 'nano-banana-kie', aspect: '16:9',
    prompt: 'A welcoming storybook view inside Santa\'s Christmas workshop. A kind elderly Santa and cheerful adult elves paint wooden toy animals and wrap gifts at sturdy workbenches. Shelves hold colourful blocks, cloth dolls and ribbons; snow sparkles through round windows. Warm lantern light, richly textured wood, playful details, gentle magical atmosphere, no lettering or logos.' }),
  original({ id: 'winter-wonderland-landscape', name: 'WINTER WONDERLAND LANDSCAPE', model: 'nano-banana-kie', aspect: '16:9',
    prompt: 'A serene winter wonderland landscape at blue hour, with snow-laden fir trees framing a frozen stream and a small warmly lit cabin in the distance. A faint aurora flows across the clear sky, and fresh snow catches soft lavender and silver light. Sweeping scenic composition, delicate atmospheric depth, tranquil Christmas mood, finely detailed nature painting, no people, text or logos.' }),
  original({ id: 'christmas-morning-at-the-tree', name: 'CHRISTMAS MORNING AT THE TREE', model: 'nano-banana-pro-grsai', aspect: '4:3',
    prompt: 'A tender Christmas morning scene with an invented family in cosy modest pyjamas sitting on a rug beside a decorated tree. Children open a wooden train set while their parents smile and a sleepy cat curls up nearby. Morning sunlight mixes with tiny golden tree lights, colourful wrapping paper rests on the floor, candid storybook warmth, no readable text or logos.' }),
  original({ id: 'pet-in-a-santa-hat', name: 'PET IN A SANTA HAT', model: 'nano-banana-kie', aspect: '1:1',
    prompt: 'A portrait of an invented fluffy golden puppy comfortably wearing a loose red Santa hat with a soft white trim. The puppy sits on a knitted blanket beside a small wrapped gift, looking curious and relaxed. Warm Christmas tree lights form gentle bokeh in the background. Detailed soft fur, natural animal proportions, kind playful mood, no text or logos.' }),
  original({ id: 'reindeer-in-the-snow', name: 'REINDEER IN THE SNOW', model: 'nano-banana-kie', aspect: '16:9',
    prompt: 'Two peaceful reindeer standing in fresh snow at the edge of a fir forest on Christmas morning. Their warm winter coats and branching antlers catch the soft rising sun; tiny snowflakes sparkle in the air. A distant wooden cabin glows between the trees. Natural animal anatomy, gentle woodland atmosphere, detailed storybook realism, no harnesses, text or logos.' }),
  ...CHRISTMAS_IMAGE_ORIGINALS,
].map((template) => Object.freeze({
  ...template, kind: 'image', category: 'CHRISTMAS', isNew: true,
  previewAspect: template.aspect.replace(':', ' / '),
  previewImage: `/showcase/christmas/${template.id}.webp`,
  bg: 'linear-gradient(145deg, #163d35, #702e35 65%, #c59a54)',
})));

export const isImageTemplate = (template) => template?.kind === 'image';
export function publishedImageTemplates() {
  return imageTemplatesEnabled() ? IMAGE_TEMPLATES.filter(isImageTemplate) : [];
}
