import { PostHogProvider } from '@posthog/next';
import PostHogManager from './PostHogManager.jsx';
import { POSTHOG_CONSENT_KEY } from '../app/lib/analyticsPrivacy.js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
export const analyticsEnabled = Boolean(key?.startsWith('phc_'));

export default function AnalyticsProvider({ children }) {
  if (!analyticsEnabled) return children;

  return (
    <PostHogProvider
      apiKey={key}
      clientOptions={{
        api_host: '/ingest',
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-05-30',
        capture_pageview: false,
        capture_pageleave: false,
        // Sources that can emit before React effects run start disabled. The
        // manager installs URL redaction and enables them in one set_config.
        capture_exceptions: false,
        error_tracking: { exception_steps: { enabled: false } },
        autocapture: false,
        rageclick: false,
        mask_all_text: true,
        mask_all_element_attributes: true,
        mask_personal_data_properties: true,
        save_campaign_params: false,
        save_referrer: false,
        disable_capture_url_hashes: true,
        disable_session_recording: true,
        session_recording: {
          blockSelector: 'img, video, audio, canvas, iframe, [data-private], .ph-no-capture',
          maskTextSelector: '*',
          maskAllInputs: true,
          maskAllElementAttributes: true,
          collectFonts: false,
          recordCrossOriginIframes: false,
          recordHeaders: false,
          recordBody: false,
          captureCanvas: { recordCanvas: false },
          captureJsonLd: false,
          strictMinimumDuration: true,
          sampleRate: 0.2,
        },
        capture_performance: false,
        enable_recording_console_log: false,
        persistence: 'localStorage+cookie',
        cross_subdomain_cookie: false,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        opt_out_capturing_persistence_type: 'cookie',
        consent_persistence_name: POSTHOG_CONSENT_KEY,
        person_profiles: 'identified_only',
        advanced_disable_feature_flags: true,
        tracing_headers: [],
        ip: false,
      }}
      serverOptions={{ host: 'https://eu.i.posthog.com' }}
    >
      {children}
      <PostHogManager />
    </PostHogProvider>
  );
}
