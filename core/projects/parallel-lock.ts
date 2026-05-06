/**
 * Per-project parallel workflow lock (M11.08).
 *
 * Enforces two invariants per project:
 *   1. Per-issue uniqueness: at most one concurrent workflow per issue.
 *   2. Per-project cap: at most maxParallelAgents concurrent workflows.
 *
 * This relaxes FACTORY_RULES rule 4 ("one workflow per project at a time") to
 * "up to maxParallelAgents workflows per project, on distinct issues."
 * See ADR 0023 (M11.09) for the decision record.
 */
export class ProjectParallelLock {
  private readonly _bySlug = new Map<string, Set<number>>();

  /**
   * Try to acquire a workflow slot for the given issue.
   *
   * Returns false (without acquiring) when:
   *   - the same issue already has an in-flight workflow, OR
   *   - the project has reached its maxParallelAgents cap.
   *
   * Defaults maxParallelAgents to 1 so callers that omit the value keep
   * the original single-workflow-per-project behaviour.
   */
  tryAcquire(slug: string, issueNumber: number, maxParallelAgents = 1): boolean {
    let issueSet = this._bySlug.get(slug);
    if (issueSet == null) {
      issueSet = new Set();
      this._bySlug.set(slug, issueSet);
    }
    if (issueSet.has(issueNumber)) return false;
    if (issueSet.size >= maxParallelAgents) return false;
    issueSet.add(issueNumber);
    return true;
  }

  /** Release the slot held by this issue. No-op if not held. */
  release(slug: string, issueNumber: number): void {
    const set = this._bySlug.get(slug);
    if (set == null) return;
    set.delete(issueNumber);
    if (set.size === 0) this._bySlug.delete(slug);
  }

  /** How many workflow slots are currently occupied for this project. */
  inFlightCount(slug: string): number {
    return this._bySlug.get(slug)?.size ?? 0;
  }

  /** Whether a workflow is currently in-flight for this specific issue. */
  isInFlight(slug: string, issueNumber: number): boolean {
    return this._bySlug.get(slug)?.has(issueNumber) ?? false;
  }
}

/** Singleton shared across the server process. */
export const parallelLock = new ProjectParallelLock();
