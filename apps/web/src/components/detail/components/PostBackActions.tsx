import { fetchPostBackAvailability, postBack } from '@/lib/api/integrations';
import type { PostBackKind, PostBackProvider, PostBackServiceResult } from '@/lib/api/integrations';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2, Send, XCircle } from 'lucide-react';
import { useState } from 'react';

interface ActionDef {
  kind: PostBackKind;
  provider: PostBackProvider;
  label: string;
  text: string;
}

interface PostBackActionsProps {
  projectSlug: string;
  /** The work item's externalId (used as the route :id param) */
  workItemId: string;
  /** Text of the PRD artifact, if available */
  prdText?: string;
  /** Text of the investigation artifact, if available */
  investigationText?: string;
  /** A summary for the needs-human state, if available */
  needsHumanSummary?: string;
  /** Formatted PR link message, if available */
  prLinkText?: string;
}

export function PostBackActions({
  projectSlug,
  workItemId,
  prdText,
  investigationText,
  needsHumanSummary,
  prLinkText,
}: PostBackActionsProps) {
  const [lastResult, setLastResult] = useState<PostBackServiceResult | null>(null);

  const { data: availability } = useQuery({
    queryKey: ['post-back-availability', projectSlug, workItemId],
    queryFn: () => fetchPostBackAvailability(projectSlug, workItemId),
    staleTime: 60_000,
    enabled: workItemId.length > 0,
  });

  const mutation = useMutation({
    mutationFn: ({
      kind,
      provider,
      text,
    }: {
      kind: PostBackKind;
      provider: PostBackProvider;
      text: string;
    }) => postBack(projectSlug, workItemId, { kind, provider, text }),
    onSuccess: (data) => setLastResult(data),
    onError: () => setLastResult(null),
  });

  if (availability == null) return null;
  if (!availability.jira && !availability.bitbucket) return null;

  const actions: ActionDef[] = [];

  if (availability.jira) {
    if (prdText != null) {
      actions.push({
        kind: 'prd-summary',
        provider: 'jira',
        label: 'Post PRD to Jira',
        text: prdText,
      });
    }
    if (investigationText != null) {
      actions.push({
        kind: 'investigation-summary',
        provider: 'jira',
        label: 'Post Investigation to Jira',
        text: investigationText,
      });
    }
    if (needsHumanSummary != null) {
      actions.push({
        kind: 'needs-human',
        provider: 'jira',
        label: 'Post Needs-Human to Jira',
        text: needsHumanSummary,
      });
    }
    if (prLinkText != null) {
      actions.push({
        kind: 'pr-link',
        provider: 'jira',
        label: 'Post PR Link to Jira',
        text: prLinkText,
      });
    }
  }

  if (availability.bitbucket) {
    if (prdText != null) {
      actions.push({
        kind: 'prd-summary',
        provider: 'bitbucket',
        label: 'Post PRD to Bitbucket PR',
        text: prdText,
      });
    }
    if (investigationText != null) {
      actions.push({
        kind: 'investigation-summary',
        provider: 'bitbucket',
        label: 'Post Investigation to Bitbucket PR',
        text: investigationText,
      });
    }
    if (needsHumanSummary != null) {
      actions.push({
        kind: 'needs-human',
        provider: 'bitbucket',
        label: 'Post Needs-Human to Bitbucket PR',
        text: needsHumanSummary,
      });
    }
    if (prLinkText != null) {
      actions.push({
        kind: 'pr-link',
        provider: 'bitbucket',
        label: 'Post PR Link to Bitbucket PR',
        text: prLinkText,
      });
    }
  }

  if (actions.length === 0) return null;

  return (
    <div data-testid="post-back-actions" className="flex flex-col gap-2 pt-2 border-t border-line">
      <h3 className="text-[11px] uppercase tracking-wider text-fg-3 font-medium">
        Post to External
      </h3>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ kind, provider, label, text }) => {
          const key = `${provider}-${kind}`;
          const isThisAction =
            mutation.variables?.kind === kind && mutation.variables?.provider === provider;

          return (
            <button
              key={key}
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setLastResult(null);
                mutation.mutate({ kind, provider, text });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border border-line bg-bg-elev text-fg-2 hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending && isThisAction ? (
                <Loader2 size={12} className="animate-spin" />
              ) : mutation.isSuccess && isThisAction && lastResult?.ok === true ? (
                <CheckCircle size={12} className="text-green-500" />
              ) : (mutation.isError && isThisAction) ||
                (mutation.isSuccess && isThisAction && lastResult?.ok === false) ? (
                <XCircle size={12} className="text-red-500" />
              ) : (
                <Send size={12} />
              )}
              {label}
            </button>
          );
        })}
      </div>
      {mutation.isSuccess && lastResult != null && !lastResult.ok && (
        <p className="text-[11px] text-red-500" data-testid="post-back-error">
          {lastResult.detail}
        </p>
      )}
      {mutation.isError && (
        <p className="text-[11px] text-red-500" data-testid="post-back-error">
          {mutation.error instanceof Error ? mutation.error.message : 'Post failed'}
        </p>
      )}
    </div>
  );
}
