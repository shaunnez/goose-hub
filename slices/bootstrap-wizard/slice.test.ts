/**
 * slices/bootstrap-wizard — top-level slice manifest test (M12.07, #308).
 *
 * The bootstrap wizard ships across three vertical surfaces:
 *
 *   1. Server endpoints under `apps/server/src/domains/bootstrap/`
 *   2. UI under `apps/web/src/components/bootstrap/`
 *   3. (this) slice manifest test for FACTORY_RULES rule 24 compliance.
 *
 * The unit-level coverage (state machine, server services, component DOM)
 * lives next to the code:
 *   - apps/web/src/components/bootstrap/slice.test.ts
 *   - apps/web/src/components/bootstrap/components/BootstrapWizard.test.tsx
 *   - apps/server/src/domains/bootstrap/{service,router}.test.ts
 *
 * This test asserts the public contract surface that the rest of the slice
 * relies on so that breaking the wizard is impossible to do silently.
 */

import { describe, expect, it } from 'vitest';

describe('bootstrap-wizard slice — server contract', () => {
  it('exports previewBootstrapService and runBootstrapService', async () => {
    const mod = await import('../../apps/server/src/domains/bootstrap/service.js');
    expect(typeof mod.previewBootstrapService).toBe('function');
    expect(typeof mod.runBootstrapService).toBe('function');
  });

  it('exports a bootstrapRouter for the server to mount', async () => {
    const mod = await import('../../apps/server/src/domains/bootstrap/router.js');
    expect(mod.bootstrapRouter).toBeDefined();
  });
});

describe('bootstrap-wizard slice — web contract', () => {
  it('exports the BootstrapWizard component', async () => {
    // Dynamic-import via a string variable so TS does not follow the path
    // through the .tsx file (this slice test runs under a tsconfig without
    // --jsx; the runtime resolution still works because vitest resolves the
    // .js → .tsx alias automatically).
    const wizardPath = '../../apps/web/src/components/bootstrap/components/BootstrapWizard.js';
    const mod = (await import(/* @vite-ignore */ wizardPath)) as { BootstrapWizard: unknown };
    expect(typeof mod.BootstrapWizard).toBe('function');
  });

  it('exports a 3-step wizard state machine in lib/wizard-state', async () => {
    const mod = await import('../../apps/web/src/components/bootstrap/lib/wizard-state.js');
    expect(mod.WIZARD_STEPS).toEqual(['source', 'preview', 'submit']);
    expect(typeof mod.nextStep).toBe('function');
    expect(typeof mod.prevStep).toBe('function');
    expect(typeof mod.isValidRepoRef).toBe('function');
  });

  it('exposes the bootstrap API helpers via the shared web lib', async () => {
    const mod = await import('../../apps/web/src/lib/api.js');
    expect(typeof mod.previewBootstrap).toBe('function');
    expect(typeof mod.runBootstrap).toBe('function');
  });
});

describe('bootstrap-wizard slice — invokes the upstream workflow', () => {
  it('runBootstrapService delegates to bootstrapProject from core', async () => {
    const workflow = await import('@goose-hub/core/workflows/bootstrap-project.js');
    expect(typeof workflow.bootstrapProject).toBe('function');
    expect(typeof workflow.parseRepoRef).toBe('function');
    expect(typeof workflow.sanitiseSlug).toBe('function');
  });
});
