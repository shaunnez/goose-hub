import { cn } from '@/lib/cn';
import type { ProjectBudgetStatus } from '@/lib/project-budget';
import { formatCost, formatTokens } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ProjectBudgetBannerProps {
  status?: ProjectBudgetStatus | null;
  className?: string;
}

function formatUtcTime(iso: string): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

export function ProjectBudgetBanner({ status, className }: ProjectBudgetBannerProps) {
  if (status == null || !status.dailyBudgetExceeded || status.dailyTokensLimit <= 0) {
    return null;
  }

  const used = formatTokens(status.dailyTokensUsed);
  const limit = formatTokens(status.dailyTokensLimit);
  const reset = formatUtcTime(status.resetsAtUtc);
  const cost = formatCost(status.dailyCostUsd, 'estimated');

  return (
    <div
      data-testid="project-budget-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10',
        'text-[12.5px] font-medium text-[color:var(--danger)]',
        className,
      )}
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Daily token budget reached: {used} / {limit}. Automation is paused until {reset}.
        <span className="text-fg-3 font-normal"> Today&apos;s spend: {cost}.</span>
      </span>
      <Link
        to="/settings"
        className="shrink-0 h-6 inline-flex items-center px-2.5 rounded border border-[color:var(--danger)]/50 text-[11.5px] hover:bg-[color:var(--danger)]/15"
      >
        Settings
      </Link>
    </div>
  );
}
