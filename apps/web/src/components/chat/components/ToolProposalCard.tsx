import { cn } from '@/lib/cn';
import type { ChatToolInvocationDto } from '@/lib/types';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';

interface ToolProposalCardProps {
  invocation: ChatToolInvocationDto;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onNavigate?: (path: string) => void;
}

function formatInput(input: Record<string, unknown>): string {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === '_rationale') continue;
    cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return '(no arguments)';
  try {
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return String(cleaned);
  }
}

function StatusBadge({ status }: { status: ChatToolInvocationDto['status'] }) {
  if (status === 'proposed') return <span className="text-yellow-500">awaiting approval</span>;
  if (status === 'running')
    return (
      <span className="text-blue-400 inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" />
        running
      </span>
    );
  if (status === 'completed')
    return (
      <span className="text-green-500 inline-flex items-center gap-1">
        <CheckCircle2 size={12} />
        completed
      </span>
    );
  if (status === 'failed')
    return (
      <span className="text-red-500 inline-flex items-center gap-1">
        <XCircle size={12} />
        failed
      </span>
    );
  if (status === 'rejected')
    return (
      <span className="text-fg-2 inline-flex items-center gap-1">
        <X size={12} />
        rejected
      </span>
    );
  return <span className="text-fg-2">{status}</span>;
}

export function ToolProposalCard({
  invocation,
  busy,
  onApprove,
  onReject,
  onNavigate,
}: ToolProposalCardProps) {
  const rationale = (invocation.input._rationale as string | undefined) ?? '';

  // open_url is special — the agent emits an instruction to navigate;
  // we render a button that, when approved, fires onNavigate.
  const isOpenUrl = invocation.toolName === 'open_url' && invocation.status === 'completed';
  const navPath = isOpenUrl ? ((invocation.result as { path?: string })?.path ?? null) : null;

  return (
    <div
      data-testid="chat-tool-card"
      data-tool-name={invocation.toolName}
      data-tool-status={invocation.status}
      className="my-2 rounded-md border border-line bg-bg-elev p-3 text-[12px]"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-fg-3 text-[11px]">{invocation.toolName}</span>
        {invocation.mutating && (
          <span className="rounded bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
            mutating
          </span>
        )}
        <span className="ml-auto text-[10.5px]">
          <StatusBadge status={invocation.status} />
        </span>
      </div>

      {rationale && <div className="text-fg-2 mb-2">{rationale}</div>}

      <details className="mb-2">
        <summary className="cursor-pointer text-fg-2 text-[11px] select-none">inputs</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] bg-bg p-2 rounded">
          {formatInput(invocation.input)}
        </pre>
      </details>

      {invocation.errorMessage && (
        <div className="text-red-400 text-[11.5px] mt-1">{invocation.errorMessage}</div>
      )}

      {invocation.result != null && invocation.status === 'completed' && !isOpenUrl && (
        <details>
          <summary className="cursor-pointer text-fg-2 text-[11px] select-none">result</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] bg-bg p-2 rounded max-h-60 overflow-auto">
            {JSON.stringify(invocation.result, null, 2)}
          </pre>
        </details>
      )}

      {invocation.status === 'proposed' && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(invocation.id)}
            data-testid="chat-tool-approve"
            className={cn(
              'px-2 py-1 rounded text-[11.5px]',
              'bg-green-600/20 text-green-300 hover:bg-green-600/30 disabled:opacity-50',
            )}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(invocation.id)}
            data-testid="chat-tool-reject"
            className={cn(
              'px-2 py-1 rounded text-[11.5px]',
              'bg-bg text-fg-2 border border-line hover:bg-bg-hover disabled:opacity-50',
            )}
          >
            Reject
          </button>
        </div>
      )}

      {isOpenUrl && navPath && onNavigate && (
        <button
          type="button"
          onClick={() => onNavigate(navPath)}
          className="mt-1 text-[11.5px] text-accent underline hover:no-underline"
        >
          Open {navPath}
        </button>
      )}
    </div>
  );
}
