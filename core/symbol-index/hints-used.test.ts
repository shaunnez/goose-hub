import { describe, expect, it, vi } from 'vitest';
import {
  detectSymbolIndexHintsUsed,
  emitSymbolIndexHintsUsedEvent,
  offeredHintsFromScoutSymbolIndexHints,
  offeredHintsFromSymbolImpact,
  offeredHintsFromSymbolKeyFiles,
} from './hints-used.js';

describe('symbol-index hints-used detection', () => {
  it('returns null when no offered hint path appears in tool-call payloads', () => {
    const payload = detectSymbolIndexHintsUsed({
      consumerSkill: 'scout-code-path',
      runId: 'run-1',
      offeredHints: [{ name: 'AuthPayload', path: 'skills/auth/schema.ts', source: 'definition' }],
      toolEvents: [
        {
          payload: {
            tool_name: 'Read',
            tool_input: { file_path: 'skills/payments/schema.ts' },
          },
        },
      ],
    });

    expect(payload).toBeNull();
  });

  it('detects exact file reads and shell searches of hinted paths', () => {
    const payload = detectSymbolIndexHintsUsed({
      consumerSkill: 'scout-schema',
      runId: 'run-2',
      parentRunId: 'parent-1',
      offeredHints: [
        { name: 'AuthPayload', path: 'skills/auth/schema.ts', source: 'definition' },
        { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'importer' },
      ],
      toolEvents: [
        {
          payload: {
            tool_name: 'Read',
            tool_input: { file_path: '/repo/skills/auth/schema.ts' },
          },
        },
        {
          payload: {
            tool_name: 'Bash',
            tool_input: { command: 'rg dispatchWave slices/investigate/workflow.ts' },
          },
        },
      ],
      worktreePath: '/repo',
    });

    expect(payload).toEqual({
      consumerSkill: 'scout-schema',
      runId: 'run-2',
      parentRunId: 'parent-1',
      offeredHintCount: 2,
      usedHintCount: 2,
      detectionMethod: 'tool-call-path-match',
      usedHints: [
        { name: 'AuthPayload', path: 'skills/auth/schema.ts', source: 'definition' },
        { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'importer' },
      ],
    });
  });

  it('caps emitted usedHints while preserving the full usedHintCount', () => {
    const offeredHints = Array.from({ length: 10 }, (_, idx) => ({
      name: `Hint${idx}`,
      path: `src/hint-${idx}.ts`,
      source: 'definition' as const,
    }));
    const payload = detectSymbolIndexHintsUsed({
      consumerSkill: 'scout-code-path',
      runId: 'run-3',
      offeredHints,
      toolEvents: offeredHints.map((hint) => ({
        payload: { tool_name: 'Read', tool_input: { file_path: hint.path } },
      })),
      maxUsedHints: 8,
    });

    expect(payload?.usedHintCount).toBe(10);
    expect(payload?.usedHints).toHaveLength(8);
  });

  it('emits symbol-index.hints-used only when detection finds usage', () => {
    const appendEvent = vi.fn();

    const payload = emitSymbolIndexHintsUsedEvent({
      projectId: 'proj',
      workItemId: 'github:owner/repo#1',
      consumerSkill: 'implement',
      runId: 'run-4',
      offeredHints: [
        { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'key-file' },
      ],
      toolEvents: [
        {
          payload: {
            tool_name: 'Grep',
            tool_input: { path: 'slices/investigate/workflow.ts', pattern: 'dispatchWave' },
          },
        },
      ],
      appendEvent,
    });

    expect(payload?.usedHintCount).toBe(1);
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'symbol-index.hints-used',
        payload: expect.objectContaining({
          consumerSkill: 'implement',
          usedHintCount: 1,
        }),
      }),
    );
  });

  it('shapes scout, key-file, and symbol-impact offers with source labels', () => {
    expect(
      offeredHintsFromScoutSymbolIndexHints([
        {
          name: 'AuthPayload',
          definedIn: 'skills/auth/schema.ts',
          importers: ['skills/auth/prompt.ts'],
          nearbyTests: ['skills/auth/slice.test.ts'],
        },
      ]),
    ).toEqual([
      { name: 'AuthPayload', path: 'skills/auth/schema.ts', source: 'definition' },
      { name: 'AuthPayload', path: 'skills/auth/prompt.ts', source: 'importer' },
      { name: 'AuthPayload', path: 'skills/auth/slice.test.ts', source: 'nearby-test' },
    ]);

    expect(
      offeredHintsFromSymbolKeyFiles([
        { path: 'slices/investigate/workflow.ts', reason: 'Symbol index: imports dispatchWave' },
      ]),
    ).toEqual([
      { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'key-file' },
    ]);

    expect(
      offeredHintsFromSymbolImpact([
        {
          changedExport: 'dispatchWave',
          definedIn: 'core/agent-runtime/swarm.ts',
          importers: ['slices/investigate/workflow.ts'],
        },
      ]),
    ).toEqual([
      { name: 'dispatchWave', path: 'core/agent-runtime/swarm.ts', source: 'symbol-impact' },
      { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'symbol-impact' },
    ]);
  });
});
