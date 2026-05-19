import { z } from 'zod';
import type { StateName } from '../state-machine/states.js';
import { STATES } from '../state-machine/states.js';
import { isLegalTransition } from '../state-machine/transitions.js';

const StateNameSchema = z.custom<StateName>(
  (value) => typeof value === 'string' && (STATES as readonly string[]).includes(value),
  'invalid state name',
);

export const ManualTransitionActionSchema = z.object({
  from: StateNameSchema,
  to: StateNameSchema,
  reason: z.string().optional(),
});

export const RejectGateActionSchema = z.object({
  reason: z.string().min(1),
});

export const EmptyReasonActionSchema = z.object({
  reason: z.string().optional(),
});

export const NoActionSchema = z.object({
  reason: z.string().min(1),
});

export const InterventionActionSchemas = {
  manual_transition: ManualTransitionActionSchema,
  reject_gate: RejectGateActionSchema,
  approve_gate: EmptyReasonActionSchema,
  resume_workflow: EmptyReasonActionSchema,
  resolve_conflict: EmptyReasonActionSchema,
  no_action: NoActionSchema,
} as const;

export type InterventionActionType = keyof typeof InterventionActionSchemas;

export function isInterventionActionType(value: string): value is InterventionActionType {
  return value in InterventionActionSchemas;
}

export function validateInterventionAction(
  actionType: string,
  payload: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!isInterventionActionType(actionType)) {
    return { ok: false, error: `unknown intervention action type '${actionType}'` };
  }
  const parsed = InterventionActionSchemas[actionType].safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  if (actionType === 'manual_transition') {
    const data = parsed.data as z.infer<typeof ManualTransitionActionSchema>;
    if (!isLegalTransition(data.from, data.to)) {
      return { ok: false, error: `illegal transition ${data.from} -> ${data.to}` };
    }
  }
  return { ok: true, data: parsed.data };
}
