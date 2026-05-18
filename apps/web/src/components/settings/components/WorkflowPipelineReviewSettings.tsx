import type { EffectiveModes } from '../lib/workflow-map';
import { modeValue } from '../lib/workflow-map';

export function WorkflowPipelineReviewSettings({ modes }: { modes: EffectiveModes }) {
  return (
    <section className="mb-5">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-fg-2">
        Pipeline/Review settings
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        <ModeTile
          label="Investigation swarm"
          value={modeValue(modes.useInvestigationSwarm)}
          active={modes.useInvestigationSwarm === true}
        />
        <ModeTile
          label="Multi-agent pipeline"
          value={modeValue(modes.useMultiAgentPipeline)}
          active={modes.useMultiAgentPipeline === true}
        />
        <ModeTile
          label="Dev-review"
          value={
            modes.devReviewEnabled
              ? `${modes.devReviewTriggerOn}, ${modes.devReviewMaxRevisionTurns} turn${modes.devReviewMaxRevisionTurns === 1 ? '' : 's'}`
              : 'off'
          }
          active={modes.devReviewEnabled}
        />
        <ModeTile
          label="Review"
          value={reviewLabel(modes)}
          active={modes.reviewConvergent === true}
        />
        <ModeTile
          label="Parallel caps"
          value={`builders ${modes.maxParallelAgents ?? 'default'}, scouts ${modes.maxScoutAgents ?? 'default'}`}
          active={modes.maxParallelAgents != null || modes.maxScoutAgents != null}
        />
      </div>
    </section>
  );
}

function ModeTile({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div
      className={[
        'min-w-0 rounded-md border px-3 py-2',
        active ? 'border-accent bg-accent-soft' : 'border-line bg-bg-subtle',
      ].join(' ')}
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-3">{label}</div>
      <div className="mt-1 break-words text-[12px] font-medium text-fg">{value}</div>
    </div>
  );
}

function reviewLabel(modes: EffectiveModes): string {
  if (modes.reviewConvergent === true) {
    return modes.reviewerSlots != null
      ? `${modes.reviewerSlots.length}-slot convergent`
      : 'convergent defaults';
  }

  if (modes.reviewConvergent === false) return 'single reviewer';
  return 'loading';
}
