import { randomUUID } from 'node:crypto';
import { open } from '@goose-hub/core/interventions/reducer.js';
import { emitEscalationProposed } from './events.js';
import type { EscalationTrigger, WorkflowRouteDecision } from './types.js';

function evidenceHash(triggers: EscalationTrigger[]): string {
  const sorted = [...triggers].sort((a, b) => a.kind.localeCompare(b.kind));
  const raw = sorted.map((t) => `${t.kind}:${t.detail}`).join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function proposeRouteEscalation(input: {
  projectId: string;
  workItemId: string;
  route: WorkflowRouteDecision;
  runId?: string;
}): void {
  for (const trigger of input.route.escalationTriggers) {
    const hash = evidenceHash([trigger]);
    const rootCauseSignature = `route-escalation|${input.workItemId}|${trigger.kind}|${hash}`;

    const result = open({
      projectId: input.projectId,
      workItemId: input.workItemId,
      interventionType: 'workflow_route_escalation',
      title: `Route escalation: ${trigger.kind}`,
      reason: trigger.detail,
      rootCauseSignature,
      correlationId: randomUUID(),
    });

    if (result.ok) {
      emitEscalationProposed({
        projectId: input.projectId,
        workItemId: input.workItemId,
        route: input.route,
        interventionId: result.intervention.id,
        runId: input.runId,
      });
    }
  }
}
