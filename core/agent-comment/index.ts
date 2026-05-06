/**
 * Builds a structured GitHub issue comment for agent status updates.
 *
 * Format:
 *   **[Agent] Status**
 *
 *   Summary: <summary>
 *
 *   Details:
 *   - <detail>
 */
export function buildAgentComment(
  agent: string,
  status: string,
  summary: string,
  details?: string[],
): string {
  const lines = [`**[${agent}] ${status}**`, '', `Summary: ${summary}`];
  if (details && details.length > 0) {
    lines.push('', 'Details:');
    for (const d of details) {
      lines.push(`- ${d}`);
    }
  }
  return lines.join('\n');
}
