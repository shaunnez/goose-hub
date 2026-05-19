// chrome.jsx — top breadcrumb bar, task header, left rail, right rail
const { Icons } = window;

// ── Breadcrumb bar ─────────────────────────────────────────────
function BreadcrumbBar({
  task,
  onClose,
  onBack,
  onPrev,
  onNext,
  surface,
  onSurface,
  theme,
  onTheme,
}) {
  return (
    <div
      className="hb-crumb glass"
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px 0 14px',
        gap: 14,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        position: 'relative',
        zIndex: 5,
      }}
    >
      <button
        className="btn ghost sm"
        onClick={onBack}
        style={{ gap: 6, paddingLeft: 6, paddingRight: 10 }}
      >
        <Icons.ArrowL size={13} />
        <span>Board</span>
      </button>
      <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
      <span className="row gap-2" style={{ minWidth: 0 }}>
        <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>
          smartpay-platform
        </span>
        <span style={{ color: 'var(--fg-4)' }}>/</span>
        <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>
          transaction-verification-api
        </span>
        <span style={{ color: 'var(--fg-4)' }}>/</span>
        <span className="mono" style={{ color: 'var(--fg)', fontSize: 12, fontWeight: 600 }}>
          {task.id}
        </span>
      </span>
      <span className="grow" />
      <span className="row gap-2" style={{ color: 'var(--fg-3)', fontSize: 12 }}>
        <span className="kbd">⌘</span>
        <span className="kbd">[</span>
        <span style={{ marginLeft: 2 }}>back</span>
      </span>
      <span className="row gap-2" style={{ color: 'var(--fg-3)', fontSize: 12, marginLeft: 4 }}>
        <button
          className="btn ghost sm"
          onClick={onPrev}
          style={{ padding: '0 6px', gap: 4 }}
          title="Previous task (K)"
        >
          <span className="kbd">K</span>
        </button>
        <button
          className="btn ghost sm"
          onClick={onNext}
          style={{ padding: '0 6px', gap: 4 }}
          title="Next task (J)"
        >
          <span className="kbd">J</span>
        </button>
      </span>
      <span style={{ width: 1, height: 16, background: 'var(--line)', marginLeft: 4 }} />
      <button
        className="btn ghost sm"
        onClick={onTheme}
        title="Toggle theme"
        style={{ padding: '0 8px' }}
      >
        {theme === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
      </button>
      <button
        className="btn ghost sm"
        onClick={onSurface}
        title="Toggle surface"
        style={{ padding: '0 8px' }}
      >
        {surface === 'takeover' ? <Icons.Side size={14} /> : <Icons.Take size={14} />}
      </button>
      <button className="btn ghost sm" onClick={onClose} title="Close" style={{ padding: '0 8px' }}>
        <Icons.Close size={13} />
      </button>
    </div>
  );
}

// ── Task header ────────────────────────────────────────────────
function TaskHeader({ task, personas, compact }) {
  const onDeck = personas.find((p) => p.id === task.onDeck);
  return (
    <div
      style={{
        padding: compact ? '14px 22px 14px' : '18px 22px 16px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2" style={{ marginBottom: 6 }}>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: 0.04 }}
            >
              {task.id}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: 2, background: 'var(--fg-4)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
              opened by {task.requestedBy} · {task.elapsed} ago
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: compact ? 22 : 26,
              fontWeight: 600,
              letterSpacing: -0.024 + 'em',
              color: 'var(--fg)',
              lineHeight: 1.2,
            }}
          >
            {task.title}
          </h1>
          {!compact && (
            <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 6 }}>{task.subtitle}</div>
          )}
        </div>
        <div
          className="row gap-2"
          style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}
        >
          <span className="pill accent">
            <span className="dot live" style={{ background: 'var(--accent)' }} />
            <span style={{ fontWeight: 600 }}>running</span>
            <span className="mono" style={{ opacity: 0.7, marginLeft: 2 }}>
              · dev
            </span>
          </span>
          <span className="pill">
            <Icons.Bolt size={11} /> {task.priority}
          </span>
          <span className="pill mono tnum">
            <Icons.Coin size={11} /> ${task.cost.toFixed(2)}
          </span>
          <span className="pill" style={{ paddingLeft: 4 }}>
            <span className={`avatar sm ${onDeck.cls}`}>{onDeck.initials}</span>
            <span style={{ marginLeft: 2 }}>{onDeck.name} on deck</span>
          </span>
        </div>
      </div>
      {/* progress strip */}
      <div className="row gap-3" style={{ alignItems: 'center' }}>
        <span className="eyebrow">Progress</span>
        <div
          className="row gap-1"
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: 'var(--bg)',
            overflow: 'hidden',
          }}
        >
          {[
            { k: 'invest', done: true, label: 'Investigation' },
            { k: 'prd', done: true, label: 'PRD' },
            { k: 'dev', done: false, label: 'Dev', active: true, prog: 0.6 },
            { k: 'qa', done: false, label: 'QA' },
            { k: 'review', done: false, label: 'Review' },
          ].map((s, i) => (
            <div
              key={s.k}
              style={{
                flex: 1,
                height: '100%',
                borderRadius: 2,
                background: s.done ? 'var(--accent)' : s.active ? 'transparent' : 'transparent',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {s.active && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(90deg, var(--accent) 0%, var(--accent) 60%, var(--accent-soft) 60%)',
                    width: `${s.prog * 100}%`,
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <span className="mono tnum" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          3/5 stages
        </span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          ·
        </span>
        <span className="row gap-1" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          <Icons.GitBranch size={11} />
          <span className="mono">{task.branch}</span>
        </span>
      </div>
    </div>
  );
}

// ── Left rail (vertical nav) ─────────────────────────────────────
const RAIL_ICONS = {
  overview: 'Layers',
  repo: 'Folder',
  invest: 'Brain',
  prd: 'Doc',
  code: 'Code',
  qa: 'Bug',
  review: 'Eye',
  timeline: 'Clock',
  chat: 'Chat',
  costs: 'Coin',
};

function LeftRail({ sections, active, onChange, expanded, onExpandToggle }) {
  return (
    <nav
      style={{
        width: expanded ? 196 : 56,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 8px',
        gap: 2,
        transition: 'width var(--motion)',
        overflow: 'hidden',
      }}
    >
      {expanded && (
        <div className="eyebrow" style={{ padding: '4px 10px 8px' }}>
          Sections
        </div>
      )}
      {sections.map((s) => {
        const Icon = Icons[RAIL_ICONS[s.k]];
        const isActive = active === s.k;
        return (
          <button
            key={s.k}
            onClick={() => onChange(s.k)}
            className="rail-item"
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 34,
              padding: expanded ? '0 10px' : '0',
              justifyContent: expanded ? 'flex-start' : 'center',
              border: 'none',
              background: 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              color: isActive ? 'var(--fg)' : 'var(--fg-3)',
              transition: 'background var(--motion-fast), color var(--motion-fast)',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
            title={!expanded ? s.label : undefined}
          >
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  left: -8,
                  top: 6,
                  bottom: 6,
                  width: 3,
                  background: 'var(--accent)',
                  borderRadius: 2,
                  animation: 'stripe-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              />
            )}
            <Icon size={15} />
            {expanded && (
              <>
                <span style={{ flex: 1, textAlign: 'left' }}>{s.label}</span>
                {s.badge && (
                  <span
                    className="mono tnum"
                    style={{
                      fontSize: 10.5,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: isActive ? 'var(--accent-soft-2)' : 'var(--bg)',
                      color: isActive ? 'var(--accent)' : 'var(--fg-3)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    {s.badge}
                  </span>
                )}
                <span className="kbd" style={{ opacity: 0.5, fontSize: 10 }}>
                  {s.n}
                </span>
              </>
            )}
          </button>
        );
      })}
      <div className="grow" />
      <button
        onClick={onExpandToggle}
        style={{
          height: 30,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-3)',
          cursor: 'pointer',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {expanded ? <Icons.Collapse size={14} /> : <Icons.Expand size={14} />}
        {expanded && <span style={{ fontSize: 12 }}>Collapse</span>}
      </button>
    </nav>
  );
}

// ── Right rail: live ticker + persona roster ─────────────────────
function PersonaChip({ p, size = 'sm' }) {
  return <span className={`avatar ${size} ${p.cls}`}>{p.initials}</span>;
}

function TickerRow({ ev, personas }) {
  const p = personas.find((x) => x.id === ev.p);
  const verbCol =
    ev.kind === 'tool'
      ? 'var(--fg-2)'
      : ev.kind === 'msg'
        ? 'var(--accent)'
        : ev.kind === 'plan'
          ? 'var(--p-cyra)'
          : 'var(--fg-3)';
  return (
    <div className="row gap-3" style={{ padding: '6px 0', alignItems: 'flex-start', fontSize: 12 }}>
      <span
        className="mono tnum"
        style={{ width: 38, color: 'var(--fg-4)', flexShrink: 0, paddingTop: 3 }}
      >
        {ev.t}
      </span>
      <PersonaChip p={p} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row gap-2" style={{ alignItems: 'baseline' }}>
          <span style={{ fontWeight: 500, color: 'var(--fg)' }}>{p.name}</span>
          <span className="mono" style={{ fontSize: 11, color: verbCol }}>
            {ev.verb}
          </span>
        </div>
        <div className="mono nowrap" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 1 }}>
          {ev.obj}
        </div>
      </div>
    </div>
  );
}

function PersonaRow({ p }) {
  const stateCol =
    p.state === 'idle' ? 'var(--fg-4)' : p.state === 'queued' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="row gap-3" style={{ padding: '8px 0', alignItems: 'center' }}>
      <PersonaChip p={p} size="" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row gap-2" style={{ alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{p.name}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.role}</span>
        </div>
        <div className="row gap-2" style={{ marginTop: 1 }}>
          <span
            style={{ width: 6, height: 6, borderRadius: 3, background: stateCol, flexShrink: 0 }}
          />
          <span className="nowrap" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            {p.focus}
          </span>
        </div>
      </div>
    </div>
  );
}

function RightRail({ ticker, personas }) {
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{ padding: '14px 18px 8px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}
      >
        <div className="row gap-2">
          <span className="eyebrow">Activity</span>
          <span className="grow" />
          <span className="pill accent sm" style={{ height: 18, padding: '0 6px', fontSize: 10 }}>
            <span className="dot live" /> live
          </span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 18px', minHeight: 0 }}>
        {ticker.map((ev, i) => (
          <TickerRow key={i} ev={ev} personas={personas} />
        ))}
      </div>
      <div style={{ padding: '14px 18px 6px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
        <div className="row gap-2" style={{ marginBottom: 4 }}>
          <span className="eyebrow">Personas</span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
            {personas.length} on team
          </span>
        </div>
        {personas.map((p) => (
          <PersonaRow key={p.id} p={p} />
        ))}
      </div>
    </aside>
  );
}

window.BreadcrumbBar = BreadcrumbBar;
window.TaskHeader = TaskHeader;
window.LeftRail = LeftRail;
window.RightRail = RightRail;
window.PersonaChip = PersonaChip;
