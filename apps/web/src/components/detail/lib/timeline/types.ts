import type { AgentEventDto, CostRowDto, InterventionDto, InterventionEventDto } from '@/lib/types';
import type { TimelineSectionId } from '@goose-hub/core/workflows/timeline-sections.js';

export type TimelineContext = {
  slug: string;
  issueId: string;
  latestRunId: string | null;
  events?: readonly AgentEventDto[];
  runCosts?: Map<string, CostRowDto>;
  /** Monotonic tick that increments each time the user clicks expand/collapse all. */
  expandSignal?: { tick: number; open: boolean };
};

export type InterventionTimelineDetail = {
  intervention: InterventionDto;
  events: InterventionEventDto[];
};

export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | {
      kind: 'timeline-section';
      segmentId: string;
      section: TimelineSectionId;
      items: RenderItem[];
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'intervention-group';
      intervention: InterventionDto;
      events: InterventionEventDto[];
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'run-group';
      runId: string;
      items: RenderItem[];
      skill: string | null;
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
      personaId: string | null;
      modelId: string | null;
      runtime: string | null;
    }
  | {
      kind: 'investigation-phase';
      investigationRunId: string;
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'phase-group';
      phase: 'grill' | 'prd' | 'contract' | 'dev';
      pipelineRunId: string;
      idKind: 'session' | 'workflow' | 'contract' | 'pipeline';
      items: RenderItem[];
      status: 'started' | 'live' | 'completed' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    }
  | {
      kind: 'review-group';
      reviewWorkflowRunId: string;
      items: RenderItem[];
      status: 'live' | 'completed' | 'needs-human' | 'failed';
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
    };
