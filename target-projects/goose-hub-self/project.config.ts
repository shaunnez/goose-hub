import type { ProjectConfig } from '../../core/types.js';

const config: ProjectConfig = {
  id: 'goose-hub-self',
  name: 'Goose Hub (self)',
  slug: 'goose-hub-self',
  source: {
    kind: 'github',
    repo: 'shaunnez/goose-hub',
    stateMachine: 'labels',
  },
};

export default config;
