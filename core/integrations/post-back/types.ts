export type PostBackKind =
  | 'prd-summary'
  | 'investigation-summary'
  | 'pr-link'
  | 'needs-human';

export type PostBackProvider = 'jira' | 'bitbucket';

export interface PostBackAdapterInput {
  /** Provider-specific identifier: Jira issue key (e.g. "PROJ-42") or Bitbucket PR number (e.g. "42") */
  externalId: string;
  /** For Bitbucket: "workspace/repo-slug". Null for Jira. */
  repoRef: string | null;
  /** Sanitized, capped text to post as a comment */
  text: string;
}

export type PostBackAdapterResult =
  | { ok: true; commentId: string; url: string | null }
  | { ok: false; httpStatus: number; detail: string };

export interface PostBackAvailability {
  jira: boolean;
  bitbucket: boolean;
}
