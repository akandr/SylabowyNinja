// Registry of syllable sets. Easily extendable: add another entry below.
// A set is either { label, items: [...] } or { label, group: ['setId', ...] } (union).

export const SETS = {
  'p-basic': {
    label: 'sylaby 2-literowe z "p" (pa, po, pe…)',
    items: ['pa', 'po', 'pó', 'pe', 'pu', 'py', 'pi', 'pą', 'pę'],
  },
  'p-mixes-2': {
    label: 'pary sylab z "p" (papa, pepa, popo…)',
    // Curated practical pairs (kept short so it's recordable). Add more freely.
    items: [
      'papa', 'papo', 'pape', 'papu', 'papi', 'papy',
      'pepa', 'pepo', 'pepe', 'pepu', 'pepi',
      'popa', 'popo', 'pope', 'popi',
      'pupa', 'pupo', 'pupe', 'pupi',
      'pipa', 'pipi', 'pipo',
      'pypa', 'pypo',
    ],
  },
  'm-basic': {
    label: 'sylaby 2-literowe z "m" (ma, mo, me…)',
    items: ['ma', 'me', 'mi', 'mo', 'mu', 'my', 'mą', 'mę'],
  },
  'm-mixes-2': {
    label: 'pary sylab z "m" (mama, mami, mumu…)',
    // Must match the recorded .ogg files in /audio (built from
    // kacper_sounds/*.wav via tools/build_kacper_audio.sh).
    items: [
      'mama', 'mame', 'mami', 'mamo', 'mamu',
      'memu',
      'mima', 'mimi', 'mimo', 'mimu',
      'moma', 'mome', 'momi', 'momo', 'momu',
      'muma', 'mumi', 'mumu',
      'myma', 'mymy',
    ],
  },
  // Examples for future expansion (uncomment / add as needed):
  // 't-basic': { label: 'ta te ti to tu ty', items: ['ta','te','ti','to','tu','ty'] },
  // 'pt-group': { label: 'p + t (grupa)', group: ['p-basic', 't-basic'] },
};

export function resolveItems(setId) {
  const set = SETS[setId];
  if (!set) return [];
  if (set.items) return [...set.items];
  if (set.group) {
    const merged = new Set();
    for (const id of set.group) for (const it of resolveItems(id)) merged.add(it);
    return [...merged];
  }
  return [];
}

export function pickRandom(items, exclude = null) {
  const pool = exclude == null ? items : items.filter(x => x !== exclude);
  if (pool.length === 0) return items[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Homophone groups: syllables that sound identical and should be treated as
// interchangeable for both matching ("pu" tile counts when target is "pó")
// and audio (one shared sound file). Map each variant to its canonical form.
export const HOMOPHONES = {
  'pó': 'pu',
  'pu': 'pu',
};

export function canonical(text) {
  return HOMOPHONES[text] ?? text;
}

export function sameSound(a, b) {
  return canonical(a) === canonical(b);
}
