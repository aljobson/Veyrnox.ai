import { ApiError, type ApiClient } from '../src/lib/api';
import { buildReportBody, deleteReport, emptyReportForm, formFromReport, parseReports, reportsErrorKey, saveReport, scheduleMode, type ReportForm } from '../src/lib/publishReports';
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const raw = { id, name: 'Report', account_id: id, include_content: false, report_title: 'Heading', accent_color: '#AABBCC',
    delivery_cadence: 'weekly', delivery_hour_utc: 23, delivery_weekday: 7, delivery_day: 28, delivery_recipients: ['a@example.com'],
    delivery_reply_to: 'reply@example.com', delivery_message: 'Hello', delivery_format: 'pptx', last_delivery_error: 'private' };
const report = parseReports({ templates: [raw] }).reports[0];
const valid = (): ReportForm => ({ ...emptyReportForm(), name: ' Report ' });
test('extends parsing, uses strict flags, validates colours, and bounds delivery fields', () => {
    expect(report).toMatchObject({ accountId: id, includeContent: false, reportTitle: 'Heading', accentColor: '#aabbcc',
        deliveryHourUtc: 23, deliveryWeekday: 7, deliveryDay: 28, deliveryRecipients: ['a@example.com'], deliveryReplyTo: 'reply@example.com',
        deliveryMessage: 'Hello', deliveryFormat: 'pptx', lastDeliveryError: 'private' });
    expect(parseReports({ brandRole: 'analyst', scheduledReportsEnabled: true, reportDeliveryEnabled: 'true' })).toMatchObject({ brandRole: 'analyst', scheduledReportsEnabled: true, reportDeliveryEnabled: false });
    const fallback = parseReports({ templates: [{ ...raw, accent_color: 'red', delivery_recipients: [1, ...Array(12).fill('a')], delivery_hour_utc: 24, delivery_weekday: 0, delivery_day: 29, delivery_format: 'exe' }] }).reports[0];
    expect(fallback).toMatchObject({ accentColor: '#38bdf8', deliveryHourUtc: null, deliveryWeekday: null, deliveryDay: null, deliveryFormat: 'pdf' });
    expect(fallback.deliveryRecipients).toHaveLength(10);
});
test.each([
    { name: '' }, { name: 'x'.repeat(81) }, { id: 'bad' }, { accountId: 'acc-1' }, { rangeDays: 8 }, { comparePrevious: 'true' },
    { includeContent: 1 }, { reportTitle: 'x'.repeat(101) }, { accentColor: '#fff' }, { deliveryCadence: 'daily' },
    { deliveryCadence: 'weekly', deliveryRecipients: [] },
    { deliveryCadence: 'weekly', deliveryRecipients: ['a@b.com'], deliveryHourUtc: 24 },
    { deliveryCadence: 'weekly', deliveryRecipients: ['a@b.com'], deliveryHourUtc: -1 },
    { deliveryCadence: 'weekly', deliveryRecipients: ['a@b.com'], deliveryHourUtc: 1.5 },
    { deliveryCadence: 'weekly', deliveryRecipients: ['a@b.com'], deliveryWeekday: 0 },
    { deliveryCadence: 'weekly', deliveryRecipients: ['a@b.com'], deliveryWeekday: 8 },
    { deliveryCadence: 'monthly', deliveryRecipients: ['a@b.com'], deliveryDay: 29 },
    { deliveryCadence: 'monthly', deliveryRecipients: ['a@b.com'], deliveryDay: 0 },
    { deliveryRecipients: Array.from({ length: 11 }, (_, i) => `${i}@example.com`) },
    { deliveryRecipients: ['no-email'] }, { deliveryRecipients: [''] }, { deliveryRecipients: [12] },
    { deliveryRecipients: ['x'.repeat(65) + '@example.com'] }, { deliveryReplyTo: 'invalid' }, { deliveryReplyTo: 'x'.repeat(255) },
    { deliveryMessage: 'x'.repeat(1001) }, { deliveryFormat: 'jpg' },
])('rejects fields refused by the route: %p', patch => expect(buildReportBody({ ...valid(), ...patch } as ReportForm).errorKey).toBeDefined());
test.each([7, 30, 90, 365])('accepts period %i and manual with no recipients', rangeDays => {
    expect(buildReportBody({ ...valid(), rangeDays }).body).toMatchObject({ name: 'Report', deliveryCadence: 'manual', deliveryRecipients: [], deliveryHourUtc: null, deliveryWeekday: null, deliveryDay: null });
});
test('normalises duplicate upper-case recipients, separators and reply-to', () => {
    expect(buildReportBody({ ...valid(), deliveryCadence: 'weekly', deliveryRecipients: ' ONE@Example.com; one@example.com, two@example.com\n', deliveryReplyTo: ' REPLY@Example.com ' }).body)
        .toMatchObject({ deliveryRecipients: ['one@example.com', 'two@example.com'], deliveryReplyTo: 'reply@example.com', deliveryWeekday: 1, deliveryDay: null });
    expect(buildReportBody({ ...valid(), deliveryCadence: 'monthly', deliveryRecipients: ['a@b.com'], deliveryDay: 28, deliveryHourUtc: 0 }).body).toBeDefined();
    expect(buildReportBody({ ...valid(), deliveryRecipients: Array(11).fill('a@b.com') }).body?.deliveryRecipients).toEqual(['a@b.com']);
});
test('save and delete use the existing route, JSON body and encoded id', async () => {
    const request = jest.fn().mockResolvedValue({ template_id: id }); const api = { request } as unknown as ApiClient;
    const body = buildReportBody(formFromReport(report)).body!;
    await saveReport(api, body);
    expect(request).toHaveBeenCalledWith('/api/v1/social/reports', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await deleteReport(api, 'id?&'); expect(request).toHaveBeenLastCalledWith('/api/v1/social/reports?id=id%3F%26', { method: 'DELETE' });
});
test.each([
    [400, 'invalid_body', 'publishReporting.err.fields'], [402, 'plan_required', 'reports.err.plan'], [403, 'forbidden', 'publishReporting.err.role'],
    [404, 'scheduled_reports_not_open', 'reports.err.notOpen'], [404, 'reports_not_open', 'reports.err.notOpen'], [404, 'report_not_found', 'publishReporting.err.unavailable'],
    [409, 'report_name_taken', 'publishReporting.err.nameTaken'], [409, 'report_limit', 'publishReporting.err.limit'], [409, 'other', 'reports.err.later'],
    [429, 'rate_limited', 'reports.err.rate'], [0, 'network', 'reports.err.network'], [502, 'internal', 'reports.err.later'],
] as const)('maps write error %s %s', (status, code, key) => {
    expect(reportsErrorKey(new ApiError(status, code), 'save')).toBe(key); expect(reportsErrorKey(new ApiError(status, code), 'delete')).toBe(key);
});
test.each([
    [true, true, 'weekly', true, false, true, true], [true, true, 'weekly', false, false, true, true],
    [true, false, 'weekly', true, false, true, false], [true, false, 'weekly', false, true, false, false],
    [false, true, 'weekly', true, true, false, false], [false, false, 'weekly', true, true, false, false],
    [true, true, 'manual', false, false, true, true], [true, false, 'manual', false, false, false, false],
    [false, true, 'manual', false, false, false, true], [false, false, 'manual', false, false, false, false],
] as const)('schedule mode: scheduling=%s delivery=%s cadence=%s recipients=%s', (scheduledReportsEnabled, reportDeliveryEnabled, cadence, recipients, readOnly, cadenceEditable, deliveryEditable) => {
    const mode = scheduleMode({ ...report, cadence, deliveryRecipients: recipients ? ['a@b.com'] : [] }, { scheduledReportsEnabled, reportDeliveryEnabled });
    expect(mode).toMatchObject({ readOnly, cadenceEditable, deliveryEditable });
    expect(mode.confirmationKey).toBe(reportDeliveryEnabled ? 'publishReporting.schedule.emailConfirm' : 'publishReporting.schedule.pendingConfirm');
});
test('a new report is manual only when delivery or scheduling is off', () => {
    expect(scheduleMode(null, { scheduledReportsEnabled: true, reportDeliveryEnabled: false })).toMatchObject({ readOnly: false, cadenceEditable: false });
});
