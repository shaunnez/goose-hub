import { logger } from '@goose-hub/core/logger.js';
import { runTriageBatch } from '../domains/workflows/triage-batch.js';

const _triageBatchInFlight = new Set<string>();
const _triageBatchPending = new Set<string>();

/** Run the triage batch for a project. Coalesces concurrent calls per slug. */
export function dispatchTriageBatch(slug: string): Promise<void> {
  if (_triageBatchInFlight.has(slug)) {
    _triageBatchPending.add(slug);
    return Promise.resolve();
  }
  _triageBatchInFlight.add(slug);
  return Promise.resolve()
    .then(() => runTriageBatch(slug))
    .catch((err: unknown) => {
      logger.error('dispatchTriageBatch failed', { slug, error: String(err) });
    })
    .finally(() => {
      _triageBatchInFlight.delete(slug);
      if (_triageBatchPending.delete(slug)) {
        void dispatchTriageBatch(slug);
      }
    });
}
