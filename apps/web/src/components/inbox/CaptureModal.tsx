import { createInboxItem } from '@/lib/api';
import { useState } from 'react';

const TYPES = ['feature', 'bug', 'chore', 'research'] as const;
type ItemType = (typeof TYPES)[number];

interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
}

export function CaptureModal({ open, onClose }: CaptureModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<ItemType>('feature');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  function reset() {
    setTitle('');
    setBody('');
    setType('feature');
    setError('');
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await createInboxItem({ title: title.trim(), body, type });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item.');
      setSubmitting(false);
    }
  }

  return (
    <div
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
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: '24px',
          width: '100%',
          maxWidth: 480,
          color: 'var(--fg)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && handleClose()}
      >
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--fg)',
          }}
        >
          Capture idea
        </h2>

        <form onSubmit={handleSubmit} noValidate>
          <label
            htmlFor="capture-title"
            style={{ display: 'block', fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}
          >
            Title <span style={{ color: 'var(--danger, #e05)' }}>*</span>
          </label>
          <input
            id="capture-title"
            data-testid="capture-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the idea?"
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
              outline: 'none',
              marginBottom: 12,
            }}
          />

          <label
            htmlFor="capture-type"
            style={{ display: 'block', fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}
          >
            Type
          </label>
          <select
            id="capture-type"
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
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
              marginBottom: 12,
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label
            htmlFor="capture-body"
            style={{ display: 'block', fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}
          >
            Notes (optional)
          </label>
          <textarea
            id="capture-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Any additional context…"
            rows={3}
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
              resize: 'vertical',
              marginBottom: 12,
            }}
          />

          {error && (
            <p style={{ fontSize: 12, color: 'var(--danger, #e05)', margin: '0 0 12px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={handleClose}
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
              Cancel
            </button>
            <button
              type="submit"
              data-testid="capture-submit"
              disabled={submitting}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent, #6366f1)',
                color: '#fff',
                fontSize: 13,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Saving…' : 'Capture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
