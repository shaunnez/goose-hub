import { fetchRoster } from '@/lib/api';
import type { PersonaStatDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PersonaDrillIn } from './PersonaDrillIn';

function qualityColor(score: number): string {
  if (score >= 0.8) return 'var(--success, #22c55e)';
  if (score >= 0.5) return 'var(--warning, #f59e0b)';
  return 'var(--danger, #ef4444)';
}

function PersonaCard({
  persona,
  isSelected,
  onClick,
}: {
  persona: PersonaStatDto;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="persona-card"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-3 rounded-md border transition-colors',
        isSelected
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-bg-elev/60 hover:bg-bg-elev hover:border-line',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[12.5px] font-medium text-fg truncate">{persona.personaName}</span>
        <span
          className="text-[11px] font-mono shrink-0"
          style={{ color: qualityColor(persona.avgQualityScore) }}
        >
          {Math.round(persona.avgQualityScore * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-fg-4">
        <span>{persona.runsTotal} runs</span>
        <span>·</span>
        <span>{timeAgo(persona.lastRunAt)}</span>
      </div>
    </button>
  );
}

function RoleGroup({
  role,
  personas,
  selectedPersona,
  onSelect,
}: {
  role: string;
  personas: PersonaStatDto[];
  selectedPersona: PersonaStatDto | null;
  onSelect: (p: PersonaStatDto) => void;
}) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wider text-fg-4 px-1 mb-2 capitalize">
        {role}
      </h2>
      <div className="flex flex-col gap-1.5">
        {personas.map((p) => (
          <PersonaCard
            key={p.id}
            persona={p}
            isSelected={selectedPersona?.id === p.id}
            onClick={() => onSelect(p)}
          />
        ))}
      </div>
    </section>
  );
}

export function RosterPage() {
  const [selectedPersona, setSelectedPersona] = useState<PersonaStatDto | null>(null);

  const {
    data: personas = [],
    isLoading,
    error,
  } = useQuery<PersonaStatDto[]>({
    queryKey: ['roster'],
    queryFn: fetchRoster,
  });

  const grouped: Record<string, PersonaStatDto[]> = {};
  for (const p of personas) {
    if (!grouped[p.role]) grouped[p.role] = [];
    grouped[p.role].push(p);
  }

  const roles = Object.keys(grouped).sort();

  return (
    <div data-testid="roster-page" className="flex h-full overflow-hidden">
      {/* Main list */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <h1 className="text-[15px] font-semibold mb-6">Roster</h1>

        {isLoading && <div className="text-fg-3 text-[13px]">Loading personas…</div>}

        {error && (
          <div className="text-[color:var(--danger)] text-[13px]">Failed to load roster.</div>
        )}

        {!isLoading && !error && personas.length === 0 && (
          <div data-testid="roster-empty-state" className="text-center text-fg-3 text-[13px] py-16">
            <p className="mb-2 font-medium text-fg-2">No personas yet</p>
            <p>Persona stats accumulate as agent runs complete.</p>
          </div>
        )}

        {!isLoading && !error && roles.length > 0 && (
          <div className="flex flex-col gap-8 ">
            {roles.map((role) => (
              <RoleGroup
                key={role}
                role={role}
                personas={grouped[role]}
                selectedPersona={selectedPersona}
                onSelect={setSelectedPersona}
              />
            ))}
          </div>
        )}
      </div>

      {/* Drill-in panel */}
      {selectedPersona && (
        <PersonaDrillIn persona={selectedPersona} onClose={() => setSelectedPersona(null)} />
      )}
    </div>
  );
}
