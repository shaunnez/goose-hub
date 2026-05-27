import type { ProviderError } from './errors.js';
import { providerError } from './errors.js';

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export interface JiraParseConfig {
  baseUrl: string;
  projectKeys: readonly string[];
}

export interface JiraIssueRef {
  provider: 'jira';
  level: 'L0';
  key: string;
  projectKey: string;
  url: string;
}

export type JiraIssueRefResult =
  | { ok: true; ref: JiraIssueRef }
  | { ok: false; error: ProviderError };

export function parseJiraIssueRef(input: string, config: JiraParseConfig): JiraIssueRefResult {
  const value = input.trim();
  const exactKey = normalizeJiraKey(value);
  if (exactKey != null) return refFromKey(exactKey, config);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      error: providerError(
        'validation',
        'Jira input must be an exact issue key or configured browse URL',
      ),
    };
  }

  const configuredBase = parseConfiguredBaseUrl(config.baseUrl);
  if (configuredBase == null || url.origin !== configuredBase.origin) {
    return {
      ok: false,
      error: providerError('validation', 'Jira browse URL does not match the configured base URL'),
    };
  }

  const browseMatch = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9]+-\d+)\/?$/);
  if (browseMatch == null) {
    return {
      ok: false,
      error: providerError('validation', 'Jira browse URL must use /browse/<KEY>'),
    };
  }

  return refFromKey(browseMatch[1], config);
}

export function normalizeJiraKey(input: string): string | null {
  const value = input.trim().toUpperCase();
  return JIRA_KEY_PATTERN.test(value) ? value : null;
}

function refFromKey(key: string, config: JiraParseConfig): JiraIssueRefResult {
  const projectKey = key.split('-')[0];
  if (!config.projectKeys.includes(projectKey)) {
    return {
      ok: false,
      error: providerError('validation', `Jira project key '${projectKey}' is not configured`),
    };
  }

  return {
    ok: true,
    ref: {
      provider: 'jira',
      level: 'L0',
      key,
      projectKey,
      url: `${trimTrailingSlash(config.baseUrl)}/browse/${key}`,
    },
  };
}

function parseConfiguredBaseUrl(baseUrl: string): URL | null {
  try {
    return new URL(trimTrailingSlash(baseUrl));
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
