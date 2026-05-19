import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  listToolInvocations,
  recordToolInvocation,
  setToolInvocationRunId,
  updateToolInvocation,
} from './repository.js';

function newId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('conversations repository', () => {
  it('creates and reads back a conversation', () => {
    const id = newId();
    const created = createConversation({
      id,
      scope: 'project',
      projectId: 'test-project',
      runtime: 'claude',
    });
    expect(created.id).toBe(id);
    expect(created.scope).toBe('project');
    expect(created.projectId).toBe('test-project');

    const fetched = getConversation(id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(id);
  });

  it('appends and lists messages in order', () => {
    const id = newId();
    createConversation({ id, scope: 'global' });
    appendMessage({ conversationId: id, role: 'user', content: 'hello' });
    appendMessage({ conversationId: id, role: 'agent', content: 'hi there' });

    const messages = listMessages(id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hello');
    expect(messages[1].role).toBe('agent');
  });

  it('records and updates tool invocations', () => {
    const id = newId();
    createConversation({ id, scope: 'global' });
    const toolId = `tool_${Date.now()}`;
    recordToolInvocation({
      id: toolId,
      conversationId: id,
      toolName: 'list_projects',
      input: {},
      mutating: false,
      status: 'running',
    });

    const updated = updateToolInvocation({
      id: toolId,
      status: 'completed',
      result: { projects: [{ slug: 'a' }] },
    });
    expect(updated?.status).toBe('completed');
    expect((updated?.result as { projects: unknown[] }).projects.length).toBe(1);

    const invocations = listToolInvocations(id);
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('completed');
  });

  it('setToolInvocationRunId stamps the runId on the invocation row', () => {
    const id = newId();
    createConversation({ id, scope: 'global' });
    const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    recordToolInvocation({
      id: toolId,
      conversationId: id,
      toolName: 'invoke_skill',
      input: {},
      mutating: true,
      status: 'running',
    });

    const stamped = setToolInvocationRunId(toolId, 'run_abc123');
    expect(stamped?.runId).toBe('run_abc123');
    expect(listToolInvocations(id)[0].runId).toBe('run_abc123');
  });

  it('lists conversations filtered by scope', () => {
    const globalId = newId();
    const projectId = newId();
    createConversation({ id: globalId, scope: 'global' });
    createConversation({
      id: projectId,
      scope: 'project',
      projectId: 'filter-test',
    });

    const projectScoped = listConversations({ scope: 'project', projectId: 'filter-test' });
    expect(projectScoped.find((c) => c.id === projectId)).toBeDefined();
    expect(projectScoped.find((c) => c.id === globalId)).toBeUndefined();
  });
});
