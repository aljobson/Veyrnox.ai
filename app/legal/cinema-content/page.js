import LegalDocument, { legalMetadata } from '../_lib/LegalDocument';

export function generateMetadata() {
  return legalMetadata('cinema-content');
}

export default function Page() {
  return LegalDocument({ document: 'cinema-content' });
}
