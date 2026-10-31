import { cinemaFeatures } from './cinema/features.js';
export const yourWinsEnabled = (env) => env?.YOUR_WINS_ENABLED === 'true';
const keys = ['first_image', 'first_video', 'creations_10', 'creations_50', 'first_post', 'first_cinema_upload', 'streak_7'];
const pick = (value, names) => Object.fromEntries(names.map(key => [key, value?.[key]]));
function period(value) {
    return { ...pick(value, ['video_seconds', 'credits_used', 'posts']),
        creations: { total: value?.creations?.total, by_type: pick(value?.creations?.by_type, ['image', 'video', 'audio', 'other']) },
        views: value?.views == null ? null : { total: value.views.total, networks: value.views.networks.filter(n => typeof n === 'string') } };
}
export function winsProjection(value, env) {
    const cinema = cinemaFeatures(env);
    return { ok: true, week_start: value.week_start, week: period(value.week), all: period(value.all),
        ...(env.CHECKIN_ENABLED === 'true' && value.streak ? { streak: pick(value.streak, ['current', 'best', 'last7']) } : {}),
        milestones: value.milestones.filter(m => keys.includes(m.key)
            && (m.key !== 'streak_7' || env.CHECKIN_ENABLED === 'true' && value.streak)
            && (m.key !== 'first_cinema_upload' || cinema.content && cinema.uploads))
            .map(m => pick(m, ['key', 'reached_at', 'progress', 'target'])) };
}
