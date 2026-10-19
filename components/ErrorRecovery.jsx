'use client';
import { useI18n } from './I18nProvider';

import { Main } from '../app/veyrnox/_components/Main';

// This fallback also renders without the root layout, styles or providers.
export default function ErrorRecovery({ retry }) {
  const { t, href } = useI18n();
  const linkStyle = { color: '#d4e86c', textUnderlineOffset: '4px' };
  return (
    <Main style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#0a0a0b', color: '#fafafa', padding: '64px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <a href={href('/')} style={{ ...linkStyle, fontSize: '20px', fontWeight: 800 }}>Veyrnox.ai</a>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 48px)', lineHeight: 1.15, marginTop: '64px' }}>{t('recovery.title')}</h1>
        <p style={{ color: '#d1d1d6', fontSize: '17px', lineHeight: 1.6 }}>{t('recovery.body')}</p>
        <button type="button" onClick={() => retry()} style={{ background: '#d4e86c', color: '#10110a', border: 0, borderRadius: '999px', padding: '12px 24px', font: 'inherit', fontWeight: 700, cursor: 'pointer', margin: '16px 0 24px' }}>{t('recovery.retry')}</button>
        <nav aria-label={t('recovery.nav')} style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
          <a href="/app/library" style={linkStyle}>{t('recovery.library')}</a>
          <a href={href('/')} style={linkStyle}>{t('recovery.home')}</a>
        </nav>
      </div>
    </Main>
  );
}
