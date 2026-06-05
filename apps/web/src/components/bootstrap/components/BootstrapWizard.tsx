import { createLocalProject, previewLocalProjectCreation } from '@/lib/api';
import type {
  BitbucketWorkspaceGroupDto,
  LocalProjectCreationPreviewDto,
  LocalProjectCreationRequestDto,
  LocalProjectCreationRunDto,
  ProjectCreationSourceDto,
} from '@/lib/types';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  WIZARD_STEPS,
  type WizardStep,
  isValidRepoRefs,
  nextStep,
  parseRepoRefs,
  prevStep,
  stepIndex,
  stepLabel,
} from '../lib/wizard-state';

type CreationMode = ProjectCreationSourceDto['kind'];

interface BootstrapWizardProps {
  open: boolean;
  onClose: () => void;
}

interface WizardState {
  step: WizardStep;
  mode: CreationMode;
  projectName: string;
  slug: string;
  githubReposText: string;
  jiraBaseUrl: string;
  jiraKeysText: string;
  jiraImportMode: 'manual' | 'assigned-to-me';
  bitbucketWorkspacesText: string;
  preview: LocalProjectCreationPreviewDto | null;
  lastRequest: LocalProjectCreationRequestDto | null;
  result: LocalProjectCreationRunDto | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: WizardState = {
  step: 'source',
  mode: 'local-only',
  projectName: '',
  slug: '',
  githubReposText: '',
  jiraBaseUrl: '',
  jiraKeysText: '',
  jiraImportMode: 'manual',
  bitbucketWorkspacesText: '',
  preview: null,
  lastRequest: null,
  result: null,
  loading: false,
  error: null,
};

const MODE_LABELS: Record<CreationMode, string> = {
  'local-only': 'Local only',
  'github-code': 'Local + GitHub code repo',
  jira: 'Local + Jira import',
  bitbucket: 'Local + Bitbucket PR integration',
  advanced: 'Advanced: multiple repos/integrations',
};

export function BootstrapWizard({ open, onClose }: BootstrapWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const openRef = useRef(open);
  const reset = useCallback(() => setState(INITIAL_STATE), []);

  useEffect(() => {
    openRef.current = open;
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  function setError(error: string | null) {
    setState((s) => ({ ...s, error, loading: false }));
  }

  async function handlePreview() {
    let request: LocalProjectCreationRequestDto;
    try {
      request = buildRequest(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid project source');
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const preview = await previewLocalProjectCreation(request);
      if (!openRef.current) return;
      setState((s) => ({
        ...s,
        preview,
        lastRequest: request,
        loading: false,
        step: nextStep(s.step),
      }));
    } catch (err) {
      if (!openRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to preview project config');
    }
  }

  async function handleCreate() {
    const request = state.lastRequest ?? buildRequest(state);
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await createLocalProject(request);
      if (!openRef.current) return;
      setState((s) => ({ ...s, result, loading: false }));
    } catch (err) {
      if (!openRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to create project config');
    }
  }

  function handleNext() {
    setState((s) => ({ ...s, step: nextStep(s.step), error: null }));
  }

  function handlePrev() {
    setState((s) => ({ ...s, step: prevStep(s.step), error: null }));
  }

  return (
    <div
      data-testid="bootstrap-wizard"
      style={overlayStyle}
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: this follows the existing modal overlay pattern; native dialog lifecycle would be a broader component rewrite.
        role="dialog"
        aria-label="Add project wizard"
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Add project</h2>
        <StepIndicator current={state.step} />

        <div style={{ marginTop: 16 }}>
          {state.step === 'source' && (
            <StepSource
              state={state}
              onChange={(patch) =>
                setState((s) => ({
                  ...s,
                  ...patch,
                  preview: null,
                  result: null,
                  lastRequest: null,
                  error: null,
                }))
              }
            />
          )}
          {state.step === 'preview' && state.preview && <StepPreview preview={state.preview} />}
          {state.step === 'submit' && (
            <StepSubmit result={state.result} loading={state.loading} onCreate={handleCreate} />
          )}
        </div>

        {state.error && (
          <p
            data-testid="wizard-error"
            style={{ marginTop: 12, color: 'var(--danger, #e05)', fontSize: 12 }}
          >
            {state.error}
          </p>
        )}

        <WizardFooter
          step={state.step}
          loading={state.loading}
          hasResult={state.result != null}
          canAdvance={canAdvance(state)}
          onPrev={handlePrev}
          onNext={state.step === 'source' ? handlePreview : handleNext}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function buildRequest(state: WizardState): LocalProjectCreationRequestDto {
  const base = {
    name: state.projectName.trim() || undefined,
    slug: state.slug.trim() || undefined,
  };
  return {
    ...base,
    source: buildSource(state),
  };
}

function buildSource(state: WizardState): ProjectCreationSourceDto {
  switch (state.mode) {
    case 'local-only':
      return { kind: 'local-only' };
    case 'github-code':
      return { kind: 'github-code', repoRefs: parseRepoRefs(state.githubReposText) };
    case 'jira':
      return {
        kind: 'jira',
        baseUrl: state.jiraBaseUrl.trim(),
        projectKeys: parseList(state.jiraKeysText),
        importMode: state.jiraImportMode,
      };
    case 'bitbucket':
      return {
        kind: 'bitbucket',
        workspaces: parseBitbucketWorkspaceGroups(state.bitbucketWorkspacesText),
      };
    case 'advanced': {
      const source: Extract<ProjectCreationSourceDto, { kind: 'advanced' }> = { kind: 'advanced' };
      if (state.githubReposText.trim().length > 0 && !isValidRepoRefs(state.githubReposText)) {
        throw new Error('GitHub repositories must look like "owner/repo"');
      }
      if (state.githubReposText.trim().length > 0) {
        source.github = { repoRefs: parseRepoRefs(state.githubReposText) };
      }
      if (state.jiraBaseUrl.trim() && parseList(state.jiraKeysText).length > 0) {
        source.jira = {
          baseUrl: state.jiraBaseUrl.trim(),
          projectKeys: parseList(state.jiraKeysText),
          importMode: state.jiraImportMode,
        };
      }
      if (state.bitbucketWorkspacesText.trim().length > 0) {
        source.bitbucket = {
          workspaces: parseBitbucketWorkspaceGroups(state.bitbucketWorkspacesText),
        };
      }
      return source;
    }
  }
}

function canAdvance(state: WizardState): boolean {
  if (state.loading) return false;
  if (state.step === 'source') {
    if (state.mode === 'local-only') return state.slug.trim().length > 0;
    if (state.mode === 'github-code') return isValidRepoRefs(state.githubReposText);
    if (state.mode === 'jira') {
      return state.jiraBaseUrl.trim().length > 0 && parseList(state.jiraKeysText).length > 0;
    }
    if (state.mode === 'bitbucket') {
      return isValidBitbucketWorkspaceGroups(state.bitbucketWorkspacesText);
    }
    return (
      isValidRepoRefs(state.githubReposText) ||
      (state.jiraBaseUrl.trim().length > 0 && parseList(state.jiraKeysText).length > 0) ||
      isValidBitbucketWorkspaceGroups(state.bitbucketWorkspacesText)
    );
  }
  if (state.step === 'submit') return state.result != null;
  return state.preview != null;
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseBitbucketWorkspaceGroups(raw: string): BitbucketWorkspaceGroupDto[] {
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error('Bitbucket workspaces are required');
  if (lines.length > 3) throw new Error('Bitbucket supports up to 3 workspaces');

  return lines.map((line, idx) => {
    const separator = line.indexOf(':');
    if (separator < 1) {
      throw new Error(`Bitbucket workspace line ${idx + 1} must look like "workspace: repo,repo"`);
    }
    const workspace = line.slice(0, separator).trim();
    const repos = parseList(line.slice(separator + 1));
    if (workspace.length === 0 || repos.length === 0) {
      throw new Error(`Bitbucket workspace line ${idx + 1} must include a workspace and repos`);
    }
    return { workspace, repos };
  });
}

function isValidBitbucketWorkspaceGroups(raw: string): boolean {
  try {
    parseBitbucketWorkspaceGroups(raw);
    return true;
  } catch {
    return false;
  }
}

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = stepIndex(current);
  return (
    <ol data-testid="wizard-steps" style={stepListStyle}>
      {WIZARD_STEPS.map((step, idx) => {
        const isActive = step === current;
        const isComplete = idx < currentIdx;
        return (
          <li
            key={step}
            data-testid={`wizard-step-${step}`}
            data-active={isActive ? 'true' : 'false'}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid var(--line)',
              background: isActive
                ? 'var(--accent, #6366f1)'
                : isComplete
                  ? 'var(--accent-soft, rgba(99,102,241,0.18))'
                  : 'transparent',
              color: isActive ? '#fff' : 'var(--fg-2)',
            }}
          >
            {idx + 1}. {stepLabel(step)}
          </li>
        );
      })}
    </ol>
  );
}

function StepSource({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div data-testid="step-source">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10, marginBottom: 12 }}>
        <Field label="Project alias" htmlFor="bootstrap-project-name">
          <input
            id="bootstrap-project-name"
            data-testid="bootstrap-project-name-input"
            type="text"
            value={state.projectName}
            onChange={(e) => onChange({ projectName: e.target.value })}
            placeholder="Goose Hub"
            autoComplete="off"
            style={textInputStyle}
          />
        </Field>
        <Field label="Slug" htmlFor="bootstrap-project-slug">
          <input
            id="bootstrap-project-slug"
            data-testid="bootstrap-slug-input"
            type="text"
            value={state.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            placeholder="goose-hub"
            autoComplete="off"
            style={textInputStyle}
          />
        </Field>
      </div>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Mode</legend>
        {Object.entries(MODE_LABELS).map(([mode, label]) => (
          <label key={mode} style={radioLabelStyle}>
            <input
              data-testid={`bootstrap-mode-${mode}`}
              type="radio"
              checked={state.mode === mode}
              onChange={() => onChange({ mode: mode as CreationMode })}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {(state.mode === 'github-code' || state.mode === 'advanced') && (
        <Field label="GitHub repositories" htmlFor="bootstrap-github-repos">
          <textarea
            id="bootstrap-github-repos"
            data-testid="bootstrap-github-repos-input"
            value={state.githubReposText}
            onChange={(e) => onChange({ githubReposText: e.target.value })}
            placeholder={'octo/widgets\nocto/docs'}
            style={textareaStyle}
          />
        </Field>
      )}

      {(state.mode === 'jira' || state.mode === 'advanced') && (
        <div style={sectionGridStyle}>
          <Field label="Jira base URL" htmlFor="bootstrap-jira-base-url">
            <input
              id="bootstrap-jira-base-url"
              data-testid="bootstrap-jira-base-url-input"
              value={state.jiraBaseUrl}
              onChange={(e) => onChange({ jiraBaseUrl: e.target.value })}
              placeholder="https://example.atlassian.net"
              style={textInputStyle}
            />
          </Field>
          <Field label="Jira project keys" htmlFor="bootstrap-jira-keys">
            <input
              id="bootstrap-jira-keys"
              data-testid="bootstrap-jira-keys-input"
              value={state.jiraKeysText}
              onChange={(e) => onChange({ jiraKeysText: e.target.value })}
              placeholder="ENG,OPS"
              style={textInputStyle}
            />
          </Field>
          <Field label="Jira import mode" htmlFor="bootstrap-jira-import-mode">
            <select
              id="bootstrap-jira-import-mode"
              data-testid="bootstrap-jira-import-mode-select"
              value={state.jiraImportMode}
              onChange={(e) =>
                onChange({ jiraImportMode: e.target.value as 'manual' | 'assigned-to-me' })
              }
              style={textInputStyle}
            >
              <option value="manual">Manual</option>
              <option value="assigned-to-me">Assigned to me</option>
            </select>
          </Field>
        </div>
      )}

      {(state.mode === 'bitbucket' || state.mode === 'advanced') && (
        <div style={sectionGridStyle}>
          <Field label="Bitbucket workspaces (max 3)" htmlFor="bootstrap-bitbucket-workspaces">
            <textarea
              id="bootstrap-bitbucket-workspaces"
              data-testid="bootstrap-bitbucket-workspaces-input"
              value={state.bitbucketWorkspacesText}
              onChange={(e) => onChange({ bitbucketWorkspacesText: e.target.value })}
              placeholder={'acme: api,web\nclient: portal'}
              style={textareaStyle}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function StepPreview({ preview }: { preview: LocalProjectCreationPreviewDto }) {
  return (
    <div data-testid="step-preview">
      <h3 style={headingStyle}>Generated config</h3>
      <p style={metaTextStyle}>
        <code>{preview.configPath}</code>
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        <Badge>local-db</Badge>
        {preview.integrations.map((integration) => (
          <Badge key={integration}>{integration}</Badge>
        ))}
      </div>
      {preview.requiredEnvVars.length > 0 && (
        <div data-testid="required-env-vars" style={{ margin: '8px 0 12px', fontSize: 12 }}>
          <strong>Env:</strong>{' '}
          {preview.requiredEnvVars.map((envVar) => (
            <code key={envVar} style={{ marginRight: 8 }}>
              {envVar}
            </code>
          ))}
        </div>
      )}
      <textarea
        data-testid="project-config-preview"
        readOnly
        value={preview.config}
        rows={18}
        style={{ ...textareaStyle, minHeight: 320 }}
      />
    </div>
  );
}

function StepSubmit({
  result,
  loading,
  onCreate,
}: {
  result: LocalProjectCreationRunDto | null;
  loading: boolean;
  onCreate: () => void;
}) {
  return (
    <div data-testid="step-submit">
      <h3 style={headingStyle}>Create project config</h3>
      {result == null && (
        <button
          type="button"
          data-testid="bootstrap-submit"
          disabled={loading}
          onClick={onCreate}
          style={primaryButtonStyle}
        >
          {loading ? 'Creating...' : 'Create Project'}
        </button>
      )}
      {result != null && (
        <div data-testid="bootstrap-result">
          <p style={{ margin: '0 0 8px', fontSize: 12 }}>
            <strong>Status:</strong> {result.status}
          </p>
          <p style={{ margin: 0, fontSize: 12 }}>
            <strong>Path:</strong> <code>{result.configPath}</code>
          </p>
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span
      style={{ border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}
    >
      {children}
    </span>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 12, color: 'var(--fg-2)' }}>
      <span style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function WizardFooter({
  step,
  loading,
  hasResult,
  canAdvance,
  onPrev,
  onNext,
  onClose,
}: {
  step: WizardStep;
  loading: boolean;
  hasResult: boolean;
  canAdvance: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const isFirst = step === 'source';
  const isFinal = step === 'submit';
  return (
    <div style={footerStyle}>
      <button type="button" onClick={onClose} style={secondaryButtonStyle}>
        {hasResult ? 'Close' : 'Cancel'}
      </button>
      <div style={{ display: 'flex', gap: 8 }}>
        {!isFirst && (
          <button
            type="button"
            data-testid="wizard-prev"
            onClick={onPrev}
            disabled={loading}
            style={secondaryButtonStyle}
          >
            Back
          </button>
        )}
        {!isFinal && (
          <button
            type="button"
            data-testid="wizard-next"
            onClick={onNext}
            disabled={!canAdvance || loading}
            style={primaryButtonStyle}
          >
            {loading ? 'Loading...' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.45)',
};

const dialogStyle: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: 24,
  width: '100%',
  maxWidth: 760,
  maxHeight: '90vh',
  overflowY: 'auto',
  color: 'var(--fg)',
};

const stepListStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  listStyle: 'none',
  padding: 0,
  margin: 0,
  fontSize: 11,
  color: 'var(--fg-2)',
  flexWrap: 'wrap',
};

const textInputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 13,
  fontFamily: 'monospace',
  outline: 'none',
};

const textareaStyle: CSSProperties = {
  ...textInputStyle,
  minHeight: 72,
  resize: 'vertical',
};

const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: 10,
  margin: '0 0 12px',
};

const legendStyle: CSSProperties = {
  padding: '0 4px',
  fontSize: 12,
  color: 'var(--fg-2)',
};

const radioLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '6px 0',
  fontSize: 13,
};

const sectionGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
  marginTop: 12,
};

const headingStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 13,
  fontWeight: 600,
};

const metaTextStyle: CSSProperties = {
  margin: '0 0 4px',
  fontSize: 12,
  color: 'var(--fg-2)',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: 24,
  paddingTop: 12,
  borderTop: '1px solid var(--line)',
};

const primaryButtonStyle: CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent, #6366f1)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--fg-2)',
  fontSize: 13,
  cursor: 'pointer',
};
