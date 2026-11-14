import { SYNTX_100_VIDEO_TEMPLATES } from './sourceTemplateExpansion19.js';
import { SYNTX_REPLACEMENTS_TEMPLATES } from './sourceTemplateExpansion18.js';
import { HF_REPLACEMENTS_TEMPLATES } from './sourceTemplateExpansion17.js';
import { CATEGORY_FILL_TEMPLATES } from './sourceTemplateExpansion16.js';
import { SYNTX_64_TEMPLATES } from './sourceTemplateExpansion15.js';
import { SOURCE_TEMPLATE_EXPANSION_14 } from './sourceTemplateExpansion14.js';
import { SOURCE_TEMPLATE_EXPANSION_7 } from './sourceTemplateExpansion7.js';
import { SOURCE_TEMPLATE_EXPANSION_8 } from './sourceTemplateExpansion8.js';
import { SOURCE_TEMPLATE_EXPANSION_9 } from './sourceTemplateExpansion9.js';
import { SOURCE_TEMPLATE_EXPANSION_10 } from './sourceTemplateExpansion10.js';
import { SOURCE_TEMPLATE_EXPANSION_11 } from './sourceTemplateExpansion11.js';
import {
  REPLACED_HIGGSFIELD_TEMPLATE_IDS,
  SOURCE_TEMPLATE_EXPANSION_12,
} from './sourceTemplateExpansion12.js';
import { SEEDANCE_SOURCE_TEMPLATE_EXPANSION } from './sourceTemplateExpansion13.js';
import { SEEDANCE_200_TEMPLATE_METADATA } from './seedanceTemplateMetadata.js';
import { SEEDANCE_REFERENCE_CREDITS, SEEDANCE_REFERENCE_MODEL, takesReferenceModel } from './seedanceReference.js';
import { exactSourcePromptRecord } from './sourcePromptRecords.js';
import { sourcePromptAuditForModel, isPublishableSourcePromptTemplate } from './sourcePromptAudit.js';
import { fallbackCapabilitiesFor } from '../../../lib/fallbackModelCapabilities.js';

import { SOURCE_TEMPLATE_EXPANSION_6 } from './sourceTemplateExpansion6.js';
import { SOURCE_TEMPLATE_EXPANSION } from './sourceTemplateExpansion.js';
import { SOURCE_TEMPLATE_EXPANSION_2 } from './sourceTemplateExpansion2.js';
import { SOURCE_TEMPLATE_EXPANSION_3 } from './sourceTemplateExpansion3.js';
import { SOURCE_TEMPLATE_EXPANSION_4 } from './sourceTemplateExpansion4.js';
import { SOURCE_TEMPLATE_EXPANSION_5 } from './sourceTemplateExpansion5.js';

// Matched recipes inspected on 10 October 2026. Exact prompts are joined below;
// public template objects intentionally contain no source-platform names or URLs.
// Internal provenance is retained in docs/product/showcase-clips.md.
const AUDIT_SOURCE_TEMPLATES = [
  {
    "id": "product-hero-360", "name": "PRODUCT HERO 360", "clipKey": "product-hero-360",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "PRODUCTS", "isNew": true, "previewAspect": "482 / 720",
    "bg": "linear-gradient(180deg,#050505 0%,#17120e 58%,#a65b21 100%)", "needs": "A clean product image with the full object visible",
    "steps": ["Upload a clean product image with the complete object visible.", "Use this template to load the ten-second orbit prompt and settings.", "Review the product name and branding in the prompt before generating."],
    "inspired": true,
  },
  {
    "id": "miniature-crew-wall", "name": "MINIATURE CREW", "clipKey": "wall-product-hero-360",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "PRODUCTS", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(180deg,#14110d 0%,#4a3420 58%,#d7b779 100%)", "needs": "A clean product image with the full object visible",
    "steps": ["Upload a clean product image with the complete object visible.", "Use this template to load the miniature-crew prompt and settings.", "Review the product name and branding in the prompt before generating."],
    "inspired": true,
  },
  {
    "id": "medieval-runway-look", "name": "MEDIEVAL RUNWAY LOOK", "clipKey": "nano-banana-kie",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "keyboard-duo-swap", "name": "KEYBOARD DUO SWAP", "clipKey": "ace-step",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "720 / 540",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "One starting photo containing both characters in their intended positions",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "shadow-warriors", "name": "SHADOW WARRIORS", "clipKey": "cctv-night",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "REALISTIC", "isNew": true, "previewAspect": "720 / 406",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "One starting photo containing both characters in their intended positions",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "storm-starring", "name": "STORM STARRING", "clipKey": "neon-alley",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "UGC", "isNew": true, "previewAspect": "720 / 406",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "One starting photo showing the lead performer and backing group",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "epic-train-doorway-scene", "name": "EPIC TRAIN DOORWAY SCENE", "clipKey": "film-portrait",
    "model": "Seedance 2.0 Fast", "credits": 19, "durationSeconds": 5, "aspect": "9:16",
    "category": "MOVIES", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": null,

    "steps": ["Use this template to load its prompt and settings in the studio.", "Describe your characters and setting, then review the price before generating."],
    "inspired": true,
  },
  {
    "id": "fat-parkour", "name": "FAT PARKOUR", "clipKey": "talking-head",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "YOUR PHOTO", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "crazy-frog-race", "name": "CRAZY FROG RACE", "clipKey": "anime-hero",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "CARTOONS", "isNew": true, "previewAspect": "720 / 540",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "One starting photo containing both characters in their intended positions",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "the-push", "name": "THE PUSH", "clipKey": "portal-burst",
    "model": "Seedance 2.0 Fast", "credits": 19, "durationSeconds": 5, "aspect": "16:9",
    "category": "MOVIES", "isNew": true, "previewAspect": "720 / 406",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": null,

    "steps": ["Use this template to load its prompt and settings in the studio.", "Describe your characters and setting, then review the price before generating."],
    "inspired": true,
  },
  {
    "id": "dreamworks-castle", "name": "DREAMWORKS CASTLE", "clipKey": "floating-castle",
    "model": "Seedance 2.0 Fast", "credits": 19, "durationSeconds": 5, "aspect": "9:16",
    "category": "FANTASY", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": null,

    "steps": ["Use this template to load its prompt and settings in the studio.", "Describe your characters and setting, then review the price before generating."],
    "inspired": true,
  },
  {
    "id": "a-moment-between-strangers", "name": "A MOMENT BETWEEN STRANGERS", "clipKey": "wall-warm-portrait",
    "model": "Seedance 2.0 Fast", "credits": 19, "durationSeconds": 5, "aspect": "16:9",
    "category": "MOVIES", "isNew": true, "previewAspect": "720 / 540",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": null,

    "steps": ["Use this template to load its prompt and settings in the studio.", "Describe your characters and setting, then review the price before generating."],
    "inspired": true,
  },
  {
    "id": "the-last-stagecoach", "name": "THE LAST STAGECOACH", "clipKey": "wall-film-portrait",
    "model": "Seedance 2.0 Fast", "credits": 19, "durationSeconds": 5, "aspect": "16:9",
    "category": "MOVIES", "isNew": true, "previewAspect": "720 / 406",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": null,

    "steps": ["Use this template to load its prompt and settings in the studio.", "Describe your characters and setting, then review the price before generating."],
    "inspired": true,
  },
  {
    "id": "high-flip", "name": "HIGH FLIP", "clipKey": "wan-2.5-kie",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "world-morphing", "name": "WORLD MORPHING", "clipKey": "kling-26",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "street-colossus", "name": "STREET COLOSSUS", "clipKey": "presets",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "wild-ride", "name": "WILD RIDE", "clipKey": "sunset-drift",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "CINEMATIC", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "studio-slide", "name": "STUDIO SLIDE", "clipKey": "warm-portrait",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "FASHION", "isNew": true, "previewAspect": "600 / 450",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "cutout", "name": "CUTOUT", "clipKey": "clean-cutout",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "600 / 450",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "floating-fall", "name": "FLOATING FALL", "clipKey": "editorial-flatlay",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "PRODUCTS", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "eyes-in", "name": "EYES IN", "clipKey": "street-portrait",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "REALISTIC", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "smash-and-grab", "name": "SMASH AND GRAB", "clipKey": "packshot-studio",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "ADS", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "incline", "name": "INCLINE", "clipKey": "try-the-look",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "FASHION", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "selfception", "name": "SELFCEPTION", "clipKey": "ugc-unboxing",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "act-natural", "name": "ACT NATURAL", "clipKey": "miniature-city",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "CINEMATIC", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "lacewalker", "name": "LACEWALKER", "clipKey": "product-hero",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "PRODUCTS", "isNew": true, "previewAspect": "600 / 338",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "burning-man", "name": "BURNING MAN", "clipKey": "noir-one-sheet",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "FANTASY", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "melting", "name": "MELTING", "clipKey": "saturday-cartoon",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "600 / 600",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "frozen-in-motion", "name": "FROZEN IN MOTION", "clipKey": "photo-to-motion",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "YOUR PHOTO", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A starting image of a person already suspended mid-leap above a city sidewalk",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "fallen-angel", "name": "FALLEN ANGEL", "clipKey": "runway-walk",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "MOVIES", "isNew": true, "previewAspect": "360 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "monster-dab", "name": "MONSTER DAB", "clipKey": "anime-opening",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "CARTOONS", "isNew": true, "previewAspect": "600 / 450",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "lidar", "name": "LIDAR TRANSITION", "clipKey": "wall-cctv-night",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "406 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "boarding-pass", "name": "BOARDING PASS", "clipKey": "wall-sunset-drift",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "FASHION", "isNew": true, "previewAspect": "600 / 450",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "architecture-wave", "name": "ARCHITECTURE WAVE", "clipKey": "wall-neon-alley",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "clones", "name": "CLONES", "clipKey": "wall-talking-head",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "FASHION", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "vanish", "name": "VANISH", "clipKey": "wall-clean-cutout",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "540 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "bullet-time", "name": "BULLET TIME", "clipKey": "model-video",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "600 / 450",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "pearl-earring", "name": "PEARL EARRING", "clipKey": "model-image",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "360 / 720",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  {
    "id": "superstar", "name": "SUPERSTAR", "clipKey": "model-audio",
    "model": "Kling 3.0 · I2V", "credits": 32, "durationSeconds": 10,
    "category": "VFX", "isNew": true, "previewAspect": "600 / 600",
    "bg": "linear-gradient(135deg,#0a1a2c 0%,#25334b 60%,#344f55 100%)", "needs": "A clear starting photo showing the subject and setting you want to animate",
    "steps": ["Prepare your starting image using the guidance above.", "Use this template to load its prompt and settings in the studio.", "Upload your image, edit the prompt if needed, and review the price before generating."],
    "inspired": true,
  },
  ...SOURCE_TEMPLATE_EXPANSION,
  ...SOURCE_TEMPLATE_EXPANSION_2,
  ...SOURCE_TEMPLATE_EXPANSION_3,
  ...SOURCE_TEMPLATE_EXPANSION_4,
  ...SOURCE_TEMPLATE_EXPANSION_5,
  ...SOURCE_TEMPLATE_EXPANSION_7,
  ...SOURCE_TEMPLATE_EXPANSION_8,
  ...SOURCE_TEMPLATE_EXPANSION_9,
  ...SOURCE_TEMPLATE_EXPANSION_10,
  ...SOURCE_TEMPLATE_EXPANSION_11,

  ...SOURCE_TEMPLATE_EXPANSION_6,
];

const REPLACED_HIGGSFIELD_TEMPLATE_ID_SET = new Set(REPLACED_HIGGSFIELD_TEMPLATE_IDS);
const RUNNABLE_MODEL_IDS = Object.freeze({ 'Seedance 2.0 Fast': 'seedance-2.0-fast', 'Kling 3.0 · I2V': 'kling-3.0-i2v', [SEEDANCE_REFERENCE_MODEL]: 'seedance-2.0-reference' });

// Keep the old promptless Higgsfield recipes in the audit expansion files, but
// replace their public catalog positions one-for-one with same-record pairs
// whose exact prompt and video are both available from the community feed.
export const SOURCE_TEMPLATES = [
  ...AUDIT_SOURCE_TEMPLATES.filter(({ id }) => !REPLACED_HIGGSFIELD_TEMPLATE_ID_SET.has(id)),
  ...SOURCE_TEMPLATE_EXPANSION_12,
  ...SOURCE_TEMPLATE_EXPANSION_14,
  ...SYNTX_64_TEMPLATES,
  ...CATEGORY_FILL_TEMPLATES,
  ...HF_REPLACEMENTS_TEMPLATES,
  ...SYNTX_REPLACEMENTS_TEMPLATES,
  ...SEEDANCE_SOURCE_TEMPLATE_EXPANSION,
  ...SYNTX_100_VIDEO_TEMPLATES,
].map((template) => {
  const source = SEEDANCE_200_TEMPLATE_METADATA[template.id];
  const reference = takesReferenceModel(source);
  const metadata = source ? {
    ...template,
    model: reference ? SEEDANCE_REFERENCE_MODEL : source.runnableModel,
    credits: reference ? SEEDANCE_REFERENCE_CREDITS : source.runnableModel === 'Kling 3.0 · I2V' ? 32 : 19,
    durationSeconds: source.runnableModel === 'Kling 3.0 · I2V' ? 10 : 5,
    sourcePlatform: source.sourcePlatform,
    sourceModel: source.sourceModel,
    sourceUrl: source.sourceUrl,
  } : template;
  const promptMax = fallbackCapabilitiesFor(RUNNABLE_MODEL_IDS[metadata.model])?.inputs?.prompt?.max;
  const audit = sourcePromptAuditForModel(template.id, promptMax);
  const exact = isPublishableSourcePromptTemplate(template.id) ? exactSourcePromptRecord(template.id) : null;
  return {
    ...metadata,
    prompt: exact?.prompt ?? null,
    sourcePrompt: exact?.prompt ?? null,
    promptOrigin: exact ? 'community-source-exact' : null,
    sourcePromptOrigin: exact ? 'community-source-exact' : null,
    sourcePromptRunnable: audit.runnable,
    sourcePromptIssues: [...audit.issues],
    sourcePromptModelPromptMax: audit.modelPromptMax ?? null,
  };
});
