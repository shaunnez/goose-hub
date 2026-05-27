import type { JiraProviderAdapter } from '../atlassian/adapters.js';
import type { AtlassianArtifactRef, JiraIssueDetailDto } from '../atlassian/dtos.js';
import { JiraIssueDetailSchema } from '../atlassian/dtos.js';
import {
  type ProviderResult,
  mapHttpStatusToProviderErrorKind,
  providerFailure,
} from '../atlassian/errors.js';
import { offloadAtlassianPayload } from '../atlassian/payload-offload.js';

export interface JiraRestArtifactContext {
  projectId: string;
  workItemId?: string | null;
  runId: string;
  thresholdBytes?: number;
}

export interface JiraRestAdapterOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  artifactContext?: JiraRestArtifactContext;
}

export interface JiraRestAdapterFromEnvOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  artifactContext?: JiraRestArtifactContext;
}

interface JiraRestIssue {
  id?: unknown;
  key?: unknown;
  self?: unknown;
  fields?: {
    summary?: unknown;
    description?: unknown;
    status?: { name?: unknown } | null;
    issuetype?: { name?: unknown } | null;
    priority?: { name?: unknown } | null;
    assignee?: {
      displayName?: unknown;
      accountId?: unknown;
      emailAddress?: unknown;
    } | null;
    labels?: unknown;
    components?: unknown;
    created?: unknown;
    updated?: unknown;
    issuelinks?: unknown;
  };
}

export function createJiraRestAdapterFromEnv(
  options: JiraRestAdapterFromEnvOptions,
): JiraProviderAdapter {
  const email = process.env.JIRA_EMAIL ?? process.env.ATLASSIAN_EMAIL ?? '';
  const apiToken = process.env.JIRA_API_TOKEN ?? process.env.ATLASSIAN_API_TOKEN ?? '';
  if (email.trim().length === 0 || apiToken.trim().length === 0) {
    return missingCredentialsAdapter();
  }
  return createJiraRestAdapter({
    ...options,
    email,
    apiToken,
  });
}

export function createJiraRestAdapter(options: JiraRestAdapterOptions): JiraProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const authorization = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString(
    'base64',
  )}`;

  return {
    async getIssue({ key }): Promise<ProviderResult<JiraIssueDetailDto>> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`, {
          headers: {
            Accept: 'application/json',
            Authorization: authorization,
          },
        });
      } catch (err) {
        return providerFailure('connection', `Failed to connect to Jira: ${String(err)}`);
      }

      if (!response.ok) {
        return providerFailure(
          mapHttpStatusToProviderErrorKind(response.status, 'read'),
          response.statusText || `Jira request failed with ${response.status}`,
          { status: response.status },
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (err) {
        return providerFailure('connection', `Failed to parse Jira response: ${String(err)}`);
      }

      try {
        return {
          ok: true,
          data: JiraIssueDetailSchema.parse(mapRestIssue(raw, baseUrl, options.artifactContext)),
        };
      } catch (err) {
        return providerFailure(
          'validation',
          `Jira issue response failed validation: ${String(err)}`,
        );
      }
    },
    async searchIssues() {
      return providerFailure('query', 'Jira search is not implemented for manual import');
    },
    async getCurrentUser() {
      return providerFailure(
        'auth',
        'Jira current-user lookup is not implemented for manual import',
      );
    },
  };
}

function missingCredentialsAdapter(): JiraProviderAdapter {
  return {
    async getIssue() {
      return providerFailure('auth', 'Jira credentials are not configured');
    },
    async searchIssues() {
      return providerFailure('auth', 'Jira credentials are not configured');
    },
    async getCurrentUser() {
      return providerFailure('auth', 'Jira credentials are not configured');
    },
  };
}

function mapRestIssue(
  raw: unknown,
  baseUrl: string,
  artifactContext: JiraRestArtifactContext | undefined,
): JiraIssueDetailDto {
  const issue = raw as JiraRestIssue;
  const fields = issue.fields ?? {};
  const key = stringValue(issue.key);
  const descriptionText = jiraRichTextToPlainText(fields.description);
  const bodyArtifactRef = offloadArtifactRef({
    context: artifactContext,
    key,
    tier: 'detail',
    suffix: 'body',
    payload: fields.description,
    summary: `Full Jira description for ${key}`,
  });
  const rawArtifactRef = offloadArtifactRef({
    context: artifactContext,
    key,
    tier: 'evidence',
    suffix: 'raw',
    payload: raw,
    summary: `Raw Jira issue response for ${key}`,
  });

  return {
    provider: 'jira',
    resourceKind: 'issue',
    tier: 'detail',
    id: stringValue(issue.id) || key,
    key,
    title: stringValue(fields.summary) || key,
    status: stringValue(fields.status?.name) || 'Unknown',
    url: `${baseUrl}/browse/${encodeURIComponent(key)}`,
    project: key.includes('-') ? key.split('-')[0] : undefined,
    issueType: stringValue(fields.issuetype?.name) || undefined,
    priority: stringValue(fields.priority?.name) || undefined,
    assignee: mapAssignee(fields.assignee),
    created: stringValue(fields.created) || undefined,
    updated: stringValue(fields.updated) || undefined,
    bodyPreview: descriptionText.length > 0 ? descriptionText.slice(0, 4000) : undefined,
    bodyArtifactRef,
    rawArtifactRef,
    labels: arrayOfStrings(fields.labels),
    components: arrayOfNamedValues(fields.components),
    linkedKeys: linkedIssueKeys(fields.issuelinks),
  };
}

function offloadArtifactRef(input: {
  context: JiraRestArtifactContext | undefined;
  key: string;
  tier: 'detail' | 'evidence';
  suffix: string;
  payload: unknown;
  summary: string;
}): AtlassianArtifactRef | undefined {
  if (input.context == null || input.payload == null) return undefined;
  const result = offloadAtlassianPayload({
    projectId: input.context.projectId,
    workItemId: input.context.workItemId,
    runId: input.context.runId,
    provider: 'jira',
    tier: input.tier,
    resourceId: input.key,
    userFacingArgs: {
      key: input.key,
      field: input.suffix,
    },
    payload: input.payload,
    summary: input.summary,
    thresholdBytes: input.context.thresholdBytes,
  });
  return result.artifactRef ?? undefined;
}

function mapAssignee(
  assignee:
    | {
        displayName?: unknown;
        accountId?: unknown;
        emailAddress?: unknown;
      }
    | null
    | undefined,
) {
  if (assignee == null || typeof assignee !== 'object') return undefined;
  const value = assignee as {
    displayName?: unknown;
    accountId?: unknown;
    emailAddress?: unknown;
  };
  const displayName = stringValue(value.displayName);
  if (displayName.length === 0) return undefined;
  return {
    displayName,
    accountId: stringValue(value.accountId) || undefined,
    emailAddress: stringValue(value.emailAddress) || undefined,
  };
}

function jiraRichTextToPlainText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(jiraRichTextToPlainText).filter(Boolean).join('\n');
  if (value == null || typeof value !== 'object') return '';
  const node = value as { text?: unknown; content?: unknown; type?: unknown };
  const ownText = typeof node.text === 'string' ? node.text : '';
  const childText = jiraRichTextToPlainText(node.content);
  const separator = node.type === 'paragraph' ? '\n' : '';
  return [ownText, childText].filter(Boolean).join(separator).trim();
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = stringValue(entry);
    return text.length > 0 ? [text] : [];
  });
}

function arrayOfNamedValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry == null || typeof entry !== 'object') return [];
    const name = stringValue((entry as { name?: unknown }).name);
    return name.length > 0 ? [name] : [];
  });
}

function linkedIssueKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((link) => {
        if (link == null || typeof link !== 'object') return [];
        const candidate = link as {
          inwardIssue?: { key?: unknown };
          outwardIssue?: { key?: unknown };
        };
        return [
          stringValue(candidate.inwardIssue?.key),
          stringValue(candidate.outwardIssue?.key),
        ].filter((key) => key.length > 0);
      }),
    ),
  ];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
