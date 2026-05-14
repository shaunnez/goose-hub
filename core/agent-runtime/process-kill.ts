import type { ChildProcess } from 'node:child_process';

export function killProcessGroupOrChild(child: Pick<ChildProcess, 'pid' | 'kill'>): void {
  if (process.platform !== 'win32' && child.pid != null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall back to killing the immediate child below.
    }
  }
  child.kill('SIGKILL');
}
