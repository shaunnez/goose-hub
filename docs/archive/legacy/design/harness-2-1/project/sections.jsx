// sections.jsx — all 10 task-detail section pages
const { Icons } = window;
const D = window.HARNESS_DATA;
const personaById = (id) => D.personas.find((p) => p.id === id);

// ── Shared atoms ────────────────────────────────────────────
function Shell({ eyebrow, title, hint, actions, children }) {
  return (
    <div
      className="section-anim"
      style={{
        padding: '24px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <div className="row gap-3" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          {eyebrow && (
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {eyebrow}
            </div>
          )}
          <div className="section-h">{title}</div>
          {hint && (
            <div className="section-sub" style={{ marginTop: 4 }}>
              {hint}
            </div>
          )}
        </div>
        {actions && <div className="row gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, eyebrow, right, children, style, pad = 16 }) {
  return (
    <div className="card" style={{ overflow: 'hidden', ...style }}>
      {(title || eyebrow || right) && (
        <div
          className="row gap-3"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--line)',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div className="eyebrow" style={{ marginBottom: 1 }}>
                {eyebrow}
              </div>
            )}
            {title && <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>}
          </div>
          {right}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

function StatRow({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 12 }}>
      {items.map((s, i) => (
        <div key={i} className="card" style={{ padding: '14px 16px' }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {s.label}
          </div>
          <div className="row gap-2" style={{ alignItems: 'baseline' }}>
            <span
              className="mono tnum"
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: -0.02,
                color: s.color || 'var(--fg)',
              }}
            >
              {s.v}
            </span>
            {s.suffix && <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{s.suffix}</span>}
          </div>
          {s.sub && (
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>{s.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PInline({ id, suffix }) {
  const p = personaById(id);
  if (!p) return null;
  return (
    <span className="row gap-2" style={{ display: 'inline-flex' }}>
      <span className={`avatar sm ${p.cls}`}>{p.initials}</span>
      <span style={{ color: 'var(--fg-2)', fontWeight: 500, fontSize: 12.5 }}>{p.name}</span>
      {suffix && <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>· {suffix}</span>}
    </span>
  );
}

// ─── 1. Overview ────────────────────────────────────────────
function Overview({ go }) {
  const t = D.task;
  return (
    <Shell
      eyebrow="01 · Overview"
      title="What's happening on this task"
      hint={`${t.id} · started 5m 40s ago · $${t.cost.toFixed(2)} of $5.00 budget consumed`}
      actions={
        <>
          <button className="btn sm">
            <Icons.Refresh size={12} />
            Refresh
          </button>
          <button className="btn sm primary">
            <Icons.Eye size={12} />
            Watch live
          </button>
        </>
      }
    >
      <StatRow
        items={[
          { label: 'Stage', v: 'Dev', suffix: '· 60%', sub: 'Bram, subtask 2/3' },
          {
            label: 'Spent',
            v: `$${t.cost.toFixed(2)}`,
            suffix: '/ $5.00',
            sub: 'projecting $2.10',
          },
          { label: 'Files', v: '12', sub: '+284 / −91 lines' },
          {
            label: 'Tests',
            v: '38',
            suffix: 'pass',
            sub: '0 failing · 0 skipped',
            color: 'var(--success)',
          },
        ]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <Card eyebrow="Brief" pad={18}>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--fg)',
              textWrap: 'pretty',
            }}
          >
            Cart-abandonment metric on the BI dashboard diverges from the in-product analytics by
            11–14% MoM, undermining trust in both surfaces. Find the source, propose a fix, ship it
            behind a feature flag.
          </p>
          <div
            className="row gap-3"
            style={{ paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--line)' }}
          >
            <PInline id="aster" suffix="found cause" />
            <span style={{ width: 1, height: 12, background: 'var(--line)' }} />
            <PInline id="bram" suffix="patching" />
            <span style={{ width: 1, height: 12, background: 'var(--line)' }} />
            <PInline id="cyra" suffix="PRD owner" />
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Hypothesis (Aster, confirmed by Vega)
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--fg)', fontWeight: 500 }}>
                Timer window leaks across UTC midnight.
              </span>
              <code
                style={{
                  background: 'var(--bg-active)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  margin: '0 4px',
                }}
              >
                cart.ts
              </code>
              uses local time for the 30-minute abandonment window. After 23:30 local, sessions
              split across two day-buckets and double-count. Fix is one helper module + 2 call-site
              updates.
            </p>
          </div>
        </Card>

        <Card eyebrow="Quick jump" pad={10}>
          {[
            { k: 'invest', i: 'Brain', l: 'Investigation', s: '4 findings · 1 high-sev' },
            { k: 'prd', i: 'Doc', l: 'PRD', s: 'v3 · approved by Cyra' },
            { k: 'code', i: 'Code', l: 'Code diff', s: '12 files · +284 / −91' },
            { k: 'qa', i: 'Bug', l: 'QA', s: '38 / 38 passing' },
            { k: 'review', i: 'Eye', l: 'Review', s: '8 of 9 checks pass' },
            { k: 'costs', i: 'Coin', l: 'Costs', s: '$1.20 spent · $0.90 left' },
          ].map((j) => {
            const I = Icons[j.i];
            return (
              <button
                key={j.k}
                onClick={() => go(j.k)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  padding: '8px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background var(--motion-fast)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                  }}
                >
                  <I size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{j.l}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{j.s}</div>
                </div>
                <Icons.ArrowR size={11} style={{ color: 'var(--fg-4)' }} />
              </button>
            );
          })}
        </Card>
      </div>
    </Shell>
  );
}

// ─── 2. Repo Selection ──────────────────────────────────────
function RepoSelection() {
  return (
    <Shell
      eyebrow="02 · Repo Selection"
      title="Three-tier match across the smartpay-platform org"
      hint="Aster scored 7 candidate repos by keyword density, code-graph proximity, and semantic embedding."
      actions={
        <button className="btn sm">
          <Icons.Refresh size={12} />
          Re-score
        </button>
      }
    >
      <Card pad={0}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 80px 80px 80px 1.4fr 80px',
            padding: '11px 16px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-elev-2)',
            fontSize: 11,
            color: 'var(--fg-3)',
            fontWeight: 600,
            letterSpacing: 0.04,
            textTransform: 'uppercase',
          }}
        >
          <span>Repository</span>
          <span style={{ textAlign: 'right' }}>Keyword</span>
          <span style={{ textAlign: 'right' }}>Code</span>
          <span style={{ textAlign: 'right' }}>Semantic</span>
          <span style={{ paddingLeft: 16 }}>Why</span>
          <span style={{ textAlign: 'right' }}>Pick</span>
        </div>
        {D.repos.map((r, i) => {
          const score = r.kw * 0.4 + (r.code / 100) * 0.3 + r.sem * 0.3;
          const reasons = [
            'Owns the metric emission path — cart.ts emits the divergent counter.',
            'Calls into verification but does not own the metric.',
            'Receives events; aggregation is correct here.',
            'Tangentially mentioned in comments only.',
            'Surfaces the metric, does not produce it.',
            'Read-only consumer of the metric.',
            'Unrelated event surface.',
          ];
          return (
            <div
              key={r.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 80px 80px 80px 1.4fr 80px',
                padding: '12px 16px',
                alignItems: 'center',
                borderBottom: i === D.repos.length - 1 ? 'none' : '1px solid var(--line)',
                background: r.picked ? 'var(--accent-soft)' : 'transparent',
                fontSize: 13,
              }}
            >
              <div className="row gap-2" style={{ minWidth: 0 }}>
                <Icons.Folder
                  size={13}
                  style={{ color: r.picked ? 'var(--accent)' : 'var(--fg-3)' }}
                />
                <span
                  className="mono nowrap"
                  style={{ color: 'var(--fg)', fontWeight: r.picked ? 500 : 400 }}
                >
                  {r.name}
                </span>
              </div>
              <Score v={r.kw} />
              <div className="mono tnum" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>
                {r.code}
              </div>
              <Score v={r.sem} />
              <div style={{ paddingLeft: 16, fontSize: 12, color: 'var(--fg-3)' }}>
                {reasons[i]}
              </div>
              <div style={{ textAlign: 'right' }}>
                {r.picked ? (
                  <span className="pill accent" style={{ height: 20 }}>
                    <Icons.Check size={10} sw={2.4} />
                    picked
                  </span>
                ) : (
                  <span className="mono tnum" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {score.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="row gap-3" style={{ alignItems: 'center' }}>
        <PInline id="aster" suffix="2.4s · used rg, code-graph, embedding search" />
        <span className="grow" />
        <button className="btn sm">
          <Icons.Plus size={12} />
          Add candidate
        </button>
        <button className="btn sm">
          <Icons.Pen size={12} />
          Override pick
        </button>
      </div>
    </Shell>
  );
}

function Score({ v }) {
  return (
    <div className="row gap-2" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
      <div
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          background: 'var(--line)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${v * 100}%`,
            height: '100%',
            background: v > 0.7 ? 'var(--accent)' : v > 0.4 ? 'var(--info)' : 'var(--fg-4)',
          }}
        />
      </div>
      <span
        className="mono tnum"
        style={{ fontSize: 11.5, color: 'var(--fg-2)', minWidth: 30, textAlign: 'right' }}
      >
        {v.toFixed(2)}
      </span>
    </div>
  );
}

window.Sec = window.Sec || {};
window.Sec.Overview = Overview;
window.Sec.RepoSelection = RepoSelection;
window.Sec._helpers = { Shell, Card, StatRow, PInline };
