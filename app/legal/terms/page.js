import LegalDocument, { legalMetadata } from '../_lib/LegalDocument';

export function generateMetadata() {
  return legalMetadata('terms');
}

export default function Page() {
  return LegalDocument({ document: 'terms' });
}
