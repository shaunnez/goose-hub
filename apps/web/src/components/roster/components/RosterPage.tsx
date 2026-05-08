import { fetchProjectConfigs, fetchRoster } from '@/lib/api';
import type { PersonaStatDto, ProjectConfigDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PersonaDrillIn } from './PersonaDrillIn';
import { PlaybooksTab } from './PlaybooksTab';
import { QualityTrendTab } from './QualityTrendTab';

// Extracts the project slug from a persona name in the format "<slug>/<role>/<index>"
export function personaProjectSlug(personaName: string): string {
  const parts = personaName.split('/');
  return parts.length >= 3 ? (parts[0] ?? '') : '';
}

function qualityColor(score: number): string {
  if (score >= 0.8) return 'var(--success, #22c55e)';
  if (score >= 0.5) return 'var(--warning, #f59e0b)';
  return 'var(--danger, #ef4444)';
}

function PersonaCard({
  persona,
  isSelected,
  onClick,
  projectColor,
  projectName,
}: {
  persona: PersonaStatDto;
  isSelected: boolean;
  onClick: () => void;
  projectColor?: string;
  projectName?: string;
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
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-[12.5px] font-medium text-fg truncate">
          {persona.codename ?? persona.personaName}
        </span>
        <span
          className="text-[11px] font-mono shrink-0"
          style={{ color: qualityColor(persona.avgQualityScore) }}
        >
          {Math.round(persona.avgQualityScore * 100)}%
        </span>
      </div>
      {persona.codename != null && (
        <div className="text-[10.5px] text-fg-5 font-mono truncate mb-1">{persona.personaName}</div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[11px] text-fg-2">
          <span>{persona.runsTotal} runs</span>
          <span>·</span>
          <span>{timeAgo(persona.lastRunAt)}</span>
        </div>
        {projectColor != null && projectName != null && (
          <span
            data-testid="roster-project-badge"
            className="flex items-center gap-1 text-[10.5px] text-fg-2 shrink-0"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: projectColor }}
            />
            {projectName}
          </span>
        )}
      </div>
    </button>
  );
}

function RoleGroup({
  role,
  personas,
  selectedPersona,
  onSelect,
  colorMap,
  nameMap,
  showProjectBadge,
}: {
  role: string;
  personas: PersonaStatDto[];
  selectedPersona: PersonaStatDto | null;
  onSelect: (p: PersonaStatDto) => void;
  colorMap: Map<string, string>;
  nameMap: Map<string, string>;
  showProjectBadge: boolean;
}) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-wider text-fg-2 px-1 mb-2 capitalize">
        {role}
      </h2>
      <div className="flex flex-col gap-1.5">
        {personas.map((p) => {
          const slug = personaProjectSlug(p.personaName);
          return (
            <PersonaCard
              key={p.id}
              persona={p}
              isSelected={selectedPersona?.id === p.id}
              onClick={() => onSelect(p)}
              projectColor={showProjectBadge ? colorMap.get(slug) : undefined}
              projectName={showProjectBadge ? nameMap.get(slug) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

export function RosterPage() {
  const params = useParams<{ slug?: string }>();
  const projectSlug = params.slug ?? 'goose-hub-self';
  const [activeTab, setActiveTab] = useState<'personas' | 'playbooks' | 'quality-trend'>(
    'personas',
  );
  const [selectedPersona, setSelectedPersona] = useState<PersonaStatDto | null>(null);
  const [projectScope, setProjectScope] = useState<'all' | string>('all');

  const {
    data: personas = [],
    isLoading,
    error,
  } = useQuery<PersonaStatDto[]>({
    queryKey: ['roster'],
    queryFn: fetchRoster,
  });

  const { data: projectConfigs = [] } = useQuery<ProjectConfigDto[]>({
    queryKey: ['project-configs'],
    queryFn: ({ signal }) => fetchProjectConfigs(signal),
  });

  const colorMap = new Map(projectConfigs.map((p) => [p.slug, p.colorStripe]));
  const nameMap = new Map(projectConfigs.map((p) => [p.slug, p.name]));

  const filteredPersonas =
    projectScope === 'all'
      ? personas
      : personas.filter((p) => personaProjectSlug(p.personaName) === projectScope);

  const grouped: Record<string, PersonaStatDto[]> = {};
  for (const p of filteredPersonas) {
    if (!grouped[p.role]) grouped[p.role] = [];
    grouped[p.role].push(p);
  }

  const roles = Object.keys(grouped).sort();

  if (activeTab === 'playbooks') {
    return (
      <div data-testid="roster-page" className="flex flex-col h-full overflow-hidden">
        <RosterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 min-h-0 overflow-hidden">
          <PlaybooksTab projectSlug={projectSlug} />
        </div>
      </div>
    );
  }

  if (activeTab === 'quality-trend') {
    return (
      <div data-testid="roster-page" className="flex flex-col h-full overflow-hidden">
        <RosterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 min-h-0 overflow-hidden">
          <QualityTrendTab projectSlug={projectSlug} />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="roster-page" className="flex flex-col h-full overflow-hidden">
      <RosterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Main list */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <h1 className="text-[15px] font-semibold mb-3">Roster</h1>

          {/* Project filter */}
          {projectConfigs.length > 0 && (
            <div className="flex items-center gap-1.5 mb-5 flex-wrap" data-testid="project-filter">
              <button
                type="button"
                data-testid="filter-all"
                onClick={() => setProjectScope('all')}
                className={[
                  'px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors border',
                  projectScope === 'all'
                    ? 'bg-accent-soft text-fg border-accent'
                    : 'text-fg-3 hover:text-fg hover:bg-bg-hover border-transparent',
                ].join(' ')}
              >
                All Projects
              </button>
              {projectConfigs.map((cfg) => (
                <button
                  key={cfg.slug}
                  type="button"
                  data-testid={`filter-${cfg.slug}`}
                  onClick={() => setProjectScope(cfg.slug)}
                  className={[
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors border',
                    projectScope === cfg.slug
                      ? 'bg-accent-soft text-fg border-accent'
                      : 'text-fg-3 hover:text-fg hover:bg-bg-hover border-transparent',
                  ].join(' ')}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: cfg.colorStripe }}
                  />
                  {cfg.name}
                </button>
              ))}
            </div>
          )}

          {isLoading && <div className="text-fg-3 text-[13px]">Loading personas…</div>}

          {error && (
            <div className="text-[color:var(--danger)] text-[13px]">Failed to load roster.</div>
          )}

          {!isLoading && !error && filteredPersonas.length === 0 && (
            <div
              data-testid="roster-empty-state"
              className="text-center text-fg-3 text-[13px] py-16"
            >
              <p className="mb-2 font-medium text-fg-2">No personas yet</p>
              <p>Persona stats accumulate as agent runs complete.</p>
            </div>
          )}

          {!isLoading && !error && roles.length > 0 && (
            <div className="flex flex-col gap-8">
              {roles.map((role) => (
                <RoleGroup
                  key={role}
                  role={role}
                  personas={grouped[role]}
                  selectedPersona={selectedPersona}
                  onSelect={setSelectedPersona}
                  colorMap={colorMap}
                  nameMap={nameMap}
                  showProjectBadge={projectScope === 'all' && projectConfigs.length > 1}
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
    </div>
  );
}

interface RosterTabBarProps {
  activeTab: 'personas' | 'playbooks' | 'quality-trend';
  onTabChange: (tab: 'personas' | 'playbooks' | 'quality-trend') => void;
}

function RosterTabBar({ activeTab, onTabChange }: RosterTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-8 pt-5 border-b border-line">
      <TabButton
        testId="tab-personas"
        active={activeTab === 'personas'}
        onClick={() => onTabChange('personas')}
      >
        Personas
      </TabButton>
      <TabButton
        testId="tab-playbooks"
        active={activeTab === 'playbooks'}
        onClick={() => onTabChange('playbooks')}
      >
        Playbooks
      </TabButton>
      <TabButton
        testId="tab-quality-trend"
        active={activeTab === 'quality-trend'}
        onClick={() => onTabChange('quality-trend')}
      >
        Quality Trend
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={[
        'px-3 py-2 text-[12.5px] border-b-2 -mb-px transition-colors',
        active
          ? 'border-accent text-fg'
          : 'border-transparent text-fg-2 hover:text-fg hover:border-line',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
