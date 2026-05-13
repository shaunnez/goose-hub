import type {
  BootstrapPreviewDto,
  BootstrapRunDto,
  ProjectConfigDto,
  ProjectSummary,
} from '../types.js';
import { getJson } from './client.js';

export async function fetchProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const { projects } = await getJson<{ projects: ProjectSummary[] }>('/projects', signal);
  return projects;
}

export async function fetchProjectConfigs(signal?: AbortSignal): Promise<ProjectConfigDto[]> {
  const { configs } = await getJson<{ configs: ProjectConfigDto[] }>('/projects/configs', signal);
  return configs;
}

export async function previewBootstrap(repoRef: string): Promise<BootstrapPreviewDto> {
  const res = await fetch('/api/projects/bootstrap/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ repoRef }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /projects/bootstrap/preview failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BootstrapPreviewDto;
}

export async function runBootstrap(repoRef: string, slug?: string): Promise<BootstrapRunDto> {
  const res = await fetch('/api/projects/bootstrap/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ repoRef, slug }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /projects/bootstrap/run failed: ${res.status} ${text}`);
  }
  return (await res.json()) as BootstrapRunDto;
}
