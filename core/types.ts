export interface SourceConfig {
  kind: 'github';
  repo: string;
  stateMachine: 'labels';
}

export interface ProjectConfig {
  id: string;
  name: string;
  slug: string;
  source: SourceConfig;
}
