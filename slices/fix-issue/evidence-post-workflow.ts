import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  EvidencePostOutput,
  EvidencePostPlanOutput,
} from '@goose-hub/skills/evidence-post/schema.js';
import { collectPlaywrightEvidence } from '../../scripts/collect-playwright-evidence.js';
import type { PlaywrightEvidence } from '../../scripts/collect-playwright-evidence.js';

export interface EvidencePostPublisher {
  execFileSync?: typeof execFileSync;
  spawnSync?: typeof spawnSync;
  collect?: typeof collectPlaywrightEvidence;
}

export interface RunEvidencePostPlanInput {
  plan: EvidencePostPlanOutput;
  workspaceDir: string;
  issueNumber: number;
  repo: string;
  prNumber: number;
  prHeadSha: string;
  beforeCommentUrl?: string;
  env?: Record<string, string>;
  publisher?: EvidencePostPublisher;
}

function webSpecPath(specPath: string): string {
  return specPath.startsWith('apps/web/') ? specPath.slice('apps/web/'.length) : specPath;
}

function evidencePath(issueNumber: number, filePath: string): string {
  return `evidence/issue-${issueNumber}/${path.basename(filePath)}`;
}

function rawUrl(repo: string, sha: string, evidenceFile: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${evidenceFile}`;
}

function copyIfPresent(source: string | null, targetDir: string): string | null {
  if (source == null || !fs.existsSync(source)) return null;
  const target = path.join(targetDir, path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

const DISCOVERY_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.cache',
  'playwright-report',
  'test-results',
]);

function isEvidenceArtifact(name: string): boolean {
  return /\.(png|jpe?g|gif)$/i.test(name);
}

function discoverIssueEvidenceArtifacts(params: {
  workspaceDir: string;
  issueNumber: number;
}): string[] {
  const issueDir = `issue-${params.issueNumber}`;
  const matches: string[] = [];

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DISCOVERY_EXCLUDED_DIRS.has(entry.name)) continue;
        visit(fullPath);
        continue;
      }

      if (!entry.isFile() || !isEvidenceArtifact(entry.name)) continue;
      const parent = path.basename(dir);
      const grandparent = path.basename(path.dirname(dir));
      if (parent === issueDir && grandparent === 'evidence') {
        matches.push(fullPath);
      }
    }
  }

  visit(params.workspaceDir);
  return matches.sort((a, b) => a.localeCompare(b));
}

function stageScreenshotsFromWorktree(params: {
  workspaceDir: string;
  issueNumber: number;
  stagingDir: string;
}): void {
  const artifacts = discoverIssueEvidenceArtifacts({
    workspaceDir: params.workspaceDir,
    issueNumber: params.issueNumber,
  });
  if (artifacts.length === 0) return;

  fs.mkdirSync(params.stagingDir, { recursive: true });
  for (const artifact of artifacts) {
    fs.copyFileSync(artifact, path.join(params.stagingDir, path.basename(artifact)));
  }
}

function publishEvidence(params: {
  evidence: PlaywrightEvidence;
  plan: EvidencePostPlanOutput;
  workspaceDir: string;
  issueNumber: number;
  repo: string;
  prNumber: number;
  prHeadSha: string;
  beforeCommentUrl?: string;
  run: typeof execFileSync;
}): { sha: string; commentUrl?: string } {
  const branch = `evidence/issue-${params.issueNumber}`;
  const helperWorktree = `/tmp/evidence-issue-${params.issueNumber}`;
  const targetEvidenceDir = path.join(helperWorktree, 'evidence', `issue-${params.issueNumber}`);

  try {
    params.run('git', ['worktree', 'remove', '--force', helperWorktree], {
      cwd: params.workspaceDir,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort cleanup of stale helper worktrees.
  }

  try {
    params.run('git', ['fetch', 'origin', branch], { cwd: params.workspaceDir, stdio: 'ignore' });
  } catch {
    // The evidence branch may not exist yet.
  }

  let hasRemoteBranch = true;
  try {
    params.run('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`], {
      cwd: params.workspaceDir,
      stdio: 'ignore',
    });
  } catch {
    hasRemoteBranch = false;
  }

  if (hasRemoteBranch) {
    params.run('git', ['worktree', 'add', helperWorktree, '-B', branch, `origin/${branch}`], {
      cwd: params.workspaceDir,
    });
  } else {
    params.run('git', ['worktree', 'add', '-b', branch, helperWorktree], {
      cwd: params.workspaceDir,
    });
  }

  fs.mkdirSync(targetEvidenceDir, { recursive: true });
  for (const screenshot of params.evidence.screenshots)
    copyIfPresent(screenshot, targetEvidenceDir);
  copyIfPresent(params.evidence.gifPath, targetEvidenceDir);

  params.run('git', ['-C', helperWorktree, 'add', `evidence/issue-${params.issueNumber}/`]);
  params.run('git', [
    '-C',
    helperWorktree,
    'commit',
    '-m',
    `evidence: after-state for issue #${params.issueNumber}`,
  ]);
  const sha = params
    .run('git', ['-C', helperWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    .toString()
    .trim();
  params.run('git', ['-C', helperWorktree, 'push', 'origin', branch]);

  const before =
    params.beforeCommentUrl == null
      ? ''
      : `\n### Before (investigation)\n> See full capture: ${params.beforeCommentUrl}\n`;
  const images = params.evidence.screenshots
    .map((screenshot, index) => {
      const file = evidencePath(params.issueNumber, screenshot);
      return `![Step ${index + 1} after](${rawUrl(params.repo, sha, file)})`;
    })
    .join('\n');
  const gif =
    params.evidence.gifPath == null
      ? ''
      : `\n![walkthrough](${rawUrl(params.repo, sha, evidencePath(params.issueNumber, params.evidence.gifPath))})`;
  const body = `## Evidence for issue #${params.issueNumber}\n${before}\n### After (fix shipped - PR #${params.prNumber})\n\n${params.plan.validationIntent}\n\n${images}${gif}\n\n_Pinned to \`${sha}\` - PR #${params.prNumber} head \`${params.prHeadSha}\`_`;

  let commentUrl: string | undefined;
  try {
    commentUrl = params
      .run(
        'gh',
        ['issue', 'comment', String(params.issueNumber), '--repo', params.repo, '--body', body],
        { encoding: 'utf8' },
      )
      .toString()
      .trim();
  } finally {
    params.run('git', ['worktree', 'remove', helperWorktree], { cwd: params.workspaceDir });
  }

  return { sha, commentUrl: commentUrl || undefined };
}

export function assembleEvidencePostPayload(params: {
  evidence: PlaywrightEvidence;
  plan: EvidencePostPlanOutput;
  issueNumber: number;
  repo: string;
  sha?: string;
  commentUrl?: string;
}): EvidencePostOutput {
  const screenshots = params.evidence.screenshots.map((screenshot, index) => {
    const file = evidencePath(params.issueNumber, screenshot);
    return {
      path: file,
      caption: `After step ${index + 1}`,
      step: index + 1,
      ...(params.sha != null ? { githubUrl: rawUrl(params.repo, params.sha, file) } : {}),
    };
  });
  return {
    screenshots,
    gifPath:
      params.evidence.gifPath == null
        ? null
        : evidencePath(params.issueNumber, params.evidence.gifPath),
    ...(params.commentUrl != null ? { commentUrl: params.commentUrl } : {}),
    ...(params.sha != null ? { commitSha: params.sha } : {}),
    decisionSummaries: [
      {
        kind: params.evidence.classification === 'passed' ? 'VERDICT' : 'TOOL_FAILURE',
        summary:
          params.evidence.classification === 'passed'
            ? params.plan.validationIntent
            : `Evidence validation ${params.evidence.classification}: ${params.evidence.notes}`,
      },
    ],
  };
}

function failedEvidencePlan(plan: EvidencePostPlanOutput, summary: string): EvidencePostOutput {
  return {
    screenshots: [],
    gifPath: null,
    decisionSummaries: [
      {
        kind: 'TOOL_FAILURE',
        summary: `${summary}: ${plan.validationIntent}`,
      },
    ],
  };
}

export function runEvidencePostPlan(input: RunEvidencePostPlanInput): EvidencePostOutput {
  const run = input.publisher?.execFileSync ?? execFileSync;
  const spawn = input.publisher?.spawnSync ?? spawnSync;
  const collect = input.publisher?.collect ?? collectPlaywrightEvidence;
  const stagingDir = `/tmp/evidence-staging-${input.issueNumber}`;
  const resultsPath = path.join(stagingDir, 'pw-results.json');
  const stderrPath = path.join(stagingDir, 'pw-stderr.txt');
  const absoluteSpecPath = path.join(input.workspaceDir, input.plan.specPath);

  if (input.plan.expectedAssertions.length === 0) {
    return failedEvidencePlan(input.plan, 'Evidence plan declared no AFTER-state assertions');
  }
  if (!fs.existsSync(absoluteSpecPath)) {
    return failedEvidencePlan(input.plan, `Evidence spec not found at ${input.plan.specPath}`);
  }

  fs.mkdirSync(stagingDir, { recursive: true });

  const stdout = fs.openSync(resultsPath, 'w');
  const stderr = fs.openSync(stderrPath, 'w');
  try {
    spawn(
      'pnpm',
      [
        '--filter',
        '@goose-hub/web',
        'exec',
        'playwright',
        'test',
        webSpecPath(input.plan.specPath),
        '--config',
        'playwright-evidence.config.ts',
        '--reporter=json',
      ],
      {
        cwd: input.workspaceDir,
        stdio: ['ignore', stdout, stderr],
        env: { ...process.env, ...input.env },
      },
    );
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  stageScreenshotsFromWorktree({
    workspaceDir: input.workspaceDir,
    issueNumber: input.issueNumber,
    stagingDir,
  });

  const evidence = collect({
    issue: input.issueNumber,
    slug: input.plan.slug,
    phase: 'after',
    resultsPath,
    evidenceDir: stagingDir,
    runFfmpeg: true,
  });

  if (
    evidence.classification !== 'passed' ||
    (evidence.screenshots.length === 0 && evidence.gifPath == null)
  ) {
    return assembleEvidencePostPayload({
      evidence,
      plan: input.plan,
      issueNumber: input.issueNumber,
      repo: input.repo,
    });
  }

  const published = publishEvidence({
    evidence,
    plan: input.plan,
    workspaceDir: input.workspaceDir,
    issueNumber: input.issueNumber,
    repo: input.repo,
    prNumber: input.prNumber,
    prHeadSha: input.prHeadSha,
    beforeCommentUrl: input.beforeCommentUrl,
    run,
  });

  return assembleEvidencePostPayload({
    evidence,
    plan: input.plan,
    issueNumber: input.issueNumber,
    repo: input.repo,
    sha: published.sha,
    commentUrl: published.commentUrl,
  });
}
