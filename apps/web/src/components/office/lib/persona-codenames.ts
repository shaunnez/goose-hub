// Deterministic stand-in persona names for v1, where the server does not yet
// emit a personaId. Seed is "${projectSlug}:${externalId}" so the same issue
// always gets the same codename within a session.
//
// No Phaser imports. No randomness. Pure derivation.

export const CODENAME_POOL: readonly string[] = [
  'Grey Honker',
  'Cinder Drake',
  'Pale Tern',
  'Brass Magpie',
  'Iron Skua',
  'Slate Pelican',
  'Amber Heron',
  'Rust Cormorant',
  'Teal Gannet',
  'Olive Plover',
  'Sage Finch',
  'Dusk Egret',
  'Flint Lapwing',
  'Moss Kite',
  'Ochre Avocet',
  'Storm Godwit',
  'Cedar Curlew',
  'Chalk Merlin',
  'Dun Grebe',
  'Ash Dunlin',
  'Coal Stint',
  'Birch Wader',
  'Ember Snipe',
  'Clay Wigeon',
  'Fern Teal',
  'Jade Scoter',
  'Peat Gadwall',
  'Bronze Pintail',
  'Umber Pochard',
  'Granite Shoveler',
] as const;

/**
 * Deterministic codename derived from an arbitrary seed string.
 * Uses 32-bit FNV-1a hash → index into CODENAME_POOL.
 * Same seed always returns the same name; no randomness.
 */
export function codenameFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return CODENAME_POOL[hash % CODENAME_POOL.length];
}
