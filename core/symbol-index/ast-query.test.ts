import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCallsOf, findImportersImporting, findJsxUsages } from './ast-query.js';

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

describe('AST query helpers', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-query-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('finds calls of a symbol with an optional literal argument filter', () => {
    writeFile(
      tmp,
      'apps/web/src/effects.tsx',
      `
useEffect(() => {}, []);
trackEvent('deploy');
trackEvent('skip');
`,
    );

    expect(findCallsOf('trackEvent', { worktreePath: tmp })).toEqual([
      { path: 'apps/web/src/effects.tsx', line: 3, symbol: 'trackEvent' },
      { path: 'apps/web/src/effects.tsx', line: 4, symbol: 'trackEvent' },
    ]);
    expect(
      findCallsOf('trackEvent', {
        worktreePath: tmp,
        withLiteralArg: { argIndex: 0, literal: 'deploy' },
      }),
    ).toEqual([{ path: 'apps/web/src/effects.tsx', line: 3, symbol: 'trackEvent' }]);
  });

  it('finds importers importing a named symbol from a module', () => {
    writeFile(
      tmp,
      'core/consumer.ts',
      "import { Button, Input as TextInput } from '@/components/ui/button';\nButton();\n",
    );

    expect(
      findImportersImporting('@/components/ui/button', 'Input', { worktreePath: tmp }),
    ).toEqual([{ path: 'core/consumer.ts', line: 1, symbol: 'Input' }]);
  });

  it('finds JSX usages with an optional prop filter', () => {
    writeFile(
      tmp,
      'apps/web/src/page.tsx',
      `
export function Page() {
  return <Button variant="destructive" size="sm" />;
}
`,
    );

    expect(findJsxUsages('Button', { worktreePath: tmp })).toEqual([
      { path: 'apps/web/src/page.tsx', line: 3, symbol: 'Button' },
    ]);
    expect(
      findJsxUsages('Button', {
        worktreePath: tmp,
        withProp: { name: 'variant', value: 'destructive' },
      }),
    ).toEqual([{ path: 'apps/web/src/page.tsx', line: 3, symbol: 'Button' }]);
    expect(
      findJsxUsages('Button', {
        worktreePath: tmp,
        withProp: { name: 'variant', value: 'secondary' },
      }),
    ).toEqual([]);
  });
});
