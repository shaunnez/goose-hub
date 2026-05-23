import { minimalEnv, runCommand } from '../tool-layer/mcp/command-policy.js';
import type { RepoRelativePath } from '../tool-layer/path-contract.js';

export interface RecentChangedFile {
  path: RepoRelativePath;
  lastTouched: string;
  lastCommitSha: string;
}

export async function gitRecentChanges(input: {
  worktreePath: string;
  candidateFiles: RepoRelativePath[];
  since?: string;
  limit?: number;
}): Promise<RecentChangedFile[]> {
  const candidateSet = new Set(input.candidateFiles.map((file) => file.path));
  if (candidateSet.size === 0) return [];

  const result = await runCommand({
    command: 'git',
    args: ['log', `--since=${input.since ?? '14d'}`, '--name-only', '--pretty=format:%H%x09%cI'],
    cwd: input.worktreePath,
    timeoutMs: 10_000,
    env: minimalEnv(),
  });
  if (result.status !== 'ok') return [];

  const out: RecentChangedFile[] = [];
  const seen = new Set<string>();
  let currentSha = '';
  let currentIso = '';
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const [sha, iso] = line.split('\t');
    if (/^[0-9a-f]{7,40}$/i.test(sha ?? '') && iso != null) {
      currentSha = sha;
      currentIso = iso;
      continue;
    }
    if (!candidateSet.has(line) || seen.has(line) || currentSha.length === 0) continue;
    seen.add(line);
    out.push({
      path: { path: line, root: 'worktree' },
      lastTouched: currentIso,
      lastCommitSha: currentSha,
    });
    if (out.length >= (input.limit ?? 15)) break;
  }
  return out;
}
