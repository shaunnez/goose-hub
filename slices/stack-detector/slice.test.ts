import path from 'node:path';
import { detectStack } from '@goose-hub/core/bootstrap/stack-detector.js';
import { describe, expect, it } from 'vitest';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

describe('stack-detector slice', () => {
  describe('Node/TypeScript stack', () => {
    const fixturePath = path.join(FIXTURES, 'node');

    it('detects type as node', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('node');
    });

    it('extracts scripts: build, test, lint, typecheck, e2e', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'node') throw new Error('Expected node stack');
      expect(info.scripts.build).toBe('tsc -b');
      expect(info.scripts.test).toBe('vitest run');
      expect(info.scripts.lint).toBe('biome lint .');
      expect(info.scripts.typecheck).toBe('tsc --noEmit');
      expect(info.scripts.e2e).toBe('playwright test');
    });

    it('detects pnpm as package manager', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'node') throw new Error('Expected node stack');
      expect(info.packageManager).toBe('pnpm');
    });
  });

  describe('Python stack (pyproject.toml with pytest + ruff)', () => {
    const fixturePath = path.join(FIXTURES, 'python');

    it('detects type as python', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('python');
    });

    it('extracts test runner as pytest', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'python') throw new Error('Expected python stack');
      expect(info.testRunner).toBe('pytest');
    });

    it('extracts lint tool as ruff', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'python') throw new Error('Expected python stack');
      expect(info.lintTool).toBe('ruff');
    });
  });

  describe('Python stack (requirements.txt fallback)', () => {
    const fixturePath = path.join(FIXTURES, 'python-req');

    it('detects type as python from requirements.txt', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('python');
    });

    it('uses unittest as default test runner when not specified', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'python') throw new Error('Expected python stack');
      expect(info.testRunner).toBe('unittest');
    });
  });

  describe('Go stack', () => {
    const fixturePath = path.join(FIXTURES, 'go');

    it('detects type as go', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('go');
    });

    it('extracts module name', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'go') throw new Error('Expected go stack');
      expect(info.moduleName).toBe('github.com/example/my-go-project');
    });

    it('provides standard test and build commands', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'go') throw new Error('Expected go stack');
      expect(info.testCommand).toBe('go test ./...');
      expect(info.buildCommand).toBe('go build ./...');
    });
  });

  describe('Rust stack', () => {
    const fixturePath = path.join(FIXTURES, 'rust');

    it('detects type as rust', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('rust');
    });

    it('extracts crate name', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'rust') throw new Error('Expected rust stack');
      expect(info.crateName).toBe('my-rust-crate');
    });

    it('provides cargo commands', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'rust') throw new Error('Expected rust stack');
      expect(info.testCommand).toBe('cargo test');
      expect(info.buildCommand).toBe('cargo build');
    });
  });

  describe('Ruby stack (rspec)', () => {
    const fixturePath = path.join(FIXTURES, 'ruby');

    it('detects type as ruby', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('ruby');
    });

    it('detects rspec as test runner', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'ruby') throw new Error('Expected ruby stack');
      expect(info.testRunner).toBe('rspec');
    });
  });

  describe('Unknown stack', () => {
    const fixturePath = path.join(FIXTURES, 'unknown');

    it('returns unknown type without crashing', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('unknown');
    });
  });

  describe('Priority when multiple manifests present', () => {
    const fixturePath = path.join(FIXTURES, 'multi');

    it('prefers node (package.json) over python when both are present', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('node');
    });
  });

  describe('Node priority preserved when package.json is unparseable (P2 review)', () => {
    const fixturePath = path.join(FIXTURES, 'node-bad-json');

    it('still classifies as node despite invalid JSON', async () => {
      const info = await detectStack(fixturePath);
      expect(info.type).toBe('node');
    });

    it('falls back to safe defaults (npm + empty scripts)', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'node') throw new Error('Expected node stack');
      expect(info.packageManager).toBe('npm');
      expect(info.scripts).toEqual({});
    });
  });

  describe('Go module name strips inline comments (P2 review)', () => {
    const fixturePath = path.join(FIXTURES, 'go-with-comment');

    it('returns the module path without the trailing comment', async () => {
      const info = await detectStack(fixturePath);
      if (info.type !== 'go') throw new Error('Expected go stack');
      expect(info.moduleName).toBe('example.com/app');
    });
  });
});
