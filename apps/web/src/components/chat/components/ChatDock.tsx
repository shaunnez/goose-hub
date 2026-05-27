import { useEffect, useState } from 'react';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel, clearActiveConversationSelection } from './ChatPanel';

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

  const handlePanelClose = () => {
    setOpen(false);
  };

  const handleLauncherOpen = () => {
    setOpen(true);
  };

  const handleLauncherClose = () => {
    clearActiveConversationSelection();
    setOpen(false);
  };

  const handleLauncherToggle = () => {
    if (open) {
      handleLauncherClose();
      return;
    }
    handleLauncherOpen();
  };

  return (
    <>
      <ChatPanel open={open} onClose={handlePanelClose} />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
