/**
 * Compute the effective reviewer slot count as the intersection of the
 * route-computed cap and the project-configured value.
 * The route cap is an upper bound — it cannot raise slots above what the
 * project explicitly configures, but project config cannot raise above the
 * route cap either.
 */
export function effectiveReviewerSlots(routeCap: number, configuredSlots: number | null): number {
  if (configuredSlots == null) return routeCap;
  return Math.min(routeCap, configuredSlots);
}
