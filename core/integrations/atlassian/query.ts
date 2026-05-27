import type { JiraIssueSearchRequest, JiraProviderAdapter, JiraQueryLevel } from './adapters.js';
import type { ProviderError, ProviderResult } from './errors.js';
import { providerError } from './errors.js';
import { type JiraParseConfig, parseJiraIssueRef } from './jira.js';

export interface JiraQueryCaps {
  maxResults?: number;
  maxLookbackDays?: number;
}

export type JiraSafeQueryInput =
  | {
      kind: 'manual';
      value: string;
      tier?: 'headline' | 'card' | 'detail';
      maxResults?: number;
    }
  | {
      kind: 'project';
      text?: string;
      projects?: string[];
      updatedSince?: string;
      updatedUntil?: string;
      maxResults?: number;
    }
  | {
      kind: 'assigned-to-me';
      accountId: string;
      projects?: string[];
      updatedSince?: string;
      updatedUntil?: string;
      maxResults?: number;
    }
  | {
      kind: 'free-text';
      text: string;
      projects?: string[];
      updatedSince?: string;
      updatedUntil?: string;
      maxResults?: number;
    };

export type ResolvedJiraQuery =
  | {
      provider: 'jira';
      level: 'L0';
      exact: {
        key: string;
        url: string;
        tier: 'headline' | 'card' | 'detail';
      };
    }
  | {
      provider: 'jira';
      level: Exclude<JiraQueryLevel, 'L0'>;
      search: JiraIssueSearchRequest;
    };

export type ResolvedJiraQueryResult =
  | { ok: true; query: ResolvedJiraQuery }
  | { ok: false; error: ProviderError };

export interface ResolveJiraQueryOptions {
  config: JiraParseConfig;
  input: JiraSafeQueryInput;
  caps?: JiraQueryCaps;
  now?: Date;
}

export function resolveJiraQuery(options: ResolveJiraQueryOptions): ResolvedJiraQueryResult {
  const { config, input } = options;
  if (input.kind === 'manual') {
    const parsed = parseJiraIssueRef(input.value, config);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      query: {
        provider: 'jira',
        level: 'L0',
        exact: {
          key: parsed.ref.key,
          url: parsed.ref.url,
          tier: input.tier ?? 'detail',
        },
      },
    };
  }

  const rawText = 'text' in input ? input.text : undefined;
  if (rawText != null && looksLikeRawProviderQuery(rawText)) {
    return {
      ok: false,
      error: providerError('validation', 'Raw JQL/CQL is not accepted by Atlassian query helpers'),
    };
  }

  const projects = resolveProjects(config.projectKeys, input.projects);
  if (projects.length === 0) {
    return {
      ok: false,
      error: providerError('validation', 'At least one configured Jira project is required'),
    };
  }

  const maxResults = capMaxResults(input.maxResults, options.caps?.maxResults);
  const updated = resolveUpdatedRange({
    now: options.now ?? new Date(),
    updatedSince: input.updatedSince,
    updatedUntil: input.updatedUntil,
    maxLookbackDays: options.caps?.maxLookbackDays,
  });
  if (!updated.ok) return updated;

  const level = levelForInput(input.kind);
  return {
    ok: true,
    query: {
      provider: 'jira',
      level,
      search: {
        level,
        projects,
        updated: updated.range,
        maxResults,
        text: rawText?.trim() || undefined,
        assignee: input.kind === 'assigned-to-me' ? { accountId: input.accountId } : undefined,
      },
    },
  };
}

export async function executeJiraQuery<T>({
  adapter,
  ...options
}: ResolveJiraQueryOptions & {
  adapter: JiraProviderAdapter;
}): Promise<ProviderResult<T>> {
  const resolved = resolveJiraQuery(options);
  if (!resolved.ok) return resolved;

  if (resolved.query.level === 'L0') {
    return adapter.getIssue({
      key: resolved.query.exact.key,
      tier: resolved.query.exact.tier,
    }) as Promise<ProviderResult<T>>;
  }

  return adapter.searchIssues(resolved.query.search) as Promise<ProviderResult<T>>;
}

function levelForInput(kind: JiraSafeQueryInput['kind']): Exclude<JiraQueryLevel, 'L0'> {
  if (kind === 'project') return 'L1';
  if (kind === 'assigned-to-me') return 'L2';
  return 'L3';
}

function resolveProjects(configured: readonly string[], requested?: readonly string[]): string[] {
  const configuredSet = new Set(configured);
  const source = requested == null || requested.length === 0 ? configured : requested;
  return [...new Set(source.filter((project) => configuredSet.has(project)))];
}

function capMaxResults(requested: number | undefined, cap = 50): number {
  const effective = requested == null || !Number.isFinite(requested) ? cap : requested;
  return Math.min(Math.max(1, Math.floor(effective)), cap);
}

function resolveUpdatedRange(input: {
  now: Date;
  updatedSince?: string;
  updatedUntil?: string;
  maxLookbackDays?: number;
}): { ok: true; range: JiraIssueSearchRequest['updated'] } | { ok: false; error: ProviderError } {
  const nowMs = input.now.getTime();
  const lookbackDays = Math.max(1, Math.floor(input.maxLookbackDays ?? 90));
  const earliestAllowed = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

  const parsedTo = input.updatedUntil == null ? nowMs : Date.parse(input.updatedUntil);
  if (!Number.isFinite(parsedTo)) {
    return {
      ok: false,
      error: providerError('validation', 'updatedUntil must be an ISO date string'),
    };
  }
  const toMs = Math.min(parsedTo, nowMs);

  const parsedFrom = input.updatedSince == null ? earliestAllowed : Date.parse(input.updatedSince);
  if (!Number.isFinite(parsedFrom)) {
    return {
      ok: false,
      error: providerError('validation', 'updatedSince must be an ISO date string'),
    };
  }
  const fromMs = Math.min(Math.max(parsedFrom, earliestAllowed), toMs);

  return {
    ok: true,
    range: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
  };
}

function looksLikeRawProviderQuery(text: string): boolean {
  return /\b(project|assignee|updated|status|issuekey|key|order\s+by|space|type)\s*(=|!=|~|>|<|\bin\b)/i.test(
    text,
  );
}
