import { imageSlots, imageTokens } from './templateBinding.js';

export function normaliseSwapRole(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9 '\-]+$/.test(value)) return null;
  const role = value.toLowerCase().trim().replace(/ +/g, ' ');
  return role.length >= 3 && role.length <= 60 && !/(?:^|[ '-])\d/.test(role) ? role : null;
}

// Conservative extraction: retain only a replace/change subject in the clause
// containing this slot. Ambiguous prose falls back for explicit owner review.
export function templateSwapRoles(prompt, override) {
  const source = String(prompt || ''), tokens = imageTokens(source);
  const roles = imageSlots(source).sort((a, b) => a - b).map(slot => {
    let role;
    for (const token of tokens.filter(token => token.number === slot)) {
      // Another image token closes its replacement clause, even on the same line.
      const previous = tokens[tokens.indexOf(token) - 1];
      const clause = source.slice(previous ? previous.offset + previous.token.length : 0, token.offset).split(/[.!?;\n]/).at(-1);
      const match = /\b(?:replace|change)\s+(the\s+.+?)\s+(?:with|to)\b/i.exec(clause)
        || /\b(the\s+original\s+.+?)(?:\s+in\s+@video\s*\d*)?\s+(?:(?:must|should)\s+be\s+|is\s+)?(?:fully\s+)?replaced\s+(?:by|with)\b/i.exec(clause);
      role = normaliseSwapRole(match?.[1]);
      if (role) break;
    }
    return { slot, role: role || 'the main character' };
  });
  const role = override === undefined ? roles[0]?.role || 'the main character' : normaliseSwapRole(override);
  if (!role) throw new Error('template_swap_role_invalid');
  return { role, roles, object_role_suspected: /\b(?:cars?|trucks?|bikes?|motorcycles?|motorbikes?|sportbikes?|vehicles?|drinks?|bottles?|products?|billboards?|bags?|outfits?|wardrobes?|logos?|clothing|shoes?|beverages?|cans?)\b/.test(role) };
}
