import { useEffect, useState } from 'react';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel } from './ChatPanel';

const STORAGE_KEY = 'hub-chat-open';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

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
  const [panelSessionKey, setPanelSessionKey] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {}
  }, [open]);

  const handleLauncherToggle = () => {
    if (open) {
      try {
        localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      } catch {}
      setPanelSessionKey((token) => token + 1);
      setOpen(false);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <ChatPanel key={panelSessionKey} open={open} onClose={() => setOpen(false)} />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
