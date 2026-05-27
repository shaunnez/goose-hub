export type ArtifactRef = {
  artifactKey: string;
  kind: string;
  summary: string;
  bytes: number;
  stored: true;
};

export type StoredArtifact = {
  id: number;
  artifactKey: string;
  projectId: string;
  workItemId: string | null;
  runId: string;
  kind: string;
  summary: string;
  payload: unknown;
  bytes: number;
  createdAt: string;
  expiresAt: string | null;
};

export type StoredArtifactSlice = Omit<StoredArtifact, 'payload'> & {
  offset: number;
  limit: number;
  returnedBytes: number;
  hasMore: boolean;
  payloadSlice: string;
  encoding: 'json';
};

export type InlinePayload<T = unknown> = {
  stored: false;
  payload: T;
};

export type MaybeStoredPayload<T = unknown> = InlinePayload<T> | ArtifactRef;
