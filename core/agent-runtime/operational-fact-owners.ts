export type OperationalFactOwner = 'tool' | 'workflow' | 'collector' | 'runtime' | 'model';

export type OperationalFactContract = {
  fact: string;
  owner: OperationalFactOwner;
  observed: boolean;
  modelMayDeclare: 'never' | 'explanation-only' | 'judgment';
  source: string;
};

export const OPERATIONAL_FACT_CONTRACTS: OperationalFactContract[] = [
  {
    fact: 'commands run',
    owner: 'tool',
    observed: true,
    modelMayDeclare: 'explanation-only',
    source: 'agent.tool-call payload.tool_input.command',
  },
  {
    fact: 'targeted test paths',
    owner: 'tool',
    observed: true,
    modelMayDeclare: 'explanation-only',
    source: 'mcp__factory-tools__run_tests returned paths[].path',
  },
  {
    fact: 'changed files',
    owner: 'workflow',
    observed: true,
    modelMayDeclare: 'never',
    source: 'git diff observed by workflow gates',
  },
  {
    fact: 'evidence artifacts',
    owner: 'collector',
    observed: true,
    modelMayDeclare: 'explanation-only',
    source: 'evidence collector/publisher output',
  },
  {
    fact: 'PR metadata',
    owner: 'workflow',
    observed: true,
    modelMayDeclare: 'never',
    source: 'pr.opened workflow event',
  },
  {
    fact: 'state transitions',
    owner: 'workflow',
    observed: true,
    modelMayDeclare: 'never',
    source: 'state.transitioned event',
  },
  {
    fact: 'budget and cost',
    owner: 'runtime',
    observed: true,
    modelMayDeclare: 'never',
    source: 'agent_run_costs and budget gate events',
  },
  {
    fact: 'finding severity and rationale',
    owner: 'model',
    observed: false,
    modelMayDeclare: 'judgment',
    source: 'QA/review structured output',
  },
];

export function operationalFactContractsByOwner(): Record<
  OperationalFactOwner,
  OperationalFactContract[]
> {
  const initial: Record<OperationalFactOwner, OperationalFactContract[]> = {
    tool: [],
    workflow: [],
    collector: [],
    runtime: [],
    model: [],
  };
  return OPERATIONAL_FACT_CONTRACTS.reduce((acc, contract) => {
    acc[contract.owner].push(contract);
    return acc;
  }, initial);
}
