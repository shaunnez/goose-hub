import { approveIssue, rejectIssue } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface ApprovalGateSectionProps {
  projectSlug: string;
  id: string;
  /** Current state — gate only shown when factory:approved. */
  state: string | undefined;
}

/**
 * Human approval gate banner (#186). Rendered above the section content
 * when the issue is in `factory:approved`. Approve merges the linked PR
 * and transitions to factory:done. Reject requires a non-empty note and
 * transitions to factory:needs-fix.
 *
 * UI-only. No agent caller — the underlying routes (`/approve`, `/reject`)
 * are not part of the dispatcher / webhook surface.
 */
export function ApprovalGateSection({ projectSlug, id, state }: ApprovalGateSectionProps) {
  const queryClient = useQueryClient();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
    queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    queryClient.invalidateQueries({ queryKey: ['events', projectSlug, id] });
  };

  const approveMutation = useMutation({
    mutationFn: () => approveIssue(projectSlug, id),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectIssue(projectSlug, id, reason),
    onSuccess: () => {
      setShowRejectForm(false);
      setRejectReason('');
      invalidate();
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    },
  });

  if (state !== 'factory:approved') return null;

  return (
    <div
      data-testid="approval-gate"
      className="mx-6 my-3 rounded-md border border-line bg-bg-elev px-4 py-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold">Approval gate</div>
        <div className="text-fg-3 text-[12px]">PR awaiting your approval before merge</div>
      </div>

      {errorMsg != null ? (
        <div data-testid="approval-gate-error" className="mb-2 text-[12px] text-red-400">
          {errorMsg}
        </div>
      ) : null}

      {!showRejectForm ? (
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="approve-btn"
            disabled={approveMutation.isPending}
            onClick={() => {
              setErrorMsg(null);
              approveMutation.mutate();
            }}
            className="h-8 rounded-md bg-green-600 px-3 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {approveMutation.isPending ? 'Merging…' : 'Approve & merge'}
          </button>
          <button
            type="button"
            data-testid="reject-btn"
            onClick={() => {
              setErrorMsg(null);
              setShowRejectForm(true);
            }}
            className="h-8 rounded-md border border-line px-3 text-[12px] hover:bg-bg-hover"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            data-testid="reject-reason-input"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Why is this rejected? (required)"
            className="rounded-md border border-line bg-bg p-2 text-[12px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="reject-submit"
              disabled={rejectMutation.isPending || rejectReason.trim().length === 0}
              onClick={() => {
                setErrorMsg(null);
                rejectMutation.mutate(rejectReason.trim());
              }}
              className="h-8 rounded-md bg-red-600 px-3 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {rejectMutation.isPending ? 'Submitting…' : 'Confirm reject'}
            </button>
            <button
              type="button"
              data-testid="reject-cancel"
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason('');
              }}
              className="h-8 rounded-md border border-line px-3 text-[12px] hover:bg-bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
