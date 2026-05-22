import { useCallback, useEffect, useState } from 'react';
import { ChatLauncher } from './ChatLauncher';
import { ChatPanel, type ChatPanelCloseOptions } from './ChatPanel';

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
  const [closeOptions, setCloseOptions] = useState<ChatPanelCloseOptions | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {}
  }, [open]);

  const handleOpen = useCallback(() => {
    setCloseOptions(null);
    setOpen(true);
  }, []);

  const handleClose = useCallback((options: ChatPanelCloseOptions = {}) => {
    setCloseOptions(options.resetToList ? { resetToList: true } : null);
    setOpen(false);
  }, []);

  const handleLauncherToggle = useCallback(() => {
    if (open) {
      handleClose({ resetToList: true });
      return;
    }
    handleOpen();
  }, [handleClose, handleOpen, open]);

  return (
    <>
      <ChatPanel open={open} closeOptions={closeOptions} onClose={handleClose} />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
