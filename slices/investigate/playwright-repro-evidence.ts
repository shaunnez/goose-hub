import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  InvestigationReproPacket,
  PlaywrightReproOutput,
  PlaywrightReproSpecOutput,
} from '@goose-hub/skills/playwright-repro/schema.js';
import { collectPlaywrightEvidence } from '../../scripts/collect-playwright-evidence.js';
import type { PlaywrightEvidence } from '../../scripts/collect-playwright-evidence.js';

export function shouldSkipBeforeEvidence(packet: InvestigationReproPacket | null | undefined) {
  return (
    packet?.skipBeforeEvidenceEligible === true &&
    packet.confidence === 'high' &&
    packet.route != null &&
    packet.route.length > 0 &&
    packet.selectors.length > 0
  );
}

export interface PlaywrightEvidencePublisher {
  execFileSync?: typeof execFileSync;
  spawnSync?: typeof spawnSync;
  collect?: typeof collectPlaywrightEvidence;
}

export interface RunPlaywrightReproPlanInput {
  plan: PlaywrightReproSpecOutput;
  workspaceDir: string;
  issueNumber: number;
  repo: string;
  publisher?: PlaywrightEvidencePublisher;
}

function webSpecPath(specPath: string): string {
  return specPath.startsWith('apps/web/') ? specPath.slice('apps/web/'.length) : specPath;
}

function materializeSpec(workspaceDir: string, plan: PlaywrightReproSpecOutput): void {
  const webRelativePath = webSpecPath(plan.specPath);
  const normalizedWebPath = path.normalize(webRelativePath);
  if (
    path.isAbsolute(plan.specPath) ||
    normalizedWebPath.startsWith('..') ||
    !normalizedWebPath.startsWith(`e2e${path.sep}`)
  ) {
    throw new Error(`Invalid playwright repro specPath: ${plan.specPath}`);
  }

  const specPath = path.join(workspaceDir, 'apps', 'web', normalizedWebPath);
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, plan.specSource);
}

function evidencePath(issueNumber: number, filePath: string): string {
  return `evidence/issue-${issueNumber}/${path.basename(filePath)}`;
}

function buildRawUrl(repo: string, sha: string, evidenceFile: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${evidenceFile}`;
}

function copyIfPresent(source: string | null, targetDir: string): string | null {
  if (source == null || !fs.existsSync(source)) return null;
  const target = path.join(targetDir, path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

function publishEvidence(params: {
  evidence: PlaywrightEvidence;
  plan: PlaywrightReproSpecOutput;
  workspaceDir: string;
  issueNumber: number;
  repo: string;
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
    // Best-effort cleanup of a stale helper worktree.
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
    `evidence: before-state for issue #${params.issueNumber}`,
  ]);
  const sha = params
    .run('git', ['-C', helperWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    .toString()
    .trim();
  params.run('git', ['-C', helperWorktree, 'push', 'origin', branch]);

  const images = params.evidence.screenshots
    .map((screenshot, index) => {
      const file = evidencePath(params.issueNumber, screenshot);
      return `![Step ${index + 1}](${buildRawUrl(params.repo, sha, file)})`;
    })
    .join('\n');
  const gif =
    params.evidence.gifPath == null
      ? ''
      : `\n![walkthrough](${buildRawUrl(params.repo, sha, evidencePath(params.issueNumber, params.evidence.gifPath))})`;
  const body = `## Before-state: #${params.issueNumber}\n\n${params.plan.evidenceIntent}\n\n${images}${gif}\n\n_Pinned to \`${sha}\` during investigation_`;
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

export function assemblePlaywrightReproPayload(params: {
  evidence: PlaywrightEvidence;
  plan: PlaywrightReproSpecOutput;
  issueNumber: number;
  repo: string;
  sha?: string;
  commentUrl?: string;
}): PlaywrightReproOutput {
  const screenshots = params.evidence.screenshots.map((screenshot, index) => {
    const file = evidencePath(params.issueNumber, screenshot);
    return {
      path: file,
      caption: `Step ${index + 1}`,
      step: index + 1,
      ...(params.sha != null ? { githubUrl: buildRawUrl(params.repo, params.sha, file) } : {}),
    };
  });
  const gifPath =
    params.evidence.gifPath == null
      ? null
      : evidencePath(params.issueNumber, params.evidence.gifPath);
  return {
    screenshots,
    gifPath,
    consoleErrors: params.evidence.errors.map((message) => ({ message, type: 'error' as const })),
    reproSteps: params.plan.reproSteps,
    reproduced: params.evidence.classification === 'reproduced',
    notes: params.evidence.notes,
    ...(params.commentUrl != null ? { commentUrl: params.commentUrl } : {}),
  };
}

export function runPlaywrightReproPlan(input: RunPlaywrightReproPlanInput): PlaywrightReproOutput {
  const run = input.publisher?.execFileSync ?? execFileSync;
  const spawn = input.publisher?.spawnSync ?? spawnSync;
  const collect = input.publisher?.collect ?? collectPlaywrightEvidence;
  const evidenceDir = `/tmp/repro-${input.plan.slug}`;
  const resultsPath = path.join(evidenceDir, 'pw-results.json');
  const stderrPath = path.join(evidenceDir, 'pw-stderr.txt');
  fs.mkdirSync(evidenceDir, { recursive: true });
  materializeSpec(input.workspaceDir, input.plan);

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
      { cwd: input.workspaceDir, stdio: ['ignore', stdout, stderr] },
    );
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  const evidence = collect({
    issue: input.issueNumber,
    slug: input.plan.slug,
    phase: 'before',
    resultsPath,
    evidenceDir,
    runFfmpeg: true,
  });

  if (evidence.classification !== 'reproduced' || evidence.screenshots.length === 0) {
    return assemblePlaywrightReproPayload({
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
    run,
  });
  return assemblePlaywrightReproPayload({
    evidence,
    plan: input.plan,
    issueNumber: input.issueNumber,
    repo: input.repo,
    sha: published.sha,
    commentUrl: published.commentUrl,
  });
}
