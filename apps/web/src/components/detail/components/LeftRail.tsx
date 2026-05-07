import { cn } from '@/lib/cn';
// import {
//   CODE_ACTIVE_STATES,
//   GRILL_ACTIVE_STATES,
//   PRD_ACTIVE_STATES,
//   RETRO_ACTIVE_STATES,
// } from '@/lib/constants';
import {
  Brain,
  Bug,
  Clock,
  Code2,
  Coins,
  Eye,
  FileText,
  Folder,
  Layers,
  type LucideIcon,
  MessageCircleQuestion,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { SECTIONS } from '../lib/sections';

const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: Layers,
  repo: Folder,
  investigation: Brain,
  prd: FileText,
  grill: MessageCircleQuestion,
  code: Code2,
  qa: Bug,
  review: Eye,
  retrospective: RotateCcw,
  timeline: Clock,
  chat: MessageSquare,
  costs: Coins,
};

// Sections whose visibility is gated by issue state. When `itemState` is
// not in the set we render no rail entry at all (per the M13 spec
// requirement that Grill be ABSENT — not collapsed — outside Discover).
// const STATE_GATED: Record<string, ReadonlySet<string>> = {
//   code: CODE_ACTIVE_STATES,
//   retrospective: RETRO_ACTIVE_STATES,
//   prd: PRD_ACTIVE_STATES,
//   grill: GRILL_ACTIVE_STATES,
// };

// Sections that should be COMPLETELY HIDDEN when their state gate fails,
// rather than rendered as a deferred-state link. Both Grill and PRD are
// // purely Discover-lane surfaces so they're hidden outside that lane.
// const STATE_HIDE_WHEN_GATED = new Set(['grill', 'prd']);

// interface LeftRailProps {
//   itemState?: string;
// }
// { itemState }: LeftRailProps
export function LeftRail() {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const location = useLocation();

  const activeKey = (() => {
    const trailing = location.pathname.split('/').pop();
    if (trailing == null || trailing === id || trailing === '') return 'overview';
    const found = SECTIONS.find((s) => s.key === trailing);
    return found?.key ?? 'overview';
  })();

  return (
    <nav
      data-testid="detail-left-rail"
      className="w-[200px] shrink-0 flex flex-col border-r border-line bg-bg-elev/60 overflow-y-auto"
    >
      <ol className="flex flex-col px-2 py-3 gap-0.5">
        {SECTIONS.map((section, idx) => {
          const target =
            section.key === 'overview'
              ? `/projects/${slug}/items/${id}`
              : `/projects/${slug}/items/${id}/${section.key}`;
          const isActive = activeKey === section.key;
          const number = String(idx + 1).padStart(2, '0');
          const Icon = SECTION_ICONS[section.key];

          // const stateGate = STATE_GATED[section.key];
          // const passesStateGate =
          //   stateGate == null ? true : itemState != null && stateGate.has(itemState);
          // Sections in STATE_HIDE_WHEN_GATED disappear entirely when their
          // gate doesn't pass — used for Discover-only tabs like Grill and PRD.
          // if (stateGate != null && !passesStateGate && STATE_HIDE_WHEN_GATED.has(section.key)) {
          //   return null;
          // }
          const available = true; // stateGate != null ? passesStateGate : section.available;

          const unavailableTitle =
            section.key === 'code'
              ? 'Available once coding has started'
              : section.key === 'retrospective'
                ? 'Available after the PR merges'
                : `Available in ${section.milestone}`;

          if (!available) {
            return (
              <Link
                key={section.key}
                to={target}
                title={unavailableTitle}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] transition-colors',
                  isActive
                    ? 'bg-bg-hover text-fg-2'
                    : 'text-fg-2 hover:text-fg-3 hover:bg-bg-hover',
                )}
              >
                <span className="font-mono tnum text-[10.5px] text-fg-2 w-5">{number}</span>
                {Icon && <Icon size={13} className="shrink-0" />}
                <span className="grow">{section.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-fg-2">
                  {section.milestone}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={section.key}
              to={target}
              data-section-key={section.key}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors',
                isActive ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
              )}
            >
              <span className="font-mono tnum text-[10.5px] text-fg-3 w-5">{number}</span>
              {Icon && <Icon size={13} className="shrink-0" />}
              <span>{section.label}</span>
            </Link>
          );
        })}
      </ol>
    </nav>
  );
}
