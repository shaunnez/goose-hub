import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}));

const { deployPostHook, POST_HOOK_PATH } = await import('./post-tool-use-hook.js');

describe('POST_HOOK_PATH', () => {
  it('is inside the ~/.factory/hooks directory', () => {
    expect(POST_HOOK_PATH).toContain('.factory');
    expect(POST_HOOK_PATH).toContain('post-tool-use.js');
  });

  it('contains the home directory path', () => {
    expect(POST_HOOK_PATH).toContain('mock-home');
  });
});

describe('deployPostHook', () => {
  beforeEach(() => {
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(writeFileSync).mockReset();
  });

  it('creates the hooks directory with recursive: true', () => {
    deployPostHook();
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.factory'), {
      recursive: true,
    });
  });

  it('writes the hook script to post-tool-use.js with executable mode', () => {
    deployPostHook();
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('post-tool-use.js'),
      expect.any(String),
      { encoding: 'utf8', mode: 0o755 },
    );
  });

  it('always overwrites to pick up hook changes', () => {
    deployPostHook();
    deployPostHook();
    expect(writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('hook script reads transcript_path from CC stdin JSON', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('transcript_path');
  });

  it('hook script contains the [decision] regex for marker extraction', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('[decision]');
    expect(script).toContain('DECISION_RE');
  });

  it('hook script extracts both kind and summary from typed [decision] markers (#466)', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // Typed branch matches `[decision] KIND: text`.
    expect(script).toMatch(/\[A-Z_\]\+/);
    expect(script).toContain('kind: m[1].trim()');
  });

  it('hook script forwards untyped legacy markers as kind: UNKNOWN (#466)', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // Legacy branch (group 3 in the combined regex) → UNKNOWN.
    expect(script).toContain("kind: 'UNKNOWN'");
    expect(script).toContain('m[3].trim()');
  });

  it('hook script uses a single combined regex so marker order matches transcript order (codex feedback)', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // Two-pass parsing was reordering mixed-format chunks; one regex with
    // alternation walks the transcript once and preserves source order.
    const passes = (script.match(/\.exec\(newContent\)/g) ?? []).length;
    expect(passes).toBe(1);
  });

  it('the regex shape preserves transcript order for mixed typed/legacy markers (codex feedback)', () => {
    // Mirror of the regex deployed in the hook script; this test asserts the
    // shape behaves correctly given a mixed transcript chunk.
    const RE = /^\[decision\]\s+(?:([A-Z_]+):\s*(.+)|(.+))$/gm;
    const transcript = [
      '[decision] PLAN: typed 1',
      '[decision] some legacy line',
      '[decision] RED: typed 2',
      '[decision] another legacy line',
      '[decision] GREEN: typed 3',
    ].join('\n');
    const order: string[] = [];
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
    while ((m = RE.exec(transcript)) !== null) {
      if (m[1] != null) order.push(`${m[1]}|${m[2]}`);
      else order.push(`UNKNOWN|${m[3]}`);
    }
    expect(order).toEqual([
      'PLAN|typed 1',
      'UNKNOWN|some legacy line',
      'RED|typed 2',
      'UNKNOWN|another legacy line',
      'GREEN|typed 3',
    ]);
  });

  it('hook script POST payload includes kind alongside summary (#466)', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('run_id: runId');
    expect(script).toContain('kind,');
    expect(script).toContain('summary,');
  });

  it('hook script tracks cursor offset per runId to avoid re-emitting', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('.cursor');
    expect(script).toContain('FACTORY_RUN_ID');
    expect(script).toContain('lastOffset');
  });

  it('hook script POSTs to /events/decision-summary endpoint', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('/events/decision-summary');
    expect(script).toContain('FACTORY_SERVER_PORT');
  });

  it('hook script fails silently when server is down', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('.catch(() => {})');
  });

  it('hook script handles invalid JSON on stdin without crashing', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('JSON.parse');
    expect(script).toContain('process.exit(0)');
  });

  it('hook script includes run_id and timestamp in POST payload', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('run_id');
    expect(script).toContain('timestamp');
  });

  it('hook script references fallback server port 3001', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('3001');
  });

  it('hook script emits agent.tool-result when Bash tool_response.error is non-empty', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('/events/tool-result');
    expect(script).toContain("toolName === 'Bash'");
    expect(script).toContain('tool_response');
    expect(script).toContain('workspace_dir: process.env.FACTORY_WORKSPACE_DIR');
  });

  it('hook script caps error at 2048 chars and sets truncated flag', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('2048');
    expect(script).toContain('truncated');
  });

  it('hook script skips tool-result POST when tool_name is not Bash', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain("toolName === 'Bash'");
  });

  it('hook script skips tool-result POST when error field is empty', () => {
    deployPostHook();
    const script = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(script).toContain('.length > 0');
  });
});
