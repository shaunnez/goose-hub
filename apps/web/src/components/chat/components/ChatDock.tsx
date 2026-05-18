import { useEffect, useState } from 'react';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel } from './ChatPanel';

const STORAGE_KEY = 'hub-chat-open';

/**
 * Top-level entry point: hosts the slide-out chat panel + the floating
 * launcher button. Mounted once at the AppShell level so the chat is
 * available on every page.
 */
export function ChatDock() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {}
  }, [open]);

  return (
    <>
      <ChatPanel open={open} onClose={() => setOpen(false)} />
      <ChatLauncher open={open} onToggle={() => setOpen((o) => !o)} />
    </>
  );
}
