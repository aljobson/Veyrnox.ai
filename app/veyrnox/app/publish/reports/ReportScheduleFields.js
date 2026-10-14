'use client';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ReportScheduleFields({ enabled, value, onChange }) {
  if (!enabled) return null;
  const change = (field, next) => onChange({ ...value, [field]: next });
  return <>
    <label className="text-sm font-bold">Automatic run
      <select aria-label="Automatic run" className={`${input} mt-1 block w-full`} value={value.deliveryCadence} onChange={(event) => change('deliveryCadence', event.target.value)}>
        <option value="manual">Manual only</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
      </select>
    </label>
    {value.deliveryCadence !== 'manual' && <>
      <label className="text-sm font-bold">Hour (UTC)
        <select aria-label="Hour (UTC)" className={`${input} mt-1 block w-full`} value={value.deliveryHourUtc} onChange={(event) => change('deliveryHourUtc', Number(event.target.value))}>
          {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
        </select>
      </label>
      {value.deliveryCadence === 'weekly' ? <label className="text-sm font-bold">Weekday
        <select aria-label="Weekday" className={`${input} mt-1 block w-full`} value={value.deliveryWeekday} onChange={(event) => change('deliveryWeekday', Number(event.target.value))}>
          {weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
        </select>
      </label> : <label className="text-sm font-bold">Day of month
        <select aria-label="Day of month" className={`${input} mt-1 block w-full`} value={value.deliveryDay} onChange={(event) => change('deliveryDay', Number(event.target.value))}>
          {Array.from({ length: 28 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select>
      </label>}
    </>}
  </>;
}
