import { SearchModal } from '@/components/chrome/SearchModal';
import { CaptureModal } from '@/components/ui/CaptureModal';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TopBarProps {
  breadcrumb?: React.ReactNode;
}

export function TopBar({ breadcrumb }: TopBarProps) {
  const [showCapture, setShowCapture] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // ⌘K / Ctrl+K opens the search modal globally (#603).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
          data-testid="search-button"
          onClick={() => setShowSearch(true)}
          title="Search issues (⌘K)"
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
        >
          <Search size={13} />
          <span>Search</span>
          <span
            aria-hidden
            className="ml-1 hidden sm:inline-flex items-center gap-0.5 text-[10.5px] text-fg-3 font-mono"
          >
            ⌘K
          </span>
        </button>
      </header>
      <CaptureModal open={showCapture} onClose={() => setShowCapture(false)} />
      <SearchModal open={showSearch} onClose={() => setShowSearch(false)} />
    </>
  );
}
