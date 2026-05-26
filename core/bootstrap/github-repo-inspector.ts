import {
  type AuditResult,
  type InstructionFileReader,
  auditAgentInstructionsFromFiles,
} from './claude-md-auditor.js';
import { type StackInfo, detectStackFromFiles } from './stack-detector.js';

export interface InspectedGithubRepo {
  repoRef: string;
  defaultBranch: string;
  description: string;
  cloneUrl: string;
  stack: StackInfo;
  audit: AuditResult;
}

interface GhRepoMeta {
  default_branch?: string;
  description?: string | null;
  ssh_url?: string;
}

interface GhContentFile {
  type?: string;
  encoding?: string;
  content?: string;
}

export async function inspectGithubRepo(input: {
  fetchImpl: typeof fetch;
  token: string;
  repoRef: string;
}): Promise<InspectedGithubRepo> {
  const meta = await ghJson<GhRepoMeta>(
    input.fetchImpl,
    `https://api.github.com/repos/${input.repoRef}`,
    input.token,
  );
  const defaultBranch = meta.default_branch ?? 'main';
  const reader = githubContentReader(input.fetchImpl, input.token, input.repoRef, defaultBranch);
  const stack = await detectStackFromFiles(reader);
  const audit = await auditAgentInstructionsFromFiles(reader, {
    type: stack.type,
    commands: stack.type === 'node' ? stack.scripts : undefined,
  });

  return {
    repoRef: input.repoRef,
    defaultBranch,
    description: meta.description ?? '',
    cloneUrl: meta.ssh_url ?? `git@github.com:${input.repoRef}.git`,
    stack,
    audit,
  };
}

function githubContentReader(
  fetchImpl: typeof fetch,
  token: string,
  repoRef: string,
  ref: string,
): InstructionFileReader {
  const cache = new Map<string, string | null>();

  async function readMaybe(filePath: string): Promise<string | null> {
    if (cache.has(filePath)) return cache.get(filePath) ?? null;

    const url = `https://api.github.com/repos/${repoRef}/contents/${filePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(ref)}`;
    const res = await fetchImpl(url, { headers: ghHeaders(token) });
    if (res.status === 404) {
      cache.set(filePath, null);
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitHub GET ${url} -> ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as GhContentFile;
    if (body.type !== 'file' || body.content == null) {
      cache.set(filePath, null);
      return null;
    }
    const decoded =
      body.encoding === 'base64'
        ? Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        : body.content;
    cache.set(filePath, decoded);
    return decoded;
  }

  return {
    exists: async (filePath) => (await readMaybe(filePath)) != null,
    readText: async (filePath) => {
      const content = await readMaybe(filePath);
      if (content == null) throw new Error(`remote file not found: ${repoRef}/${filePath}`);
      return content;
    },
  };
}

async function ghJson<T>(fetchImpl: typeof fetch, url: string, token: string): Promise<T> {
  const res = await fetchImpl(url, { headers: ghHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GET ${url} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'goose-hub-bootstrap',
  };
}
