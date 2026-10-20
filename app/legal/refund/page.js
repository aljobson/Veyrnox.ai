import LegalDocument, { legalMetadata } from '../_lib/LegalDocument';

export function generateMetadata() {
  return legalMetadata('refund');
}

export default function Page() {
  return LegalDocument({ document: 'refund' });
}
