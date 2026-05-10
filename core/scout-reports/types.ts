export interface ScoutReport {
  id: number;
  projectId: string;
  workItemId: string;
  investigationRunId: string;
  scoutSkill: string;
  report: unknown;
  createdAt: string;
}
