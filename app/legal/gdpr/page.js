import LegalDocument, { legalMetadata } from '../_lib/LegalDocument';

export function generateMetadata() {
  return legalMetadata('gdpr');
}

export default function Page() {
  return LegalDocument({ document: 'gdpr' });
}
