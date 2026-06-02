import type { ScoutReport, ScoutSpec } from '@goose-hub/core/agent-runtime/swarm.js';
import type { RuntimeEffort } from '@goose-hub/core/types.js';
import {
  hasDependencySignal,
  hasSchemaSignal,
  hasVagueOrHighRiskSignal,
} from '@goose-hub/core/workflow-routing/signals.js';
import type { BudgetCaps } from '@goose-hub/core/workflow-routing/types.js';
import {
  WAVE_1_SCOUTS,
  WAVE_2_INTERFACE_SPEC,
  WAVE_2_RISK_SPEC,
  implicatesInterfaceBoundaries,
  implicatesRiskAnalysis,
} from './wave2-selection.js';

export type InvestigationPlannerMode = 'single' | 'swarm';

export interface InvestigationPlannerInput {
  workItem: { title: string; body: string; type?: string | null };
  swarmEnabled: boolean;
  wave1Reports?: ScoutReport[];
  contradictions?: unknown[];
  scoutDigestContext?: unknown;
  routeCaps?: Pick<BudgetCaps, 'maxScouts' | 'allowWave2'>;
}

export interface InvestigationPlan {
  mode: InvestigationPlannerMode;
  selectedWave1Scouts: ScoutSpec[];
  wave2Needed: boolean;
  selectedWave2Scouts: ScoutSpec[];
  minSuccessfulScouts: number;
  scoutEffortHints: Record<string, RuntimeEffort>;
}

const LOW_EFFORT_WAVE1: Record<string, RuntimeEffort> = Object.fromEntries(
  WAVE_1_SCOUTS.map((scout) => [scout.scoutName, 'low' satisfies RuntimeEffort]),
);

const MEDIUM_EFFORT_WAVE2: Record<string, RuntimeEffort> = {
  [WAVE_2_INTERFACE_SPEC.scoutName]: 'medium',
  [WAVE_2_RISK_SPEC.scoutName]: 'medium',
};

function scoutByName(name: string): ScoutSpec {
  const scout = WAVE_1_SCOUTS.find((candidate) => candidate.scoutName === name);
  if (scout == null) throw new Error(`unknown scout: ${name}`);
  return scout;
}

function textFor(input: InvestigationPlannerInput): string {
  return `${input.workItem.title}\n${input.workItem.body}`.toLowerCase();
}

function rawTextFor(input: InvestigationPlannerInput): string {
  return `${input.workItem.title}\n${input.workItem.body}`;
}

function hasPathOrSymbolSignal(text: string, rawText: string): boolean {
  return (
    /(?:^|\s)(?:apps|core|slices|skills|packages|target-projects|docs)\/[^\s`'")]+/.test(text) ||
    /\b(?:get|post|put|patch|delete)\s+\/[a-z0-9/_:.-]+/.test(text) ||
    /\b(?:[A-Z][a-z0-9]+[A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)?\b/.test(
      rawText,
    )
  );
}

function hasUiSignal(text: string): boolean {
  return /\b(ui|modal|dialog|popover|toast|button|form|page|route|screen|browser|frontend|settings|dashboard|workflow|timeline|empty[-\s]?state|user journey|click|selector)\b/.test(
    text,
  );
}

function selectedWave1ScoutsFor(text: string, rawText: string): ScoutSpec[] {
  if (hasVagueOrHighRiskSignal(text)) return [...WAVE_1_SCOUTS];

  const selected = new Set<string>();
  selected.add('scout-code-path');
  selected.add('scout-test-inventory');

  if (hasUiSignal(text)) selected.add('scout-user-journey');
  if (hasSchemaSignal(text)) selected.add('scout-schema');
  if (hasDependencySignal(text)) selected.add('scout-dependency');

  if (!hasPathOrSymbolSignal(text, rawText)) {
    selected.add('scout-pattern');
  }

  return [...selected].map(scoutByName);
}

function wave1IsLocalizedHighConfidence(input: InvestigationPlannerInput): boolean {
  const reports = input.wave1Reports?.filter((report) => report.status === 'ok') ?? [];
  if (reports.length === 0) return false;
  if ((input.contradictions ?? []).length > 0) return false;
  if (reports.some((report) => report.scoutName === 'scout-dependency')) return false;
  if (reports.some((report) => report.scoutName === 'scout-schema')) return false;
  return reports.every(
    (report) =>
      report.findings.length > 0 &&
      report.findings.every((finding) => finding.confidence === 'high'),
  );
}

function selectWave2(input: InvestigationPlannerInput): ScoutSpec[] {
  // Wave-2 signal text reads only scout findings + contradictions — body keywords
  // are deliberately excluded so that low-signal body text cannot inflate wave-2 scope.
  const text = [
    input.workItem.title,
    JSON.stringify(input.contradictions ?? []),
    ...(input.wave1Reports ?? []).flatMap((report) => [
      report.scoutName,
      ...report.findings.flatMap((finding) => [finding.file, finding.fact]),
    ]),
  ]
    .join('\n')
    .toLowerCase();

  if (wave1IsLocalizedHighConfidence(input) && !implicatesInterfaceBoundaries(text)) {
    return [];
  }

  const scouts: ScoutSpec[] = [];
  const extraContext =
    input.scoutDigestContext != null ? { scoutDigest: input.scoutDigestContext } : undefined;

  if (implicatesInterfaceBoundaries(text)) {
    scouts.push({ ...WAVE_2_INTERFACE_SPEC, ...(extraContext != null ? { extraContext } : {}) });
  }
  if (implicatesRiskAnalysis(text) || (input.contradictions ?? []).length > 0) {
    scouts.push({ ...WAVE_2_RISK_SPEC, ...(extraContext != null ? { extraContext } : {}) });
  }

  return scouts;
}

export function planInvestigation(input: InvestigationPlannerInput): InvestigationPlan {
  if (!input.swarmEnabled) {
    return {
      mode: 'single',
      selectedWave1Scouts: [],
      wave2Needed: false,
      selectedWave2Scouts: [],
      minSuccessfulScouts: 1,
      scoutEffortHints: {},
    };
  }

  const selectedWave1Scouts = selectedWave1ScoutsFor(textFor(input), rawTextFor(input)).slice(
    0,
    input.routeCaps?.maxScouts,
  );
  const selectedWave2Scouts = input.routeCaps?.allowWave2 === false ? [] : selectWave2(input);
  const scoutEffortHints: Record<string, RuntimeEffort> = {
    ...Object.fromEntries(
      selectedWave1Scouts.map((scout) => [
        scout.scoutName,
        LOW_EFFORT_WAVE1[scout.scoutName] ?? 'low',
      ]),
    ),
    ...Object.fromEntries(
      selectedWave2Scouts.map((scout) => [
        scout.scoutName,
        MEDIUM_EFFORT_WAVE2[scout.scoutName] ?? 'medium',
      ]),
    ),
  };

  return {
    mode: 'swarm',
    selectedWave1Scouts,
    wave2Needed: selectedWave2Scouts.length > 0,
    selectedWave2Scouts,
    minSuccessfulScouts:
      selectedWave1Scouts.length === 0 ? 0 : Math.max(1, Math.min(3, selectedWave1Scouts.length)),
    scoutEffortHints,
  };
}
