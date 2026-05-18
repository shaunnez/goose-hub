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

/**
 * Scans events for the latest `agent.investigation-complete` event that
 * contains a `playwrightRepro` payload. Returns null if none is found.
 */
export function extractPlaywrightRepro(events: AgentEventDto[]): PlaywrightReproPayload | null {
  const investigationEvents = events.filter((e) => e.kind === 'agent.investigation-complete');
  for (let i = investigationEvents.length - 1; i >= 0; i--) {
    const payload = investigationEvents[i].payload as InvestigationCompletePayload;
    if (payload?.playwrightRepro != null) {
      return payload.playwrightRepro;
    }
  }
  return null;
}
