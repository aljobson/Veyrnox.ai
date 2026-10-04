import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWindow,dateKey,shiftCalendar,localInput,localSchedule,droppedSchedule,instant } from '../lib/social/calendar.js';
import { calendarEnabled } from '../lib/social/publishFeature.js';

test('month grid covers six Monday-first weeks and week follows the selected day',()=>{
    const r=calendarWindow('2026-10-04','month');
    assert.equal(r.days.length,42);assert.equal(r.days[0],'2026-09-28');assert.equal(r.days.at(-1),'2026-11-08');
    assert.equal(calendarWindow('2026-10-04','week').days[0],'2026-09-28');
    assert.equal(shiftCalendar('2026-01-31','month',1),'2026-02-01');
    assert.equal(shiftCalendar('2026-10-04','week',1),'2026-10-11');
});
test('local scheduling rejects date rollover, malformed dates and spring DST gaps',()=>{
    const old=process.env.TZ;process.env.TZ='America/New_York';
    try {
        assert.equal(localSchedule('2026-02-31T10:00'),null);
        assert.equal(localSchedule('2026-03-08T02:30'),null);
        assert.equal(localSchedule('2026-03-08T03:30'),'2026-03-08T07:30:00.000Z');
        const r=calendarWindow('2026-03-08','week');
        assert.equal((Date.parse(r.to)-Date.parse(r.from))/3600000,167);
        assert.equal(dateKey('2026-03-09T01:00:00Z'),'2026-03-08');
        assert.equal(localInput('2026-10-04T15:30:00Z'),'2026-10-04T11:30');
        assert.equal(droppedSchedule({scheduled_at:'2026-10-04T15:30:00Z'},'2026-10-07'),'2026-10-07T11:30');
    }finally {if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('instant validation requires a timezone and rejects impossible calendar dates',()=>{
    assert.equal(instant('2026-10-04T10:00:00Z'),true);
    assert.equal(instant('2026-10-04T10:00:00.123456+00:00'),true);
    assert.equal(instant('2026-10-04T10:00:00+01:00'),true);
    for(const v of [null,'2026-02-31T10:00:00Z','2026-10-04T10:00','infinity'])assert.equal(instant(v),false);
});
test('calendar is opt-in for exact true only',()=>{
    for(const v of [undefined,'false','TRUE',true])assert.equal(calendarEnabled({PUBLISH_CALENDAR_ENABLED:v}),false);
    assert.equal(calendarEnabled({PUBLISH_CALENDAR_ENABLED:'true'}),true);
});
