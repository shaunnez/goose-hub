export interface EngineeringSpecRecord {
  id: number;
  projectId: string;
  workItemId: string;
  pipelineRunId: string;
  spec: unknown;
  createdAt: string;
  updatedAt: string;
}
