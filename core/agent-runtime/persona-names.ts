export const CODENAMES: readonly string[] = [
  'Grey Honker',
  'Iron Beak',
  'Silent Wing',
  'Dark Feather',
  'Swift Migrant',
  'Bold Gosling',
  'Shadow Flock',
  'Crimson Plume',
  'Frost Gaggle',
  'Night Wader',
  'Copper Bill',
  'Ashen Glide',
  'Storm Preen',
  'Jade Gander',
  'Onyx Quill',
  'Tundra Drift',
  'Ember Waddle',
  'Cobalt Flap',
  'Phantom Crest',
  'Rogue Pinion',
  'Silver Down',
  'Marsh Glider',
  'Arctic Honk',
  'Dusk Preen',
  'Gilded Wing',
  'Sable Gosling',
  'Steel Migrate',
  'Amber Feather',
  'Mossy Beak',
  'Velvet Flock',
];

export const ROLE_ABBREV: Record<string, string> = {
  triager: 'TRG',
  developer: 'DEV',
  qa: 'QA',
  reviewer: 'REV',
  investigator: 'INV',
  decomposer: 'DEC',
  'prd-writer': 'PRD',
  researcher: 'RSR',
  retrospector: 'RET',
  griller: 'GRL',
};

export function generateCodename(totalSlots: number): string {
  return CODENAMES[totalSlots % CODENAMES.length];
}

export function getInitials(codename: string): string {
  return codename
    .split(' ')
    .map((w) => w[0])
    .join('');
}

export function formatPersonaLabel(codename: string, role: string): string {
  const abbrev = ROLE_ABBREV[role] ?? role.toUpperCase().slice(0, 3);
  return `${codename} (${abbrev})`;
}
