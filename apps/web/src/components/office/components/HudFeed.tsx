// DOM event-feed widget for the Office HUD.
// Renders the last 5 lines of high-tier choreography activity.
// Subscribes to 'choreo.cinematic-started' via the scene emitter bridge.
// Lines fade out after 30s. ≤ 100 lines.

import type Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { priorityTintColor } from '../lib/rooms';
import { HUD_TINTS } from '../game/textures';

interface FeedLine {
  id: number;
  text: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  ts: number;
}

interface HudFeedProps {
  sceneEmitter: Phaser.Events.EventEmitter | null;
}

const MAX_LINES = 5;
const FADE_AFTER_MS = 30_000;

let nextId = 0;

export function HudFeed({ sceneEmitter }: HudFeedProps) {
  const [lines, setLines] = useState<FeedLine[]>([]);
  const emitterRef = useRef(sceneEmitter);

  useEffect(() => {
    emitterRef.current = sceneEmitter;
  }, [sceneEmitter]);

  useEffect(() => {
    if (sceneEmitter == null) return;

    const handler = (payload: { timelineId?: string; ticketId?: string }) => {
      const name = payload?.timelineId ?? 'unknown';
      const ticketId = payload?.ticketId;
      const priority: FeedLine['priority'] = 'normal';
      const verb = cinematicVerb(name);
      const text = ticketId != null ? `${verb} #${ticketId}` : verb;
      const line: FeedLine = { id: nextId++, text, priority, ts: Date.now() };
      setLines((prev) => [line, ...prev].slice(0, MAX_LINES));
    };

    sceneEmitter.on('choreo.cinematic-started', handler);
    return () => {
      sceneEmitter.off('choreo.cinematic-started', handler);
    };
  }, [sceneEmitter]);

  // Fade-out timer: remove lines older than 30s
  useEffect(() => {
    if (lines.length === 0) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - FADE_AFTER_MS;
      setLines((prev) => prev.filter((l) => l.ts >= cutoff));
    }, 2_000);
    return () => clearInterval(timer);
  }, [lines.length]);

  if (lines.length === 0) return null;

  return (
    <div
      data-testid="hud-feed"
      className="absolute top-8 right-2 w-48 pointer-events-none select-none"
      style={{ zIndex: 30 }}
    >
      {lines.map((line) => {
        const age = Date.now() - line.ts;
        const opacity = age > FADE_AFTER_MS - 1000 ? 0 : 1;
        const dot = priorityTintColor(line.priority);
        return (
          <div
            key={line.id}
            title={line.text}
            className="flex items-center gap-1 mb-0.5 text-[9px] font-mono"
            style={{ opacity, transition: 'opacity 1s', color: HUD_TINTS.hudFeedLineText }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: dot }}
            />
            <span className="truncate">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function cinematicVerb(name: string): string {
  if (name.includes('investigationWave') || name.includes('wave')) return 'Wave started';
  if (name.includes('qaFailed') || name.includes('qa')) return 'QA failed';
  if (name.includes('reviewConverged') || name.includes('review')) return 'Review converged';
  if (name.includes('mergeCelebration') || name.includes('merge')) return 'Merged';
  return name;
}
