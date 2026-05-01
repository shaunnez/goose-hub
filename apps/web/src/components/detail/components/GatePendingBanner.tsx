import { cn } from '@/lib/cn';
import { GATE_STATES } from '@/lib/constants';
import { ShieldAlert } from 'lucide-react';

export { GATE_STATES } from '@/lib/constants';

interface GatePendingBannerProps {
  state?: string;
}

export function GatePendingBanner({ state }: GatePendingBannerProps) {
  if (!state || !(state in GATE_STATES)) return null;

  const message = GATE_STATES[state];

  return (
    <div
      data-testid="gate-pending-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-[color:var(--warning)]/40',
        'bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
        'text-[12.5px] font-medium',
      )}
    >
      <ShieldAlert size={14} className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}
