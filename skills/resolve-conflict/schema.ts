import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const ResolveConflictContextSchema = z.object({
  worktreePath: z
    .string()
    .describe('Absolute path to the worktree where conflict markers are present'),
  conflictedFiles: z.array(z.string()).describe('Workspace-relative paths of conflicted files'),
  baseBranch: z.string().describe('Branch being merged in (e.g. main)'),
  prNumber: z.number().int().describe('PR number under resolution (context only)'),
});

export const ResolveConflictSchema = z.object({
  resolved: z
    .array(z.string())
    .describe('Workspace-relative paths of files the agent successfully resolved'),
  unresolvable: z
    .array(z.string())
    .describe('Workspace-relative paths of files the agent could not resolve confidently'),
  confidence: z.enum(['low', 'medium', 'high']),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type ResolveConflictOutput = z.infer<typeof ResolveConflictSchema>;
