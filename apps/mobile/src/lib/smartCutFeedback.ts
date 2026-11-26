import type { ApiClient } from './api';

export const SMART_CUT_FEEDBACK_PATH = '/api/v1/editor/smart-cut-feedback';
export const SMART_CUT_FEEDBACK_COMMENT_MAX = 1000;
export type SmartCutFeedbackRating = 'up' | 'down';
export type SmartCutFeedbackMode = 'local-preview' | 'transcript-silence';

export async function submitSmartCutFeedback(api: Pick<ApiClient, 'request'>, input: {
    readonly responseId: string;
    readonly rating: SmartCutFeedbackRating;
    readonly comment?: string;
    readonly planMode: SmartCutFeedbackMode;
}) {
    const comment = input.comment?.trim();
    return api.request<{ accepted: boolean; replayed: boolean }>(SMART_CUT_FEEDBACK_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            response_id: input.responseId,
            rating: input.rating,
            ...(comment ? { comment: comment.slice(0, SMART_CUT_FEEDBACK_COMMENT_MAX) } : {}),
            plan_mode: input.planMode,
        }),
    });
}
