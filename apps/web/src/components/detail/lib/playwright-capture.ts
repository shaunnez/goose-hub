import type { AgentEventDto } from '@/lib/types';

export interface ScreenshotCapture {
  path: string;
  caption: string;
  step: number;
  githubUrl?: string;
}

export interface ConsoleError {
  message: string;
  type: 'error' | 'warning' | 'info';
  url?: string;
}

export interface PlaywrightReproPayload {
  screenshots: ScreenshotCapture[];
  gifPath: string | null;
  consoleErrors: ConsoleError[];
  testErrors?: string[];
  runnerErrors?: string[];
  reproSteps: string[];
  reproduced: boolean;
  notes?: string;
  commentUrl?: string;
}

interface InvestigationCompletePayload {
  investigate?: unknown;
  playwrightRepro?: PlaywrightReproPayload;
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_SEQUENCE_RE = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[PX^_][\\s\\S]*?${ESC}\\\\|${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`,
  'g',
);
const CONTROL_SEQUENCE_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
  'g',
);

export function stripAnsiControlSequences(value: string): string {
  return value.replace(ANSI_SEQUENCE_RE, '').replace(CONTROL_SEQUENCE_RE, '');
}

function cleanOptionalText(value: string | undefined): string | undefined {
  return value == null ? undefined : stripAnsiControlSequences(value);
}

function cleanTexts(values: string[] | undefined): string[] | undefined {
  return values?.map(stripAnsiControlSequences);
}

export function cleanPlaywrightReproPayload(
  payload: PlaywrightReproPayload,
): PlaywrightReproPayload {
  return {
    ...payload,
    consoleErrors: (payload.consoleErrors ?? []).map((error) => ({
      ...error,
      message: stripAnsiControlSequences(error.message),
      url: cleanOptionalText(error.url),
    })),
    testErrors: cleanTexts(payload.testErrors),
    runnerErrors: cleanTexts(payload.runnerErrors),
    notes: cleanOptionalText(payload.notes),
  };
}

/**
 * Scans events for the latest `agent.investigation-complete` event that
 * contains a `playwrightRepro` payload. Returns null if none is found.
 */
export function extractPlaywrightRepro(events: AgentEventDto[]): PlaywrightReproPayload | null {
  const investigationEvents = events.filter((e) => e.kind === 'agent.investigation-complete');
  for (let i = investigationEvents.length - 1; i >= 0; i--) {
    const payload = investigationEvents[i].payload as InvestigationCompletePayload;
    if (payload?.playwrightRepro != null) {
      return cleanPlaywrightReproPayload(payload.playwrightRepro);
    }
  }
  return null;
}
