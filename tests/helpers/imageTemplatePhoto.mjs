import { capabilityFor, publicCapabilities } from '../../lib/modelCapabilities.js';
import { fromApi } from '../../app/veyrnox/_lib/useCatalog.js';
import { IMAGE_TEMPLATES } from '../../app/veyrnox/_lib/imageTemplates.js';

export const ornament = IMAGE_TEMPLATES.find(preset => preset.id === 'christmas-tree-ornament');
export const ornamentCapability = capabilityFor('grsai:nano-banana-pro-edit');
// Simulated catalog price; capabilities come from the real server registry.
export const ornamentModel = fromApi([{ id: 'nano-banana-pro-edit-grsai', name: 'Nano Banana Pro Edit',
  modality: 'image-to-image', credits: 37, capabilities: publicCapabilities(ornamentCapability) }])[0];
export const photoKey = 'uploads/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png';
