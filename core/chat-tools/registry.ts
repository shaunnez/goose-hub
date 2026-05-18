import { z } from 'zod';

/**
 * The catalog of chat tools. Implementations live next to the dispatcher in
 * apps/server. This registry is the contract the agent sees: a name, an input
 * schema, a description, and a mutating flag. Mutating tools require human
 * approval in the UI before the dispatcher runs them.
 *
 * Every tool name MUST appear here exactly once. The agent's output schema
 * uses this list (see skills/hub-chat/schema.ts) so adding a tool elsewhere
 * without registering it here will be rejected by the agent's structured
 * output.
 */
export interface ChatToolManifestEntry {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: z.ZodType;
}

const NoArgs = z.object({});

const SlugInput = z.object({ projectSlug: z.string().min(1) });

const FindPrInput = z.object({
  query: z.string().min(1).describe('PR number, branch name, or free-text title query'),
  projectSlug: z.string().optional(),
});

const GetIssueInput = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.union([z.number().int().positive(), z.string()]),
});

const ListOpenIssuesInput = z.object({
  projectSlug: z.string().min(1),
  milestoneNumber: z.number().int().positive().optional(),
  state: z.enum(['any', 'in-progress', 'needs-human', 'gate-pending']).optional(),
  limit: z.number().int().positive().max(50).default(20).optional(),
});

const RecentEventsInput = z.object({
  projectSlug: z.string().optional(),
  workItemId: z.string().optional(),
  limit: z.number().int().positive().max(50).default(20).optional(),
});

const InvokeSkillInput = z.object({
  skillName: z.string().min(1),
  projectSlug: z.string().min(1),
  workItemId: z.string().optional(),
  rationale: z
    .string()
    .min(1)
    .describe('Why you are running this skill, shown to the human approver.'),
});

const TransitionIssueInput = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.union([z.number().int().positive(), z.string()]),
  toState: z.string().min(1),
  rationale: z.string().min(1),
});

const CommentOnIssueInput = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.union([z.number().int().positive(), z.string()]),
  body: z.string().min(1),
});

const TickProjectInput = z.object({
  projectSlug: z.string().min(1),
  rationale: z.string().min(1),
});

const CreateInboxNoteInput = z.object({
  title: z.string().min(1),
  body: z.string().default('').optional(),
  type: z.enum(['feature', 'bug', 'chore', 'research']).default('feature').optional(),
});

const OpenUrlInput = z.object({
  path: z
    .string()
    .startsWith('/')
    .describe('Internal app path (e.g. /projects/goose-hub-self/items/123).'),
  rationale: z.string().min(1),
});

const SubscribeToRunInput = z.object({
  runId: z.string().min(1).describe('Run identifier emitted on agent.run-started events.'),
  rationale: z
    .string()
    .min(1)
    .describe('Why this run is worth waiting on — shown to the human approver.'),
});

const SubscribeToIssueInput = z.object({
  projectSlug: z.string().min(1),
  issueNumber: z.union([z.number().int().positive(), z.string()]),
  rationale: z.string().min(1),
});

/**
 * Whitelist of project-settings keys writable via `update_settings`. Mirrors
 * the validation in `apps/server/src/domains/chat/tools.ts`; the chat agent
 * sees this list through the input schema description so it cannot propose
 * fields outside the safe set.
 */
export const UPDATE_SETTINGS_KEYS = [
  'perWorkflowMaxUsd',
  'perAgentMaxUsd',
  'perAdvisorMaxUsd',
  'useMultiAgentPipeline',
  'useInvestigationSwarm',
  'maxParallelAgents',
  'maxRetries',
  'qaE2eMode',
] as const;

const UpdateSettingsInput = z.object({
  projectSlug: z.string().min(1),
  key: z
    .enum(UPDATE_SETTINGS_KEYS)
    .describe('One of the whitelisted setting keys; arbitrary keys are rejected.'),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .describe('Value for the key — type is validated per-key by the dispatcher.'),
  rationale: z.string().min(1),
});

const SetActiveMilestoneInput = z.object({
  projectSlug: z.string().min(1),
  milestoneNumber: z.number().int().nonnegative().nullable().describe('Null clears the override.'),
  rationale: z.string().min(1),
});

export const CHAT_TOOL_REGISTRY: ChatToolManifestEntry[] = [
  // ── Read-only ────────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description:
      'List every registered target project with slug, name, mode, and active milestone.',
    mutating: false,
    inputSchema: NoArgs,
  },
  {
    name: 'list_skills',
    description: 'List every skill in the Factory skills catalog with role and one-line summary.',
    mutating: false,
    inputSchema: NoArgs,
  },
  {
    name: 'list_open_issues',
    description: 'List open work items for a project. Optionally filter by milestone or state.',
    mutating: false,
    inputSchema: ListOpenIssuesInput,
  },
  {
    name: 'get_issue',
    description: 'Fetch a single work item including state labels, milestone, and body.',
    mutating: false,
    inputSchema: GetIssueInput,
  },
  {
    name: 'find_pr',
    description:
      'Find a pull request by number, branch name, or text. Returns matching PRs with URL and status.',
    mutating: false,
    inputSchema: FindPrInput,
  },
  {
    name: 'recent_events',
    description:
      'Read the most recent events from the event stream. Use this for status checks, "what is the agent doing", and post-mortem questions.',
    mutating: false,
    inputSchema: RecentEventsInput,
  },
  {
    name: 'list_milestones',
    description: 'List milestones for a project with open/closed counts and active flag.',
    mutating: false,
    inputSchema: SlugInput,
  },
  {
    name: 'get_settings',
    description:
      'Read resolved budget + flag settings for a project (perWorkflowMaxUsd, useMultiAgentPipeline, qaE2eMode, etc.) plus the currently active milestone.',
    mutating: false,
    inputSchema: SlugInput,
  },
  {
    name: 'what_needs_human_help',
    description:
      'Survey the event stream for work items currently waiting on human input (gate.awaiting-human, factory:needs-human, factory:gate-pending). Returns a prioritized list with links.',
    mutating: false,
    inputSchema: z.object({ projectSlug: z.string().optional() }),
  },
  // ── Mutating (require approval) ──────────────────────────────────────────
  {
    name: 'invoke_skill',
    description:
      'Manually invoke a Factory skill against a project or work item. Use sparingly — most work goes through the orchestrator.',
    mutating: true,
    inputSchema: InvokeSkillInput,
  },
  {
    name: 'transition_issue',
    description: 'Transition a work item to a new state by editing its factory:* label.',
    mutating: true,
    inputSchema: TransitionIssueInput,
  },
  {
    name: 'comment_on_issue',
    description: 'Post a comment on a GitHub work item.',
    mutating: true,
    inputSchema: CommentOnIssueInput,
  },
  {
    name: 'tick_project',
    description:
      'Trigger an orchestrator tick for a project — picks up the next eligible work item and dispatches the right workflow.',
    mutating: true,
    inputSchema: TickProjectInput,
  },
  {
    name: 'create_inbox_note',
    description:
      'Create a note in the global inbox. Useful for capturing follow-ups raised in chat.',
    mutating: true,
    inputSchema: CreateInboxNoteInput,
  },
  {
    name: 'open_url',
    description:
      'Navigate the active web UI to an internal path (e.g. open the kanban, an issue detail page, settings). Side-effect only: no return value.',
    mutating: true,
    inputSchema: OpenUrlInput,
  },
  {
    name: 'subscribe_to_run',
    description:
      'Watch an in-flight agent run by runId and post a follow-up chat message when it completes or fails. Auto-expires after 30 minutes.',
    mutating: true,
    inputSchema: SubscribeToRunInput,
  },
  {
    name: 'subscribe_to_issue',
    description:
      'Watch a work item for its next state.transitioned event and post a follow-up chat message when it lands. Auto-expires after 30 minutes.',
    mutating: true,
    inputSchema: SubscribeToIssueInput,
  },
  {
    name: 'update_settings',
    description:
      'Update a single whitelisted project setting (perWorkflowMaxUsd, useMultiAgentPipeline, qaE2eMode, etc.). Rejects unknown keys and type mismatches.',
    mutating: true,
    inputSchema: UpdateSettingsInput,
  },
  {
    name: 'set_active_milestone',
    description:
      "Flip the active milestone for a project. Pass null to clear the project_state override and fall back to the project config's milestone.",
    mutating: true,
    inputSchema: SetActiveMilestoneInput,
  },
];

const REGISTRY_BY_NAME = new Map(CHAT_TOOL_REGISTRY.map((t) => [t.name, t] as const));

export function getToolManifest(name: string): ChatToolManifestEntry | null {
  return REGISTRY_BY_NAME.get(name) ?? null;
}

export function listToolManifests(): ChatToolManifestEntry[] {
  return [...CHAT_TOOL_REGISTRY];
}

export const CHAT_TOOL_NAMES = CHAT_TOOL_REGISTRY.map((t) => t.name);

/** Zod enum of every registered tool name. Used by skill schemas. */
export const ChatToolNameSchema = z.enum(CHAT_TOOL_NAMES as [string, ...string[]]);
