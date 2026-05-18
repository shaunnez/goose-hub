/**
 * Cross-domain bridge for inbox writes. Per `apps/server/STANDARDS.md` rule
 * "Domains never import from other domains", anything that needs to add to
 * the inbox from outside the `inbox` domain must go through this shared
 * helper rather than reaching into the inbox repository directly.
 *
 * Today this is used by the chat domain (`create_inbox_note` tool) so the
 * agent can capture a follow-up the user mentions in chat.
 */
import { insertInboxItem } from '../domains/inbox/repository.js';

const VALID_TYPES = new Set(['feature', 'bug', 'chore', 'research']);

export interface AddInboxNoteInput {
  title: string;
  body?: string;
  type?: string;
}

export interface AddedInboxNote {
  id: number;
}

export async function addInboxNote(input: AddInboxNoteInput): Promise<AddedInboxNote> {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error('addInboxNote: title required');
  }
  const safeType = input.type && VALID_TYPES.has(input.type) ? input.type : 'feature';
  const item = await insertInboxItem({
    title: trimmedTitle,
    body: input.body ?? '',
    type: safeType,
  });
  return { id: item.id };
}
