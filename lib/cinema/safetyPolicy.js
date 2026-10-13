export const CINEMA_POLICY_VERSION = 'cinema-safety-2026-10-13';

// Veyrnox audience labels are guidance for viewers. They are not BBFC ratings.
export const CINEMA_RATINGS = Object.freeze([
  ['ALL', 'All ages'],
  ['PG', 'Parental guidance'],
  ['12', '12+'],
  ['15', '15+'],
  ['18', '18+'],
]);

export const CINEMA_WARNING_CODES = Object.freeze([
  ['violence', 'Violence'],
  ['graphic_violence', 'Graphic violence'],
  ['strong_language', 'Strong language'],
  ['sex_references', 'Sex references'],
  ['drugs', 'Drugs'],
  ['horror', 'Horror or threat'],
  ['self_harm', 'Self-harm or suicide'],
  ['discrimination', 'Discrimination'],
  ['flashing_images', 'Flashing images'],
]);

const ratingCodes = new Set(CINEMA_RATINGS.map(([code]) => code));
const warningCodes = new Set(CINEMA_WARNING_CODES.map(([code]) => code));

export function validCinemaRating(value) {
  return typeof value === 'string' && ratingCodes.has(value);
}

export function validCinemaWarnings(value) {
  return Array.isArray(value) && value.length <= CINEMA_WARNING_CODES.length
    && new Set(value).size === value.length
    && value.every((warning) => typeof warning === 'string' && warningCodes.has(warning));
}

export function cinemaSafetyPassed(item) {
  return ['content', 'child_safety', 'malware'].every((key) => item?.[`${key}_status`] === 'passed');
}
