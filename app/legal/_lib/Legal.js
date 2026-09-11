import Link from 'next/link';

export const ENTITY = {
    name: 'Veyrnox Ltd',
    trading: 'Veyrnox.ai',
    companyNo: '17299951',
    jurisdiction: 'England & Wales',
    office: 'Suite RA01, 195-197 Wood Street, London, England, E17 3NU',
    email: 'legal@veyrnox.ai',
    privacyEmail: 'privacy@veyrnox.ai',
    updated: '11 September 2026',
};

export function LegalPage({ title, children }) {
    return (
        <main className="min-h-dvh bg-vx-base text-vx-fg">
            <div className="max-w-[760px] mx-auto px-6 py-16">
                <Link href="/" className="text-[12px] text-vx-fg-muted hover:text-vx-fg">← Veyrnox.ai</Link>
                <h1 className="font-vx font-extrabold text-[36px] leading-tight mt-6 mb-2">{title}</h1>
                <p className="text-[12px] text-vx-fg-muted mb-10">
                    {ENTITY.name} (trading as {ENTITY.trading}) · Company no. {ENTITY.companyNo} · Last updated {ENTITY.updated}
                </p>
                <div className="space-y-8 text-[15px] leading-relaxed text-vx-fg-body [&_h2]:font-vx [&_h2]:font-bold [&_h2]:text-[20px] [&_h2]:text-vx-fg [&_h2]:mt-10 [&_h2]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-vx-accent [&_a]:underline">
                    {children}
                </div>
                <nav className="mt-16 pt-6 border-t border-vx-border text-[12px] text-vx-fg-muted flex flex-wrap gap-4">
                    <Link href="/legal/terms">Terms</Link>
                    <Link href="/legal/privacy">Privacy</Link>
                    <Link href="/legal/refund">Refunds</Link>
                    <Link href="/legal/gdpr">GDPR &amp; Data Rights</Link>
                </nav>
            </div>
        </main>
    );
}
