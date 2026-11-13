// Verified against @mediapipe/tasks-vision 1.0.1 FACE_LANDMARKS_* exports.
// SDK brows are two open chains; polygon closure joins their endpoints.
export const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export const RIGHT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
export const LEFT_EYE = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
export const LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
export const RIGHT_BROW = [70,63,105,66,107,55,65,52,53,46];
export const LEFT_BROW = [336,296,334,293,300,276,283,282,295,285];

// Inner lip contour excludes lip colour; only bright, low-chroma pixels whiten.
export const INNER_LIPS = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
export function polygonFromLandmarks(points, indices, expansion = 1) {
    if (!(points instanceof Float32Array) || points.length !== 478 * 3) return [];
    const center = indices.reduce((c, i) => [c[0] + points[i * 3] / indices.length, c[1] + points[i * 3 + 1] / indices.length], [0, 0]);
    return indices.map(i => [center[0] + (points[i * 3] - center[0]) * expansion, center[1] + (points[i * 3 + 1] - center[1]) * expansion]);
}

export const RIGHT_UPPER_EYE = [33,246,161,160,159,158,157,173,133];
export const LEFT_UPPER_EYE = [263,466,388,387,386,385,384,398,362];
