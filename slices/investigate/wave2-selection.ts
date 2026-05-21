/**
 * Wave-2 scout selection logic for the investigate workflow.
 * Extracted from workflow.ts to keep file size manageable.
 */

/**
 * Wave-1 scouts dispatched on every investigation run.
 * The orchestrator fans them all out; scouts that aren't relevant return empty findings.
 */
export const WAVE_1_SCOUTS = [
  {
    scoutName: 'scout-code-path',
    scoutFocus: 'Trace code paths and call sites for symbols named in the work item',
  },
  {
    scoutName: 'scout-dependency',
    scoutFocus: 'Map dependencies crossing package boundaries touched by this change',
  },
  { scoutName: 'scout-pattern', scoutFocus: 'Identify existing patterns the fix should follow' },
  {
    scoutName: 'scout-schema',
    scoutFocus: 'Find DB schemas, Zod schemas, and API contracts relevant to this work item',
  },
  {
    scoutName: 'scout-test-inventory',
    scoutFocus: 'Locate existing tests covering the affected area',
  },
  {
    scoutName: 'scout-user-journey',
    scoutFocus: 'Map user-visible UI flows and API surfaces related to this issue',
  },
];

export const WAVE_2_INTERFACE_SPEC = {
  scoutName: 'wave2-interface-designer',
  scoutFocus: 'Design interfaces and type signatures based on cross-validated scout findings',
};

export const WAVE_2_RISK_SPEC = {
  scoutName: 'wave2-risk-analyst',
  scoutFocus: 'Identify risks and edge cases in the implementation approach',
};

export interface SelectWave2ScoutsOptions {
  workItem: { number: number; title: string; body: string };
  reports: ScoutReportLike[];
  contradictions: unknown[];
  scoutReportsContext: string;
}

interface ScoutReportLike {
  scoutName: string;
  findings: Array<{ file: string; fact: string }>;
}

export function selectWave2Scouts(opts: SelectWave2ScoutsOptions) {
  const signalText = collectWave2SignalText(opts);
  const specs: Array<typeof WAVE_2_INTERFACE_SPEC & { extraContext: { scoutReports: string } }> =
    [];

  if (implicatesInterfaceBoundaries(signalText)) {
    specs.push({
      ...WAVE_2_INTERFACE_SPEC,
      extraContext: { scoutReports: opts.scoutReportsContext },
    });
  }

  if (implicatesRiskAnalysis(signalText) || opts.contradictions.length > 0) {
    specs.push({
      ...WAVE_2_RISK_SPEC,
      extraContext: { scoutReports: opts.scoutReportsContext },
    });
  }

  return specs;
}

export function collectWave2SignalText(opts: SelectWave2ScoutsOptions): string {
  return [
    opts.workItem.title,
    opts.workItem.body,
    ...opts.reports.flatMap((report) => [
      report.scoutName,
      ...report.findings.flatMap((finding) => [finding.file, finding.fact]),
    ]),
    JSON.stringify(opts.contradictions),
  ]
    .join('\n')
    .toLowerCase();
}

export function implicatesInterfaceBoundaries(text: string): boolean {
  return /\b(schema|schemas|zod|json schema|api|endpoint|route|contract|interface|interfaces|ddl|drizzle|boundary|boundaries|type signature|typescript interface|work package|work packages|multi[-\s]?wp|multi[-\s]?work package|wp)\b/.test(
    text,
  );
}

export function implicatesRiskAnalysis(text: string): boolean {
  return /\b(auth|authentication|authorization|session|secret|secrets|token|credential|credentials|migration|migrations|concurrency|concurrent|race|parallel|state|state machine|error[-\s]?handling|rollback|retry|high[-\s]?risk|critical|security|permission|permissions)\b/.test(
    text,
  );
}
