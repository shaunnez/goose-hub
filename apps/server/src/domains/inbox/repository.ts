import { db } from '@goose-hub/core/db/db.js';
import { inboxItems } from '@goose-hub/core/db/schema.js';
import { desc, eq } from 'drizzle-orm';

export interface InboxItem {
  id: number;
  title: string;
  body: string | null;
  type: string;
  createdAt: string;
}

export interface NewInboxItem {
  title: string;
  body: string;
  type: string;
}

export async function listInboxItems(): Promise<InboxItem[]> {
  return db.select().from(inboxItems).orderBy(desc(inboxItems.createdAt));
}

export async function insertInboxItem(item: NewInboxItem): Promise<InboxItem> {
  const [row] = await db.insert(inboxItems).values(item).returning();
  return row;
}

export async function getInboxItem(id: number): Promise<InboxItem | null> {
  const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
  return row ?? null;
}

export async function deleteInboxItem(id: number): Promise<void> {
  await db.delete(inboxItems).where(eq(inboxItems.id, id));
}
