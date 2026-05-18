import { describe, expect, it } from 'vitest';
import { resolveScopeFromPath } from './scope.js';

describe('resolveScopeFromPath', () => {
  it('detects item scope', () => {
    const r = resolveScopeFromPath('/projects/goose-hub-self/items/123');
    expect(r.scope).toBe('item');
    expect(r.projectSlug).toBe('goose-hub-self');
    expect(r.workItemId).toBe('123');
    expect(r.label).toBe('goose-hub-self #123');
  });

  it('detects item scope with subsection', () => {
    const r = resolveScopeFromPath('/projects/captain-aoteroa/items/45/overview');
    expect(r.scope).toBe('item');
    expect(r.projectSlug).toBe('captain-aoteroa');
    expect(r.workItemId).toBe('45');
  });

  it('detects project scope', () => {
    const r = resolveScopeFromPath('/projects/goose-hub-self');
    expect(r.scope).toBe('project');
    expect(r.projectSlug).toBe('goose-hub-self');
    expect(r.workItemId).toBeNull();
  });

  it('detects project scope on inbox subroute', () => {
    const r = resolveScopeFromPath('/projects/goose-hub-self/inbox');
    expect(r.scope).toBe('project');
    expect(r.projectSlug).toBe('goose-hub-self');
  });

  it('treats /projects/all as global', () => {
    const r = resolveScopeFromPath('/projects/all');
    expect(r.scope).toBe('global');
  });

  it('treats /settings as global', () => {
    const r = resolveScopeFromPath('/settings');
    expect(r.scope).toBe('global');
  });
});
