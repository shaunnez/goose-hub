import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level mocks — hoisted by vitest before imports
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}));

// Dynamic import AFTER mocks are registered
const { deployHooks, HOOK_PATH } = await import('./pre-tool-use-hook.js');

describe('HOOK_PATH', () => {
  it('is inside the ~/.factory/hooks directory', () => {
    expect(HOOK_PATH).toContain('.factory');
    expect(HOOK_PATH).toContain('pre-tool-use.js');
  });

  it('contains the home directory path', () => {
    // Our mock homedir returns /mock-home
    expect(HOOK_PATH).toContain('mock-home');
  });
});

describe('deployHooks', () => {
  beforeEach(() => {
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
  });

  it('creates the hooks directory with recursive: true', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    deployHooks();

    expect(mkdirSync).toHaveBeenCalledOnce();
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.factory'), {
      recursive: true,
    });
  });

  it('writes the hook script when the file does not yet exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    deployHooks();

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('pre-tool-use.js'),
      expect.any(String),
      { encoding: 'utf8', mode: 0o755 },
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      '{"type":"module"}',
      'utf8',
    );
  });

  it('always overwrites the script to pick up hook changes', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    deployHooks();

    expect(writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('still creates the directory even when the hook file already exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    deployHooks();

    expect(mkdirSync).toHaveBeenCalledOnce();
  });

  it('the written script contains allowlist enforcement logic', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    deployHooks();

    const scriptContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(scriptContent).toContain('FACTORY_RUN_ALLOWLIST');
    expect(scriptContent).toContain('allowlist');
    expect(scriptContent).toContain('decision');
    expect(scriptContent).toContain('block');
  });

  it('the written script emits a tool-call audit event over HTTP', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    deployHooks();

    const scriptContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(scriptContent).toContain('/events/tool-call');
    expect(scriptContent).toContain('FACTORY_RUN_ID');
    expect(scriptContent).toContain('FACTORY_SERVER_PORT');
  });

  it('the written script references the fallback server port 3001', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    deployHooks();

    const scriptContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(scriptContent).toContain('3001');
  });
});
