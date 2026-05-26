import { useEffect, useState } from 'react';
import { clearActiveConversationId, readChatDockOpen, writeChatDockOpen } from '../lib/persistence';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel } from './ChatPanel';

/**
 * Top-level entry point: hosts the slide-out chat panel + the floating
 * launcher button. Mounted once at the AppShell level so the chat is
 * available on every page.
 */
export function ChatDock() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return readChatDockOpen(localStorage);
    } catch {
      return false;
    }
  });
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    try {
      writeChatDockOpen(localStorage, open);
    } catch {}
  }, [open]);

  const handleClose = () => {
    try {
      clearActiveConversationId(localStorage);
    } catch {}
    setResetKey((key) => key + 1);
    setOpen(false);
  };

  const handleLauncherToggle = () => {
    if (open) {
      handleClose();
      return;
    }

    setOpen(true);
  };

  return (
    <>
      <ChatPanel open={open} onClose={handleClose} resetKey={resetKey} />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
