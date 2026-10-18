import { androidAssetLinks, associationResponse } from '../../../lib/mobileAppLinks.js';

export function GET() {
    return associationResponse(androidAssetLinks());
}
