const AUTH_PATTERN = /auth|session|crypto|secret|password|jwt|oauth/i;

export interface TopicClassification {
  isAuthTopic: boolean;
  /** Minimum rounds that must complete before convergence is checked. */
  minRounds: number;
}

/**
 * Classifies PR changed file paths to determine review round requirements.
 * Auth/session/crypto topics require at least 3 rounds (issue #561).
 */
export function classifyTopic(changedFilePaths: string[]): TopicClassification {
  const isAuthTopic = changedFilePaths.some((p) => AUTH_PATTERN.test(p));
  return { isAuthTopic, minRounds: isAuthTopic ? 3 : 1 };
}
