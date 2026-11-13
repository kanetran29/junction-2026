/** Display names of the three demo families, keyed by category code (used by later tasks for messages). */
export const FAMILY_NAMES: Record<string, string> = { '10400': 'Drinking milk', '18750': 'Chicken', '10500': 'Butter' };

/** Ordered reviewed rules per demo category: the first pattern matching the lowercased name wins, else `fallback`. */
const RULES: Record<string, { rules: [RegExp, string][]; fallback: string }> = {
  '10400': {
    rules: [
      [/kahvimaito|cafè|café|cafe|barista/, 'coffee milk'],
      [/maitokahvijuoma|latte/, 'milk coffee drink'],
      [/piimä/, 'buttermilk'],
      [/annosmaito|x2 cl/, 'portion milk'],
      [/soygurt/, 'other'],
    ],
    fallback: 'drinking milk',
  },
  '18750': { rules: [[/rintafilee/, 'chicken breast fillet']], fallback: 'other poultry' },
  '10500': {
    rules: [
      [/kasvi/, 'plant spread'],
      [/kirkastettu|ruskistettu/, 'clarified butter'],
    ],
    fallback: 'butter',
  },
};

/**
 * Tags a product with its subtype from the reviewed name rules of the three demo families; every other
 * category gets no subtype and tagSource 'model' until the offline model tagging fills it in.
 */
export function tagSubtype(category: string, finnishName: string): { subtype: string | null; tagSource: 'reviewed' | 'model' } {
  const family = RULES[category];
  if (!family) return { subtype: null, tagSource: 'model' };
  const name = finnishName.toLowerCase();
  const hit = family.rules.find(([re]) => re.test(name));
  return { subtype: hit ? hit[1] : family.fallback, tagSource: 'reviewed' };
}

/** The subtype assumed when a buyer names only the category: drinking milk for 10400, none for the other families. */
export function defaultSubtype(category: string): string | null {
  return category === '10400' ? 'drinking milk' : null;
}
