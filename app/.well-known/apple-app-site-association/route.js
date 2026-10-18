import { appleAppSiteAssociation, associationResponse } from '../../../lib/mobileAppLinks.js';

export function GET() {
    return associationResponse(appleAppSiteAssociation());
}
