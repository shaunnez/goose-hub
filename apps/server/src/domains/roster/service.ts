import type { Result } from '../../shared/middleware.js';
import { getProject } from '../../shared/projects.js';
import type { ImprovementCandidateRow, PersonaStat } from './repository.js';
import {
  getCandidateById,
  listCandidatesByPersona,
  listPersonaStats,
  updateCandidateGithubIssue,
  updateCandidateStatus,
} from './repository.js';

export interface PersonaRunDto {
  runId: string;
  workItemId: string | null;
  outcome: string;
  qualityScore: number;
  createdAt: string;
}

export type { ImprovementCandidateRow as ImprovementCandidateDto };

export async function listPersonas(): Promise<Result<{ personas: PersonaStat[] }>> {
  const personas = await listPersonaStats();
  return { ok: true, data: { personas } };
}

export async function getPersonaRuns(
  _personaName: string,
): Promise<Result<{ runs: PersonaRunDto[] }>> {
  // Per-run history table is added in a future issue; return empty for now.
  return { ok: true, data: { runs: [] } };
}

export async function getPersonaCandidates(
  personaName: string,
): Promise<Result<{ candidates: ImprovementCandidateRow[] }>> {
  const candidates = await listCandidatesByPersona(personaName, 'pending');
  return { ok: true, data: { candidates } };
}

async function createGithubImprovementIssue(
  repo: string,
  token: string,
  candidate: ImprovementCandidateRow,
): Promise<string> {
  const title = `[improvement] ${candidate.suggestionText.slice(0, 120)}`;
  const sourceLink = candidate.sourceTaskId
    ? `Source task: ${candidate.sourceTaskId}`
    : 'Source task: unknown';
  const body = [
    sourceLink,
    `Persona: ${candidate.personaName}`,
    `Suggestion type: ${candidate.suggestionType}`,
    '',
    candidate.suggestionText,
  ].join('\n');

  const url = `https://api.github.com/repos/${repo}/issues`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['type:improvement', 'schedule:later'] }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const issue = (await res.json()) as { html_url: string };
  return issue.html_url;
}

export async function approveCandidate(
  id: number,
): Promise<Result<{ candidate: ImprovementCandidateRow }>> {
  const existing = await getCandidateById(id);
  if (!existing) return { ok: false, error: 'candidate not found', status: 404 };

  const candidate = await updateCandidateStatus(id, 'approved');
  if (!candidate) return { ok: false, error: 'candidate not found', status: 404 };

  const slug = existing.personaName.split('/')[0];
  const token = process.env.GITHUB_TOKEN;

  try {
    const cfg = await getProject(slug);
    if (!cfg || !token || cfg.source.kind !== 'github') {
      const updated = await updateCandidateGithubIssue(
        id,
        null,
        'Could not resolve project config or GitHub token',
      );
      return { ok: true, data: { candidate: updated ?? candidate } };
    }

    const issueUrl = await createGithubImprovementIssue(cfg.source.repo, token, existing);
    const updated = await updateCandidateGithubIssue(id, issueUrl, null);
    return { ok: true, data: { candidate: updated ?? candidate } };
  } catch (err) {
    const errorNote = err instanceof Error ? err.message : 'Unknown error creating GitHub issue';
    const updated = await updateCandidateGithubIssue(id, null, errorNote);
    return { ok: true, data: { candidate: updated ?? candidate } };
  }
}

export async function rejectCandidate(
  id: number,
): Promise<Result<{ candidate: ImprovementCandidateRow }>> {
  const candidate = await updateCandidateStatus(id, 'rejected');
  if (!candidate) return { ok: false, error: 'candidate not found', status: 404 };
  return { ok: true, data: { candidate } };
}
