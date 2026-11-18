// A fixed palette of 12 colors, one chosen per person (Settings > Users). Pure, so the screens and the tests agree.
// Each color has a dark enough shade that white text on it is readable. `color` on a staff row holds the key. The database gives
// every person one when they are added (the first palette color nobody else has) and gave everyone existing one when it was set up;
// the colors in this list are in that order, most different first. `colorFor` still copes with a blank, in case.
//
// A person's color is used inside the app only (schedule, chat, activity). It never appears on anything customer-facing.

export const USER_COLORS = [
  { key: 'blue', label: 'Blue', hex: '#2f4fc4' },
  { key: 'orange', label: 'Orange', hex: '#b9560a' },
  { key: 'green', label: 'Green', hex: '#1f7a43' },
  { key: 'purple', label: 'Purple', hex: '#7a3fb5' },
  { key: 'red', label: 'Red', hex: '#c0392b' },
  { key: 'teal', label: 'Teal', hex: '#0b7a75' },
  { key: 'gold', label: 'Gold', hex: '#8a6d00' },
  { key: 'magenta', label: 'Magenta', hex: '#a8328f' },
  { key: 'sky', label: 'Sky', hex: '#1b6fa8' },
  { key: 'lime', label: 'Lime', hex: '#4c7a0a' },
  { key: 'rose', label: 'Rose', hex: '#c2305f' },
  { key: 'slate', label: 'Slate', hex: '#4a5568' },
];
export const USER_COLOR_KEYS = USER_COLORS.map((c) => c.key);
export const isColorKey = (k) => USER_COLOR_KEYS.includes(k);
const byKey = new Map(USER_COLORS.map((c) => [c.key, c]));

// The first palette color that no one in `staff` has picked (a row with no pick takes its turn by position in the list).
// Falls back to the first color when all twelve are taken.
export function autoColorKey(staff, forId = null) {
  const used = new Set((staff || []).filter((s) => s.id !== forId && isColorKey(s.color)).map((s) => s.color));
  return USER_COLOR_KEYS.find((k) => !used.has(k)) || USER_COLOR_KEYS[0];
}

// The color a person shows in. A saved pick wins; a person with none gets a stable automatic color (the unused colors are
// handed out in the order the people were added, so it does not change from screen to screen).
export function colorFor(person, staff = []) {
  if (person && isColorKey(person.color)) return byKey.get(person.color);
  const ordered = [...(staff || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  const taken = new Set(ordered.filter((s) => isColorKey(s.color)).map((s) => s.color));
  const free = USER_COLOR_KEYS.filter((k) => !taken.has(k));
  const unpicked = ordered.filter((s) => !isColorKey(s.color));
  const i = unpicked.findIndex((s) => s.id === person?.id);
  const key = free.length && i >= 0 ? free[i % free.length] : USER_COLOR_KEYS[Math.max(i, 0) % USER_COLOR_KEYS.length];
  return byKey.get(key);
}
export const colorHex = (person, staff) => colorFor(person, staff).hex;

// The color a visit or label shows for a tech id, from a list of staff rows ({ id, color }); grey for no one.
export const UNASSIGNED_COLOR = '#6b7686';
export const techColorOf = (staff, id) => {
  if (!id) return UNASSIGNED_COLOR;
  const p = (staff || []).find((s) => s.id === id);
  return p ? colorFor(p, staff).hex : colorFor({ id }, [{ id }]).hex;
};
