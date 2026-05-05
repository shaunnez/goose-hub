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
});
