import type { ChatScope } from '@/lib/types';

export interface ResolvedScope {
  scope: ChatScope;
  projectSlug: string | null;
  workItemId: string | null;
  label: string;
}

/**
 * Resolve a chat scope from the current URL pathname.
 *
 * - `/projects/:slug/items/:id*`   → item scope
 * - `/projects/:slug/**`           → project scope (also covers /all)
 * - `/settings`, `/inbox`, etc.    → global scope
 */
export function resolveScopeFromPath(pathname: string): ResolvedScope {
  const itemMatch = pathname.match(/^\/projects\/([a-z0-9-]+)\/items\/([^/]+)/);
  if (itemMatch) {
    return {
      scope: 'item',
      projectSlug: itemMatch[1],
      workItemId: itemMatch[2],
      label: `${itemMatch[1]} #${itemMatch[2]}`,
    };
  }
  const projectMatch = pathname.match(/^\/projects\/([a-z0-9-]+)(\/|$)/);
  if (projectMatch && projectMatch[1] !== 'all') {
    return {
      scope: 'project',
      projectSlug: projectMatch[1],
      workItemId: null,
      label: projectMatch[1],
    };
  }
  return { scope: 'global', projectSlug: null, workItemId: null, label: 'Global' };
}
