import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectPlaywrightEvidence,
  extractFirstJsonValue,
  type EvidencePhase,
} from './collect-playwright-evidence.js';

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'pw-evidence-'));
}

function writeResults(dir: string, json: unknown, suffix = ''): string {
  const resultsPath = path.join(dir, 'pw-results.json');
  writeFileSync(resultsPath, `${JSON.stringify(json, null, 2)}${suffix}`, 'utf8');
  return resultsPath;
}

function resultJson(overrides: Record<string, unknown> = {}) {
  return {
    suites: [
      {
        specs: [
          {
            tests: [
              {
                results: [
                  {
                    status: 'passed',
                    errors: [],
                    stdout: [{ text: 'REPRO_CONSOLE []' }],
                    attachments: [
                      { name: 'video', contentType: 'video/webm', path: '/tmp/video.webm' },
                    ],
                    ...overrides,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function collect(params: {
  phase?: EvidencePhase;
  resultsPath: string;
  evidenceDir: string;
  runFfmpeg?: boolean;
}) {
  return collectPlaywrightEvidence({
    issue: 793,
    slug: 'repro-change-goose-hub-header-3',
    phase: params.phase ?? 'before',
    resultsPath: params.resultsPath,
    evidenceDir: params.evidenceDir,
    runFfmpeg: params.runFfmpeg ?? false,
  });
}

describe('collect-playwright-evidence', () => {
  it('parses clean Playwright JSON and finds screenshots/video', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(path.join(dir, 'step-1.png'), 'png', 'utf8');
      const resultsPath = writeResults(dir, resultJson());

      const evidence = collect({ resultsPath, evidenceDir: dir });

      expect(evidence.classification).toBe('passed');
      expect(evidence.screenshots).toEqual([path.join(dir, 'step-1.png')]);
      expect(evidence.videoPath).toBe('/tmp/video.webm');
      expect(evidence.stdout).toContain('REPRO_CONSOLE []');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates trailing undefined and pnpm failure text after JSON', () => {
    const parsed = extractFirstJsonValue('{"ok":true}\nundefined\nERR_PNPM_RECURSIVE_RUN_FIRST_FAIL');
    expect(parsed).toEqual({ ok: true });
  });

  it('classifies a failed expected bug assertion as reproduced for before-state evidence', () => {
    const dir = makeTmpDir();
    try {
      const resultsPath = writeResults(
        dir,
        resultJson({
          status: 'failed',
          errors: [
            {
              message:
                'Error: REPRO_EXPECTED_BUG expect.soft(locator).toBeVisible() failed for broken header',
            },
          ],
        }),
      );

      const evidence = collect({ resultsPath, evidenceDir: dir, phase: 'before' });

      expect(evidence.classification).toBe('reproduced');
      expect(evidence.reproduced).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies a failed assertion as validation_failed for after-state evidence', () => {
    const dir = makeTmpDir();
    try {
      const resultsPath = writeResults(
        dir,
        resultJson({
          status: 'failed',
          errors: [{ message: 'Error: expect(locator).toHaveText() failed' }],
        }),
      );

      const evidence = collect({ resultsPath, evidenceDir: dir, phase: 'after' });

      expect(evidence.classification).toBe('validation_failed');
      expect(evidence.reproduced).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies server and webServer failures as setup_failed', () => {
    const dir = makeTmpDir();
    try {
      const resultsPath = writeResults(dir, {
        errors: [{ message: 'webServer failed to start: ECONNREFUSED 127.0.0.1:5173' }],
      });

      const evidence = collect({ resultsPath, evidenceDir: dir });

      expect(evidence.classification).toBe('setup_failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns gifPath null when no video attachment exists', () => {
    const dir = makeTmpDir();
    try {
      const resultsPath = writeResults(dir, resultJson({ attachments: [] }));

      const evidence = collect({ resultsPath, evidenceDir: dir });

      expect(evidence.videoPath).toBeNull();
      expect(evidence.gifPath).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not fail the collector when ffmpeg fails', () => {
    const dir = makeTmpDir();
    try {
      const resultsPath = writeResults(
        dir,
        resultJson({
          attachments: [
            {
              name: 'video',
              contentType: 'video/webm',
              path: path.join(dir, 'missing-video.webm'),
            },
          ],
        }),
      );

      const evidence = collect({ resultsPath, evidenceDir: dir, runFfmpeg: true });

      expect(evidence.gifPath).toBeNull();
      expect(typeof evidence.ffmpegError).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
