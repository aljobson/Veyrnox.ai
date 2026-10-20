import LegalDocument, { legalMetadata } from '../_lib/LegalDocument';

export function generateMetadata() {
  return legalMetadata('privacy');
}

export default function Page() {
  return LegalDocument({ document: 'privacy' });
}
