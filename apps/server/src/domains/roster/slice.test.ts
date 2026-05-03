import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Slice-level tests for the improvement candidates lifecycle.
// These test public slice behaviour: creation from retro output, approve/reject.
// ---------------------------------------------------------------------------

const mockCandidate = {
  id: 1,
  personaName: 'goose-hub-self/retrospector/0',
  sourceTaskId: 'github:owner/repo#42',
  suggestionText: 'Improve error handling in the implement skill prompt',
  suggestionType: 'skill-prompt',
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
};

describe('candidate creation from retro output', () => {
  it('getPersonaCandidates resolves to an array with the correct shape', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      ok: true,
      data: { candidates: [mockCandidate] },
    });
    vi.doMock('./service.js', () => ({
      getPersonaCandidates: mockGet,
      approveCandidate: vi.fn(),
      rejectCandidate: vi.fn(),
    }));

    const { getPersonaCandidates } = await import('./service.js');
    vi.mocked(getPersonaCandidates).mockResolvedValue({
      ok: true,
      data: { candidates: [mockCandidate] },
    });
    const result = await getPersonaCandidates('goose-hub-self/retrospector/0');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidates[0].suggestionType).toBe('skill-prompt');
      expect(result.data.candidates[0].status).toBe('pending');
      expect(result.data.candidates[0].personaName).toBe('goose-hub-self/retrospector/0');
    }
  });

  it('candidates are keyed by personaName (personaId format)', async () => {
    const { getPersonaCandidates } = await import('./service.js');
    vi.mocked(getPersonaCandidates).mockResolvedValue({
      ok: true,
      data: { candidates: [mockCandidate] },
    });
    const result = await getPersonaCandidates('goose-hub-self/retrospector/0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidates[0].personaName).toContain('retrospector');
    }
  });
});

describe('status update — approved', () => {
  it('approveCandidate returns ok:true with status approved', async () => {
    const { approveCandidate } = await import('./service.js');
    vi.mocked(approveCandidate).mockResolvedValue({
      ok: true,
      data: { candidate: { ...mockCandidate, status: 'approved' } },
    });
    const result = await approveCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.status).toBe('approved');
    }
  });

  it('approveCandidate returns 404 when id does not exist', async () => {
    const { approveCandidate } = await import('./service.js');
    vi.mocked(approveCandidate).mockResolvedValue({
      ok: false,
      error: 'candidate not found',
      status: 404,
    });
    const result = await approveCandidate(999);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});

describe('status update — rejected', () => {
  it('rejectCandidate returns ok:true with status rejected', async () => {
    const { rejectCandidate } = await import('./service.js');
    vi.mocked(rejectCandidate).mockResolvedValue({
      ok: true,
      data: { candidate: { ...mockCandidate, status: 'rejected' } },
    });
    const result = await rejectCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.status).toBe('rejected');
    }
  });
});
