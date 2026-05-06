import type { AgentEventDto } from '@/lib/types';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { type ReactNode, useState } from 'react';

function normalizeToolInput(
  toolName: string,
  input: unknown,
): { summary: string; body: ReactNode } {
  const rawStr =
    input != null ? (typeof input === 'string' ? input : JSON.stringify(input, null, 2)) : '';
  const fallback = {
    summary: `Tool call: ${toolName}`,
    body: (
      <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">{rawStr}</pre>
    ),
  };

  if (input == null || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const inp = input as Record<string, unknown>;

  // Bash
  if (typeof inp.command === 'string') {
    const desc = typeof inp.description === 'string' ? inp.description : null;
    const timeoutMs = typeof inp.timeout === 'number' ? inp.timeout : null;
    const cmdPreview = inp.command.length > 60 ? `${inp.command.slice(0, 60)}…` : inp.command;
    return {
      summary: desc != null ? `Bash: ${desc}` : `Bash: ${cmdPreview}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          {desc != null && <span className="text-[11px] text-fg-3 italic">{desc}</span>}
          <code className="block font-mono text-[10.5px] text-fg-2 whitespace-pre-wrap break-all">
            $ {inp.command}
          </code>
          {timeoutMs != null && (
            <span className="text-[10px] text-fg-2">timeout: {Math.round(timeoutMs / 1000)}s</span>
          )}
        </div>
      ),
    };
  }

  // Edit
  if ('old_string' in inp || 'new_string' in inp) {
    const filePath = typeof inp.file_path === 'string' ? inp.file_path : null;
    const fileName = filePath?.split('/').pop() ?? 'file';
    const replaceAll = inp.replace_all === true;
    const oldStr = typeof inp.old_string === 'string' ? inp.old_string : '';
    const newStr = typeof inp.new_string === 'string' ? inp.new_string : '';
    return {
      summary: `Edit: ${fileName}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {filePath != null && (
            <span className="text-[10.5px] text-fg-2 font-mono truncate">{filePath}</span>
          )}
          {replaceAll && (
            <span className="text-[10px] text-yellow-400/80 font-mono">replace all</span>
          )}
          {oldStr.length > 0 && (
            <pre className="text-[10px] font-mono text-[color:var(--danger)]/70 bg-red-500/5 rounded px-2 py-1 whitespace-pre-wrap break-all line-clamp-5">
              {oldStr.length > 300 ? `${oldStr.slice(0, 300)}…` : oldStr}
            </pre>
          )}
          {newStr.length > 0 && (
            <pre className="text-[10px] font-mono text-green-400/80 bg-green-500/5 rounded px-2 py-1 whitespace-pre-wrap break-all line-clamp-5">
              {newStr.length > 300 ? `${newStr.slice(0, 300)}…` : newStr}
            </pre>
          )}
        </div>
      ),
    };
  }

  // Write
  if (typeof inp.file_path === 'string' && typeof inp.content === 'string') {
    const filePath = inp.file_path;
    const fileName = filePath.split('/').pop() ?? 'file';
    const content = inp.content;
    return {
      summary: `Write: ${fileName}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono truncate">{filePath}</span>
          <span className="text-[10px] text-fg-2">{content.length.toLocaleString()} chars</span>
          {content.length > 0 && (
            <pre className="mt-0.5 text-[10px] font-mono text-fg-3 whitespace-pre-wrap break-all line-clamp-6">
              {content.length > 400 ? `${content.slice(0, 400)}…` : content}
            </pre>
          )}
        </div>
      ),
    };
  }

  // Read
  if (typeof inp.file_path === 'string') {
    const filePath = inp.file_path;
    const fileName = filePath.split('/').pop() ?? 'file';
    const limit = typeof inp.limit === 'number' ? inp.limit : null;
    const offset = typeof inp.offset === 'number' ? inp.offset : null;
    const lineHint =
      limit != null
        ? offset != null
          ? `lines ${offset + 1}–${offset + limit}`
          : `first ${limit} lines`
        : null;
    return {
      summary: `Read: ${fileName}${lineHint != null ? ` [${lineHint}]` : ''}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono truncate">{filePath}</span>
          {lineHint != null && <span className="text-[10px] text-fg-2">{lineHint}</span>}
        </div>
      ),
    };
  }

  // Grep
  if (typeof inp.pattern === 'string') {
    const pattern = inp.pattern;
    const path = typeof inp.path === 'string' ? inp.path : null;
    const outputMode = typeof inp.output_mode === 'string' ? inp.output_mode : null;
    return {
      summary: `Grep: ${pattern}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono">/{pattern}/</span>
          {path != null && <span className="text-[10px] text-fg-2 font-mono truncate">{path}</span>}
          {outputMode != null && <span className="text-[10px] text-fg-2">{outputMode}</span>}
        </div>
      ),
    };
  }

  // Glob
  if (typeof inp.path === 'string') {
    const path = inp.path;
    return {
      summary: `Glob: ${path}`,
      body: (
        <div className="mt-1.5">
          <span className="text-[10.5px] text-fg-2 font-mono">{path}</span>
        </div>
      ),
    };
  }

  // Skill
  if (typeof inp.skill === 'string') {
    const skill = inp.skill;
    const args = typeof inp.args === 'string' ? inp.args : null;
    return {
      summary: `Skill: ${skill}${args != null ? ` ${args}` : ''}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono">{skill}</span>
          {args != null && <span className="text-[10px] text-fg-3">{args}</span>}
        </div>
      ),
    };
  }

  return fallback;
}

export function AgentToolCallEvent({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as { tool_name?: string; tool_input?: unknown } | null;
  const toolName = p?.tool_name ?? 'unknown';
  const { summary, body } = normalizeToolInput(toolName, p?.tool_input ?? null);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Wrench size={11} className="shrink-0" />
          <span>{summary}</span>
        </summary>
        {body}
      </details>
    </li>
  );
}
