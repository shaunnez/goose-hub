import { CaptureModal } from '@/components/ui/CaptureModal';
import { Plus, Search, Terminal } from 'lucide-react';
import { useState } from 'react';

interface TopBarProps {
  breadcrumb?: React.ReactNode;
}

export function TopBar({ breadcrumb }: TopBarProps) {
  const [showCapture, setShowCapture] = useState(false);

  return (
    <>
      <header
        data-testid="top-bar"
        className="h-[42px] flex items-center gap-3 px-4 border-b border-line bg-bg-elev/80 backdrop-blur-md shrink-0"
      >
        <div className="text-[12.5px] text-fg-2 min-w-0 truncate">{breadcrumb}</div>
        <span className="grow" />
        <button
          type="button"
          data-testid="capture-button"
          onClick={() => setShowCapture(true)}
          title="Capture an idea or task"
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
        >
          <Plus size={13} />
          <span>Capture</span>
        </button>
        <button
          type="button"
          disabled
          title="Search — available later"
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg cursor-not-allowed"
        >
          <Search size={13} />
          <span>Search</span>
        </button>
      </header>
      <CaptureModal open={showCapture} onClose={() => setShowCapture(false)} />
    </>
  );
}
