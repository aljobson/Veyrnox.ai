import en from './messages/en';
import { fill, type Vars } from './translate';

// ADR-0270: these statements are versioned or form part of purchase/rights consent.
// This explicit list also exempts them from the catalog translation-equality check.
export const BINDING_ENGLISH_KEYS = [
    'signIn.agree',
    'aiConsent.body',
    'aiConsent.tomakeyourcreationsandansweryour',
    'aiConsent.theyuseitonlytoproduceyour',
    'billing.perRenewsautomaticallyeachuntilyoucancel',
    'form.sourceRights',
    'form.consent',
    'features.ihavepermissiontousethesesources',
    'features.ihavepermissiontousethesesources2',
    'faceFilters.rights',
    'faceFilters.privacy',
    'deleteaccount.thiserasesyouraccountandwhatis',
    'publishUploads.rights',
    'cinemaDrafts.thistitlecontainsnonuditypornographyexplicit',
] as const satisfies readonly (keyof typeof en)[];

// Website catalogs stay verbatim. These permission disclosures select English only
// at the binding control, without replacing their translated website catalog values.
export const WEBSITE_BINDING_ENGLISH_KEYS = [
    'oauth.summary',
    'oauth.summaryPublish',
    'oauth.models',
    'oauth.estimate',
    'oauth.limit',
    'oauth.video',
    'oauth.assets',
    'oauth.publishAccess',
    'oauth.password',
    'oauth.restrictions',
    'oauth.restrictionsPublish',
    'oauth.revoke',
] as const satisfies readonly (keyof typeof en)[];

// English substitutions are selected explicitly by each statement builder. Do not use
// localized number formatting here; the store's priceString is passed through untouched.
export const english = (key: keyof typeof en, vars?: Vars): string => fill(en[key], vars);
