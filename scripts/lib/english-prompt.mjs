// Owner rule (2026-11-15): listed templates carry English prompts only. A cheap, explicit check, not language
// detection: any non-Latin script fails, and Latin text must use clearly more English than common foreign function
// words. Photo tokens (@image1, <<<image_1>>>) and punctuation are ignored. Reviewed by hand at import time too.
const ENGLISH = new Set(('the a an and with in of to on is are be keep his her their this that from same video character main '
  + 'person replace change make as for at by it into all only do not no image use your my me him she he they them its '
  + 'photo picture reference face background scene camera').split(' '));
const FOREIGN = new Set(('der die das den dem mit und ist ein eine nicht ersetze ve bir ile bu bu da olsun diğerleri de la el los '
  + 'las y con que por para una del al du le les et avec pour des est il che per della sostituisci reemplaza mantene '
  + 'substitui matenha mantenha você zamen coloque o personagem da do lugar como em uma um não sem seu sua thay nhân vật trong bằng và của là có cho với').split(' '));
// Vietnamese and similar scripts use Latin Extended Additional letters (U+1EA0-U+1EFF) throughout.
const VIETNAMESE = /[\u1EA0-\u1EFF]/u;
// Latin, punctuation, arrows, symbols and emoji are allowed; any other script is not English.
const NON_LATIN = /[^\u0000-ɏḀ-ỿ -⁯₠-⃏℀-⇿←-⏿①-➿⬀-⯿️\u{1F000}-\u{1FAFF}]/u;

export function isEnglishPrompt(prompt) {
  const text = String(prompt || '').replace(/<<<[^>]*>>>|@(?:image|video)\s*[_-]?\d*/gi, ' ');
  if (NON_LATIN.test(text) || VIETNAMESE.test(text)) return false;
  const words = text.toLowerCase().match(/[a-zÀ-ɏ]+/g) || [];
  const english = words.filter(word => ENGLISH.has(word)).length;
  const foreign = words.filter(word => FOREIGN.has(word)).length;
  return english >= 2 && english > foreign * 2;
}
