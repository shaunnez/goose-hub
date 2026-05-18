import { cn } from '@/lib/cn';
import { MessageCircle, X } from 'lucide-react';

interface ChatLauncherProps {
  open: boolean;
  onToggle: () => void;
}

export function ChatLauncher({ open, onToggle }: ChatLauncherProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? 'Close Hub Chat' : 'Open Hub Chat'}
      aria-pressed={open}
      data-testid="chat-launcher"
      title={open ? 'Close Hub Chat' : 'Open Hub Chat'}
      className={cn(
        'fixed z-50 bottom-4 right-4 rounded-full shadow-lg',
        'w-11 h-11 flex items-center justify-center transition-colors',
        open
          ? 'bg-bg border border-line text-fg hover:bg-bg-hover'
          : 'bg-accent text-bg hover:bg-accent/90',
      )}
    >
      {open ? <X size={16} /> : <MessageCircle size={16} />}
    </button>
  );
}
