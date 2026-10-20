'use client';
import BindingText, { BindingPolicyLink } from '../../../components/BindingText';
import { useI18n } from '../../../components/I18nProvider';


export default function SourceRightsConfirmation({ confirmed, onChange }) {
  const { t } = useI18n();
  return <section data-assistant-target="create.consent" className="scroll-mt-24 mt-3 rounded-lg border border-vx-border bg-vx-panel px-4 py-3 text-sm text-vx-fg-body">
    <label htmlFor="create-source-rights" className="flex min-h-11 cursor-pointer items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center">
        <input id="create-source-rights" data-testid="create-source-rights" type="checkbox"
          checked={confirmed} onChange={event => onChange(event.target.checked)}
          aria-describedby="create-source-rights-status" className="h-5 w-5 accent-vx-accent" />
      </span>
      <BindingText id="sourceRights"  slots={{ policy: <BindingPolicyLink policy="aup" /> }}><span lang="en" dir="ltr" className="py-2">
        I own this file, or I have the permission of everyone identifiable in it. No real person&apos;s face, body or
        voice is used without their consent, and I hold the rights to any brand, artwork or recording in it
        (<a href="/legal/aup" target="_blank" rel="noreferrer" className="text-vx-accent underline">Acceptable Use</a>).
        This statement is recorded against the generation and your account.
      </span></BindingText>
    </label>
    <p id="create-source-rights-status" role="status" data-testid="create-source-rights-status" data-confirmed={confirmed}
      className={`mt-2 text-xs ${confirmed ? 'text-vx-accent' : 'text-vx-fg-muted'}`}>
      {confirmed ? t("app.create.rights.confirmed") : t("app.create.rights.unconfirmed")}
    </p>
    <p className="mt-1 text-[11px] text-vx-fg-muted">{t("app.create.rights.help")}</p>
  </section>;
}
