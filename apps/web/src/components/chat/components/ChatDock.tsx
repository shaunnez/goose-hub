import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel } from './ChatPanel';

const STORAGE_KEY = 'hub-chat-open';

/**
 * Top-level entry point: hosts the slide-out chat panel + the floating
 * launcher button. Mounted once at the AppShell level so the chat is
 * available on every page.
 */
export function ChatDock() {
  const closePanelRef = useRef<(() => void) | null>(null);
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

  const handlePanelClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleLauncherToggle = useCallback(() => {
    if (!open) {
      setOpen(true);
      return;
    }
    closePanelRef.current?.();
  }, [open]);

  return (
    <>
      <ChatPanel
        open={open}
        onClose={handlePanelClose}
        registerCloseHandler={(handler) => {
          closePanelRef.current = handler;
        }}
      />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
