const CHAT_OPEN_STORAGE_KEY = 'hub-chat-open';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readChatDockOpen(storage: StorageLike): boolean {
  return storage.getItem(CHAT_OPEN_STORAGE_KEY) === 'true';
}

export function writeChatDockOpen(storage: StorageLike, open: boolean): void {
  storage.setItem(CHAT_OPEN_STORAGE_KEY, String(open));
}

export function readActiveConversationId(storage: StorageLike): string | null {
  return storage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

export function writeActiveConversationId(storage: StorageLike, id: string): void {
  storage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
}

export function clearActiveConversationId(storage: StorageLike): void {
  storage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

