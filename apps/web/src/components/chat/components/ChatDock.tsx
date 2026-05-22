import { useEffect, useState } from 'react';
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
  const [closeRequestToken, setCloseRequestToken] = useState(0);
  const [closeRequestOptions, setCloseRequestOptions] = useState<
    ChatPanelCloseOptions | undefined
  >();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(open));
    } catch {}
  }, [open]);

  const handleChatClose = (options?: ChatPanelCloseOptions) => {
    if (options != null) {
      setCloseRequestOptions(options);
      setCloseRequestToken((token) => token + 1);
    }
    setOpen(false);
  };

  const handleLauncherToggle = () => {
    if (open) {
      handleChatClose({ resetToList: true, clearActiveConversationId: true });
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <ChatPanel
        open={open}
        onClose={handleChatClose}
        closeRequestToken={closeRequestToken}
        closeRequestOptions={closeRequestOptions}
      />
      <ChatLauncher open={open} onToggle={handleLauncherToggle} />
    </>
  );
}
