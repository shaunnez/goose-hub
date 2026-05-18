/**
 * Cross-domain bridge for running the project-bootstrap workflow. Per
 * `apps/server/STANDARDS.md`, domains never import from other domains; this
 * shared helper is the gateway the chat domain uses to drive bootstrap from
 * its `bootstrap_project` tool.
 */
import { runBootstrapService } from '../domains/bootstrap/service.js';

export interface BootstrapRunBridgeResult {
  ok: boolean;
  slug?: string;
  status?: 'created' | 'idempotent-skip';
  registrationPrUrl?: string | null;
  stackSummary?: string;
  auditAction?: string;
  labelCounts?: { created: number; updated: number; skipped: number } | undefined;
  error?: string;
  errorStatus?: number;
}

export async function runBootstrapViaBridge(
  repoRef: string,
  slugOverride?: string,
): Promise<BootstrapRunBridgeResult> {
  const result = await runBootstrapService(repoRef, slugOverride);
  if (!result.ok) {
    return { ok: false, error: result.error, errorStatus: result.status };
  }
  return {
    ok: true,
    slug: result.data.slug,
    status: result.data.status,
    registrationPrUrl: result.data.registrationPrUrl ?? null,
    stackSummary: result.data.stackSummary,
    auditAction: result.data.auditAction,
    labelCounts: result.data.labelCounts,
  };
}
