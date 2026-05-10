import { cn } from '@/lib/cn';
import { GRILL_ACTIVE_STATES, PRD_ACTIVE_STATES } from '@/lib/constants';
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

interface LeftRailProps {
  itemType?: string;
  prdParent?: string;
}

function getNotApplicableReason(
  key: string,
  itemType: string | undefined,
  prdParent: string | undefined,
): string | undefined {
  const isRawFeature = itemType === 'feature' && prdParent == null;
  const isFromPrd = prdParent != null;

  if (key === 'investigation') {
    if (itemType !== 'bug') {
      return itemType != null
        ? `Investigation runs on bugs only — this is a ${itemType}`
        : 'Investigation runs on bugs only';
    }
  }

  if (key === 'grill' || key === 'prd') {
    if (isFromPrd) return `Generated from PRD — see parent #${prdParent}`;
    if (itemType != null && itemType !== 'feature') {
      return `${itemType === 'bug' ? 'Bugs go straight to investigation' : `${itemType.charAt(0).toUpperCase()}${itemType.slice(1)}s skip`} the Discover lane`;
    }
  }

  if (key === 'code' || key === 'qa' || key === 'review' || key === 'retrospective') {
    if (isRawFeature) {
      return 'This feature is decomposed into child issues — dev work happens there, not here';
    }
  }

  return undefined;
}

export function LeftRail({ itemType, prdParent }: LeftRailProps) {
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

          const notApplicableReason = getNotApplicableReason(section.key, itemType, prdParent);

          if (notApplicableReason != null) {
            return (
              // Use a div so pointer events stay enabled (enabling title tooltip),
              // but navigation is blocked. cursor-not-allowed signals non-interactivity.
              <div
                key={section.key}
                title={notApplicableReason}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-fg-3 opacity-35 cursor-not-allowed select-none"
              >
                <span className="font-mono tnum text-[10.5px] w-5">{number}</span>
                {Icon && <Icon size={13} className="shrink-0" />}
                <span className="line-through">{section.label}</span>
              </div>
            );
          }

          if (!section.available) {
            const unavailableTitle =
              section.key === 'code'
                ? 'Available once coding has started'
                : section.key === 'retrospective'
                  ? 'Available after the PR merges'
                  : `Available in ${section.milestone}`;
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
