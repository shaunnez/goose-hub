import { Search, Terminal } from 'lucide-react';

interface TopBarProps {
  breadcrumb?: React.ReactNode;
}

export function TopBar({ breadcrumb }: TopBarProps) {
  return (
    <header
      data-testid="top-bar"
      className="h-[42px] flex items-center gap-3 px-4 border-b border-line bg-bg-elev/80 backdrop-blur-md shrink-0"
    >
      <div className="text-[12.5px] text-fg-2 min-w-0 truncate">{breadcrumb}</div>
      <span className="grow" />
      <button
        type="button"
        disabled
        title="Search — available later"
        className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-4 border border-line bg-bg cursor-not-allowed"
      >
        <Search size={13} />
        <span>Search</span>
        <span className="ml-2 font-mono text-[10.5px]">⌘K</span>
      </button>
      <button
        type="button"
        disabled
        title="Command palette — available in M3"
        className="flex items-center gap-2 h-7 px-2.5 rounded-md text-[12px] text-fg-4 border border-line bg-bg cursor-not-allowed"
      >
        <Terminal size={13} />
        <span>Command</span>
      </button>
    </header>
  );
}
