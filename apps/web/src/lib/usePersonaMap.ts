import { useQuery } from '@tanstack/react-query';
import { fetchRoster } from './api.js';
import type { PersonaStatDto } from './types.js';

export interface PersonaInfo {
  codename: string;
  role: string;
}

export type PersonaMap = Record<string, PersonaInfo>;

export function usePersonaMap(): PersonaMap {
  const { data: personas = [] } = useQuery<PersonaStatDto[]>({
    queryKey: ['roster'],
    queryFn: fetchRoster,
    staleTime: 60_000,
  });

  const map: PersonaMap = {};
  for (const p of personas) {
    if (p.codename != null) {
      map[p.personaName] = { codename: p.codename, role: p.role };
    }
  }
  return map;
}

export function getPersonaLabel(map: PersonaMap, personaId: string | null | undefined): string | null {
  if (personaId == null) return null;
  const info = map[personaId];
  if (info == null) return null;
  const abbrev = ROLE_ABBREV[info.role] ?? info.role.toUpperCase().slice(0, 3);
  return `${info.codename} (${abbrev})`;
}

export function getPersonaInitials(map: PersonaMap, personaId: string | null | undefined): string | null {
  if (personaId == null) return null;
  const info = map[personaId];
  if (info == null) return null;
  return info.codename
    .split(' ')
    .map((w) => w[0])
    .join('');
}

const ROLE_ABBREV: Record<string, string> = {
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
