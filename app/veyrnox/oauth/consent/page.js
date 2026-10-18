import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { OAuthConsent } from './OAuthConsent';
import { publishAutomationEnabled } from '../../../../lib/social/publishFeature.js';

export const metadata = {
  title: 'Connect an assistant',
  robots: { index: false, follow: false },
};

export default async function OAuthConsentPage({ searchParams }) {
  const params = await searchParams;
  const authorizationId = typeof params?.authorization_id === 'string' ? params.authorization_id : '';
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[680px] mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-24">
        <OAuthConsent key={authorizationId} authorizationId={authorizationId} publishOpen={publishAutomationEnabled()} />
      </Main>
    </div>
  );
}
