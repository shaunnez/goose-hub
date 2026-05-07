/**
 * BootstrapWizard — multi-step modal that walks the human through registering
 * a new project under Factory's roster (M12.07, issue #308).
 *
 * The wizard hits two server endpoints:
 *   - POST /projects/bootstrap/preview { repoRef }  → BootstrapPreviewDto
 *   - POST /projects/bootstrap/run     { repoRef, slug? } → BootstrapRunDto
 *
 * Tokens are server-held (env GITHUB_TOKEN); the browser never collects
 * tokens. The "Open Registration PR" button on the final step calls /run.
 */

import { previewBootstrap, runBootstrap } from '@/lib/api';
import type { BootstrapPreviewDto, BootstrapRunDto } from '@/lib/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WIZARD_STEPS,
  type WizardStep,
  isValidRepoRef,
  nextStep,
  prevStep,
  stepIndex,
  stepLabel,
} from '../lib/wizard-state';

interface BootstrapWizardProps {
  open: boolean;
  onClose: () => void;
}

interface WizardState {
  step: WizardStep;
  repoRef: string;
  preview: BootstrapPreviewDto | null;
  result: BootstrapRunDto | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: WizardState = {
  step: 'repo',
  repoRef: '',
  preview: null,
  result: null,
  loading: false,
  error: null,
};

export function BootstrapWizard({ open, onClose }: BootstrapWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  // Tracks whether the modal is still mounted/open by the time an in-flight
  // preview/run request resolves. Without this guard, a late response can
  // re-populate state after the user has closed the wizard, leaving stale
  // step/preview data visible on the next open.
  const openRef = useRef(open);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  useEffect(() => {
    openRef.current = open;
    // Reset whenever the modal closes so the next open starts fresh.
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  function setError(error: string | null) {
    setState((s) => ({ ...s, error, loading: false }));
  }

  async function handleValidateRepo() {
    if (!isValidRepoRef(state.repoRef)) {
      setError('Repository ref must look like "owner/repo"');
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const preview = await previewBootstrap(state.repoRef.trim());
      if (!openRef.current) return;
      setState((s) => ({ ...s, preview, loading: false, step: nextStep(s.step) }));
    } catch (err) {
      if (!openRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to validate repo');
    }
  }

  async function handleOpenPr() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await runBootstrap(state.repoRef.trim(), state.preview?.slug);
      if (!openRef.current) return;
      setState((s) => ({ ...s, result, loading: false }));
    } catch (err) {
      if (!openRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to open registration PR');
    }
  }

  function handleNext() {
    setState((s) => ({ ...s, step: nextStep(s.step), error: null }));
  }
  function handlePrev() {
    setState((s) => ({ ...s, step: prevStep(s.step), error: null }));
  }

  function handleClose() {
    onClose();
  }

  return (
    <div
      data-testid="bootstrap-wizard"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={handleClose}
      onKeyDown={(e) => e.key === 'Escape' && handleClose()}
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires open/showModal lifecycle that conflicts with the existing CSS-overlay pattern used elsewhere in the app; aria-label + role="dialog" is the documented React-modal fallback.
        role="dialog"
        aria-label="Add Project bootstrap wizard"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: '24px',
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          overflowY: 'auto',
          color: 'var(--fg)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && handleClose()}
      >
        <h2
          style={{
            margin: '0 0 12px',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Add project
        </h2>

        <StepIndicator current={state.step} />

        <div style={{ marginTop: 16 }}>
          {state.step === 'repo' && (
            <StepRepo
              repoRef={state.repoRef}
              onChange={(repoRef) => setState((s) => ({ ...s, repoRef, error: null }))}
              loading={state.loading}
              onSubmit={handleValidateRepo}
            />
          )}
          {state.step === 'stack' && state.preview && <StepStack preview={state.preview} />}
          {state.step === 'claudeMd' && state.preview && <StepClaudeMd preview={state.preview} />}
          {state.step === 'labels' && state.preview && <StepLabels preview={state.preview} />}
          {state.step === 'webhook' && state.preview && (
            <StepWebhook preview={state.preview} repoRef={state.repoRef} />
          )}
          {state.step === 'submit' && (
            <StepSubmit
              repoRef={state.repoRef}
              preview={state.preview}
              result={state.result}
              loading={state.loading}
              onOpenPr={handleOpenPr}
            />
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
          onNext={state.step === 'repo' ? handleValidateRepo : handleNext}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}

function canAdvance(state: WizardState): boolean {
  if (state.loading) return false;
  if (state.step === 'repo') {
    return isValidRepoRef(state.repoRef);
  }
  if (state.step === 'submit') {
    return state.result != null;
  }
  return state.preview != null;
}

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = stepIndex(current);
  return (
    <ol
      data-testid="wizard-steps"
      style={{
        display: 'flex',
        gap: 4,
        listStyle: 'none',
        padding: 0,
        margin: 0,
        fontSize: 11,
        color: 'var(--fg-2)',
        flexWrap: 'wrap',
      }}
    >
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

function StepRepo({
  repoRef,
  onChange,
  loading,
  onSubmit,
}: {
  repoRef: string;
  onChange: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      data-testid="step-repo"
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading) onSubmit();
      }}
    >
      <label
        htmlFor="bootstrap-repo-ref"
        style={{ display: 'block', fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}
      >
        GitHub repository (owner/repo)
      </label>
      <input
        id="bootstrap-repo-ref"
        data-testid="bootstrap-repo-input"
        type="text"
        value={repoRef}
        onChange={(e) => onChange(e.target.value)}
        placeholder="octo/widgets"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{
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
        }}
      />
      <p style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-3)' }}>
        The server checks accessibility with its configured GITHUB_TOKEN. The browser never sees a
        token.
      </p>
    </form>
  );
}

function StepStack({ preview }: { preview: BootstrapPreviewDto }) {
  return (
    <div data-testid="step-stack">
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Detected stack</h3>
      <p style={{ margin: '0 0 4px', fontSize: 12 }}>
        <strong>Type:</strong> {preview.stack.type}
      </p>
      <p style={{ margin: '0 0 4px', fontSize: 12 }}>
        <strong>Default branch:</strong>{' '}
        <code style={{ fontFamily: 'monospace' }}>{preview.defaultBranch}</code>
      </p>
      <p style={{ margin: '0 0 4px', fontSize: 12 }}>
        <strong>Slug:</strong> <code style={{ fontFamily: 'monospace' }}>{preview.slug}</code>
      </p>
      <pre
        data-testid="stack-summary"
        style={{
          marginTop: 12,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: 12,
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {preview.stack.summary}
      </pre>
    </div>
  );
}

function StepClaudeMd({ preview }: { preview: BootstrapPreviewDto }) {
  const isCreate = preview.audit.action === 'create';
  const isUpdate = preview.audit.action === 'update';
  const isOk = preview.audit.action === 'ok';
  return (
    <div data-testid="step-claudemd">
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
        CLAUDE.md {isCreate ? 'preview (create)' : isUpdate ? 'diff (update)' : 'audit'}
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--fg-2)' }}>
        {preview.audit.rationale}
      </p>
      {!isOk && (
        <textarea
          data-testid="claudemd-preview"
          readOnly
          value={preview.audit.content}
          rows={12}
          style={{
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            color: 'var(--fg)',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: 8,
            resize: 'vertical',
          }}
        />
      )}
      {isOk && (
        <p data-testid="claudemd-ok" style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>
          The target repo's CLAUDE.md already contains every required section. No changes proposed.
        </p>
      )}
    </div>
  );
}

function StepLabels({ preview }: { preview: BootstrapPreviewDto }) {
  return (
    <div data-testid="step-labels">
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
        Labels to install ({preview.labelsToInstall.length})
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--fg-2)' }}>
        These are the canonical Factory labels that will be created or updated on{' '}
        <code style={{ fontFamily: 'monospace' }}>{preview.slug}</code>'s GitHub repo.
      </p>
      <ul
        data-testid="labels-list"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          maxHeight: 240,
          overflowY: 'auto',
          border: '1px solid var(--line)',
          borderRadius: 6,
        }}
      >
        {preview.labelsToInstall.map((label) => (
          <li
            key={label.name}
            data-testid="labels-list-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 10px',
              borderBottom: '1px solid var(--line)',
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 3,
                background: `#${label.color}`,
                flexShrink: 0,
              }}
            />
            <code style={{ fontFamily: 'monospace', flexShrink: 0 }}>{label.name}</code>
            <span style={{ color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepWebhook({ preview, repoRef }: { preview: BootstrapPreviewDto; repoRef: string }) {
  const payloadUrl = '<your-goose-hub-host>/webhooks/github';
  return (
    <div data-testid="step-webhook">
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Webhook setup</h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--fg-2)' }}>
        After this PR merges, configure a GitHub webhook on{' '}
        <code style={{ fontFamily: 'monospace' }}>{repoRef || preview.slug}</code> so factory ticks
        react to label changes.
      </p>
      <ol style={{ margin: '0 0 8px 18px', padding: 0, fontSize: 12, lineHeight: 1.7 }}>
        <li>
          Go to{' '}
          <code style={{ fontFamily: 'monospace' }}>
            https://github.com/{repoRef || preview.slug}/settings/hooks/new
          </code>
          .
        </li>
        <li>
          Payload URL:{' '}
          <code data-testid="webhook-payload-url" style={{ fontFamily: 'monospace' }}>
            {payloadUrl}
          </code>
        </li>
        <li>
          Content type: <code style={{ fontFamily: 'monospace' }}>application/json</code>
        </li>
        <li>
          Secret: the value of{' '}
          <code style={{ fontFamily: 'monospace' }}>GITHUB_WEBHOOK_SECRET</code> from your goose-hub
          server env.
        </li>
        <li>Events: select Issues, Pull requests, and Issue comments.</li>
        <li>Active: yes.</li>
      </ol>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-3)' }}>
        Local development: tunnel <code style={{ fontFamily: 'monospace' }}>localhost:3001</code>{' '}
        with <code style={{ fontFamily: 'monospace' }}>ngrok http 3001</code> and use the ngrok URL
        above instead.
      </p>
    </div>
  );
}

function StepSubmit({
  repoRef,
  preview,
  result,
  loading,
  onOpenPr,
}: {
  repoRef: string;
  preview: BootstrapPreviewDto | null;
  result: BootstrapRunDto | null;
  loading: boolean;
  onOpenPr: () => void;
}) {
  return (
    <div data-testid="step-submit">
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Open registration PR</h3>
      {result == null && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-2)' }}>
            Clicking the button below will install the canonical labels on{' '}
            <code style={{ fontFamily: 'monospace' }}>{repoRef}</code> and open a registration PR on{' '}
            <code style={{ fontFamily: 'monospace' }}>shaunnez/goose-hub</code> with slug{' '}
            <code style={{ fontFamily: 'monospace' }}>{preview?.slug}</code>.
          </p>
          <button
            type="button"
            data-testid="bootstrap-submit"
            disabled={loading}
            onClick={onOpenPr}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              fontSize: 13,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Opening PR…' : 'Open Registration PR'}
          </button>
        </>
      )}
      {result != null && (
        <div data-testid="bootstrap-result">
          <p style={{ margin: '0 0 8px', fontSize: 12 }}>
            <strong>Status:</strong> {result.status}
          </p>
          {result.registrationPrUrl && (
            <p style={{ margin: '0 0 8px', fontSize: 12 }}>
              <strong>PR:</strong>{' '}
              <a
                data-testid="bootstrap-pr-link"
                href={result.registrationPrUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent, #6366f1)' }}
              >
                {result.registrationPrUrl}
              </a>
            </p>
          )}
          {result.labelCounts && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--fg-2)' }}>
              Labels — created {result.labelCounts.created}, updated {result.labelCounts.updated},
              skipped {result.labelCounts.skipped}.
            </p>
          )}
        </div>
      )}
    </div>
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
  const isFirst = step === 'repo';
  const isFinal = step === 'submit';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 24,
        paddingTop: 12,
        borderTop: '1px solid var(--line)',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: '5px 14px',
          borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          color: 'var(--fg-2)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {hasResult ? 'Close' : 'Cancel'}
      </button>
      <div style={{ display: 'flex', gap: 8 }}>
        {!isFirst && (
          <button
            type="button"
            data-testid="wizard-prev"
            onClick={onPrev}
            disabled={loading}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--bg)',
              color: 'var(--fg-2)',
              fontSize: 13,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
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
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              fontSize: 13,
              cursor: !canAdvance || loading ? 'not-allowed' : 'pointer',
              opacity: !canAdvance || loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}
