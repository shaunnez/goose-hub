export type SeedArea = 'frontend' | 'backend';

export interface TruthSignal {
  testFile: string;
  testName: string;
}

export interface SeedIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface Seed {
  id: string;
  description: string;
  area: SeedArea;
  truthSignal: TruthSignal;
  issue: SeedIssue;
  apply: (repoRoot: string) => Promise<void>;
  restore: (repoRoot: string) => Promise<void>;
  isApplied: (repoRoot: string) => Promise<boolean>;
}

export interface ApplyResult {
  seedId: string;
  filesChanged: string[];
}

export interface VerifyResult {
  truthSignalRed: boolean;
  failingTests: string[];
  passingTests: string[];
  raw?: unknown;
}
