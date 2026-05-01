import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stateful rows array that simulates the DB for a single test.
let mockRows: Array<{
  projectId: string;
  activeMilestoneNumber: number | null;
  activeMilestoneSetAt: string | null;
  activeMilestoneSetBy: string | null;
}> = [];

const mockInsertRun = vi.fn();
const mockUpdateRun = vi.fn();

vi.mock('@goose-hub/core/db/db.js', () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((vals: (typeof mockRows)[0]) => {
          mockRows.push(vals);
          return { run: mockInsertRun };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Partial<(typeof mockRows)[0]>) => ({
          where: vi.fn(() => ({
            run: vi.fn(() => {
              if (mockRows.length > 0) {
                Object.assign(mockRows[0], patch);
              }
              mockUpdateRun();
            }),
          })),
        })),
      })),
    },
  };
});

vi.mock('@goose-hub/core/db/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@goose-hub/core/db/schema.js')>();
  return { ...actual };
});

// Import after mocks are set up.
const { readActiveMilestone, writeActiveMilestone } = await import('./active-milestone.js');

describe('readActiveMilestone', () => {
  beforeEach(() => {
    mockRows = [];
    mockInsertRun.mockClear();
    mockUpdateRun.mockClear();
  });

  it('returns null when no rows exist', async () => {
    mockRows = [];
    const result = await readActiveMilestone('proj-a');
    expect(result).toBeNull();
  });

  it('returns the activeMilestoneNumber when a row exists', async () => {
    mockRows = [
      {
        projectId: 'proj-b',
        activeMilestoneNumber: 3,
        activeMilestoneSetAt: '2026-01-01T00:00:00.000Z',
        activeMilestoneSetBy: 'shaunnez',
      },
    ];
    const result = await readActiveMilestone('proj-b');
    expect(result).toBe(3);
  });
});

describe('writeActiveMilestone', () => {
  beforeEach(() => {
    mockRows = [];
    mockInsertRun.mockClear();
    mockUpdateRun.mockClear();
  });

  it('calls insert when no existing row', async () => {
    mockRows = [];
    await writeActiveMilestone('proj-c', 5, 'shaunnez');
    expect(mockInsertRun).toHaveBeenCalledOnce();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('calls update when a row already exists', async () => {
    mockRows = [
      {
        projectId: 'proj-d',
        activeMilestoneNumber: 2,
        activeMilestoneSetAt: '2026-01-01T00:00:00.000Z',
        activeMilestoneSetBy: 'shaunnez',
      },
    ];
    await writeActiveMilestone('proj-d', 4, 'shaunnez');
    expect(mockUpdateRun).toHaveBeenCalledOnce();
    expect(mockInsertRun).not.toHaveBeenCalled();
  });
});
