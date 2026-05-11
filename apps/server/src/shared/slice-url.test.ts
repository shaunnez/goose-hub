import { describe, expect, it } from 'vitest';
import { REPO_ROOT, sliceUrl } from './slice-url.js';

describe('sliceUrl', () => {
  it('returns a file:// URL', () => {
    expect(sliceUrl('investigate')).toMatch(/^file:\/\//);
  });

  it('points to the correct slice workflow path', () => {
    expect(sliceUrl('investigate')).toContain('/slices/investigate/workflow.js');
    expect(sliceUrl('qa')).toContain('/slices/qa/workflow.js');
    expect(sliceUrl('fix-issue')).toContain('/slices/fix-issue/workflow.js');
  });

  it('REPO_ROOT resolves above apps/server', () => {
    expect(REPO_ROOT).not.toMatch(/apps[/\\]server/);
  });
});
