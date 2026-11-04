import { getCloudflareContext } from '@opennextjs/cloudflare';
import { environmentLabel } from '../packages/security/environmentLabel.js';

// Operator-only strip (admin pages). It sits in normal flow above the page: the app's own
// header is sticky (z-40) and a sticky banner here would cover it.
// It reads the Worker's APP_ENV at request
// time, so a staging build can never show "PRODUCTION" and the reverse.
// Production and unknown use the danger colour; staging uses the warning
// colour; local is neutral. The word is always shown, so colour is not the
// only signal.
const TONE = {
    production: 'border-vx-danger text-vx-danger',
    unknown: 'border-vx-danger text-vx-danger',
    staging: 'border-vx-warn text-vx-warn',
    local: 'border-vx-fg-faint text-vx-fg-muted',
};

// The Worker's own bindings for this request; null where there is no Worker (next dev, unit tests).
function runtimeBindings() {
    try {
        const { env } = getCloudflareContext();
        return { appEnv: env && env.APP_ENV, supabaseUrl: env && env.SUPABASE_URL };
    } catch {
        return null;
    }
}

export default function EnvironmentBanner() {
    const { kind, label, detail } = environmentLabel(process.env.APP_ENV, process.env.SUPABASE_URL, runtimeBindings());
    return (
        <div
            role="status"
            data-environment={kind}
            className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 bg-vx-base px-4 py-2 text-sm sm:px-8 ${TONE[kind]}`}
        >
            <strong className="font-mono text-xs font-bold tracking-widest">{label}</strong>
            <span>{detail}</span>
        </div>
    );
}
