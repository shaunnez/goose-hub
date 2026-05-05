import { laneForState, sortLaneItems } from '@/lib/lanes.config';
import type { LaneConfig } from '@/lib/lanes.config';
import type { WorkItemDto } from '@/lib/types';

export interface WorkItemWithProject extends WorkItemDto {
  projectSlug: string;
  projectColor: string;
}

export function groupAllProjectsItems(
  items: readonly WorkItemWithProject[],
  lanes: readonly LaneConfig[],
): Map<string, WorkItemWithProject[]> {
  const out = new Map<string, WorkItemWithProject[]>();
  for (const lane of lanes) out.set(lane.key, []);
  for (const item of items) {
    const laneKey = laneForState(item.state);
    if (laneKey == null) continue;
    out.get(laneKey)?.push(item);
  }
  for (const key of out.keys()) {
    const arr = out.get(key);
    if (arr != null) out.set(key, sortLaneItems(arr));
  }
  return out;
}
