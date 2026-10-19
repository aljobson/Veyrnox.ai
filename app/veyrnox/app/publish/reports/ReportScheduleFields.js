'use client';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ReportScheduleFields({ enabled, deliveryEnabled, value, onChange }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const weekday = (day, index) => locale === 'en' ? day : new Intl.DateTimeFormat(localeTag(locale), {weekday: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(2026, 9, 19 + index)));
  const hourLabel = hour => locale === 'en' ? String(hour).padStart(2, '0') + ':00' : new Intl.DateTimeFormat(localeTag(locale), {hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'UTC'}).format(new Date(Date.UTC(2026, 9, 19, hour)));
  if (!enabled) return null;
  const change = (field, next) => onChange({ ...value, [field]: next });
  return <>
    <label className="text-sm font-bold">{t("app.publish.schedule.automatic")}<select aria-label={t("app.publish.schedule.automatic")} className={`${input} mt-1 block w-full`} value={value.deliveryCadence} onChange={(event) => change('deliveryCadence', event.target.value)}>
        <option value="manual">{t("app.publish.schedule.manual")}</option><option value="weekly">{t("app.publish.schedule.weekly")}</option><option value="monthly">{t("app.publish.schedule.monthly")}</option>
      </select>
    </label>
    {value.deliveryCadence !== 'manual' && <>
      <label className="text-sm font-bold">{t("app.publish.schedule.hour")}<select aria-label={t("app.publish.schedule.hour")} className={`${input} mt-1 block w-full`} value={value.deliveryHourUtc} onChange={(event) => change('deliveryHourUtc', Number(event.target.value))}>
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
        </select>
      </label>
      {value.deliveryCadence === 'weekly' ? <label className="text-sm font-bold">{t("app.publish.schedule.weekday")}<select aria-label={t("app.publish.schedule.weekday")} className={`${input} mt-1 block w-full`} value={value.deliveryWeekday} onChange={(event) => change('deliveryWeekday', Number(event.target.value))}>
          {weekdays.map((day, index) => <option key={day} value={index + 1}>{weekday(day, index)}</option>)}
        </select>
      </label> : <label className="text-sm font-bold">{t("app.publish.schedule.day")}<select aria-label={t("app.publish.schedule.day")} className={`${input} mt-1 block w-full`} value={value.deliveryDay} onChange={(event) => change('deliveryDay', Number(event.target.value))}>
          {Array.from({ length: 28 }, (_, index) => <option key={index + 1} value={index + 1}>{number(index + 1)}</option>)}
        </select>
      </label>}
      {deliveryEnabled ? <>
        <label className="text-sm font-bold sm:col-span-2">{t("app.publish.schedule.recipients")}<textarea required aria-label={t("app.publish.schedule.recipients")} rows={2} placeholder={t("app.publish.schedule.example")} className={`${input} mt-1 block w-full`} value={value.deliveryRecipients.join(', ')} onChange={(event) => change('deliveryRecipients', event.target.value.split(/[\s,;]+/).filter(Boolean))}/>
          <span className="mt-1 block text-xs font-normal text-vx-fg-muted">{t("app.publish.schedule.limit")}</span>
        </label>
        <label className="text-sm font-bold">{t("app.publish.schedule.format")}<select aria-label={t("app.publish.schedule.format")} className={`${input} mt-1 block w-full`} value={value.deliveryFormat} onChange={(event) => change('deliveryFormat', event.target.value)}><option value="pdf">{t("app.publish.schedule.pdf")}</option><option value="pptx">{t("app.publish.schedule.powerpoint")}</option></select>
        </label>
        <label className="text-sm font-bold">{t("app.publish.schedule.replyTo")}<input type="email" maxLength={254} className={`${input} mt-1 block w-full`} value={value.deliveryReplyTo} onChange={(event) => change('deliveryReplyTo', event.target.value)}/></label>
        <label className="text-sm font-bold sm:col-span-2">{t("app.publish.schedule.message")}<textarea rows={3} maxLength={1000} className={`${input} mt-1 block w-full`} value={value.deliveryMessage} onChange={(event) => change('deliveryMessage', event.target.value)}/></label>
      </> : <p className="text-sm text-vx-fg-muted sm:col-span-2">{t("app.publish.schedule.rollout")}</p>}
    </>}
  </>;
}
