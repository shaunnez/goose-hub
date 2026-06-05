import { SearchModal } from '@/components/search/components/SearchModal';
import { CaptureModal } from '@/components/ui/CaptureModal';
import { Plus, ScrollText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChangelogModal } from './ChangelogModal';

interface TopBarProps {
  breadcrumb?: React.ReactNode;
}

function getShortcutModifierLabel() {
  if (typeof navigator === 'undefined') {
    return '⌘';
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl+';
}

export function TopBar({ breadcrumb }: TopBarProps) {
  const [showCapture, setShowCapture] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const shortcutModifierLabel = getShortcutModifierLabel();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }

      if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setShowCapture(true);
        return;
      }

      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
          data-testid="changelog-button"
          onClick={() => setShowChangelog(true)}
          title="What shipped in the last 7 days"
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
        >
          <ScrollText size={13} />
          <span>Changelog</span>
        </button>
        <button
          type="button"
          data-testid="capture-button"
          onClick={() => setShowCapture(true)}
          title={`Capture an idea or task (${shortcutModifierLabel}J)`}
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
        >
          <Plus size={13} />
          <span>Capture</span>
          <kbd className="ml-1 px-1 py-0.5 rounded border border-line text-[10px] text-fg-3 bg-bg">
            {shortcutModifierLabel}J
          </kbd>
        </button>
        <button
          type="button"
          data-testid="search-button"
          onClick={() => setShowSearch(true)}
          title={`Search work items (${shortcutModifierLabel}K)`}
          className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-2 border border-line bg-bg hover:bg-bg-elev cursor-pointer"
        >
          <Search size={13} />
          <span>Search</span>
          <kbd className="ml-1 px-1 py-0.5 rounded border border-line text-[10px] text-fg-3 bg-bg">
            {shortcutModifierLabel}K
          </kbd>
        </button>
      </header>
      <CaptureModal open={showCapture} onClose={() => setShowCapture(false)} />
      <ChangelogModal open={showChangelog} onClose={() => setShowChangelog(false)} />
      <SearchModal open={showSearch} onClose={() => setShowSearch(false)} />
    </>
  );
}
