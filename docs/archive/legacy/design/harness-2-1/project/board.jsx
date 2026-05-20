// board.jsx — Kanban board surface (parent of task detail)
const Bd = {};
const D = window.HARNESS_DATA;
const BIcons = window.Icons;

const COLUMNS = [
  { k: 'triage', label: 'Triage', n: 3 },
  { k: 'invest', label: 'Investigating', n: 4 },
  { k: 'building', label: 'Building', n: 3 },
  { k: 'reviewing', label: 'Reviewing', n: 2 },
  { k: 'done', label: 'Done', n: 5 },
];

// Synthesized board fixtures — varied tasks across 5 columns
const BOARD_TASKS = [
  // Triage
  {
    id: 'TAS-1671',
    col: 'triage',
    title: 'Funnel SQL aliases timestamp column inconsistently',
    priority: 'p3',
    cost: 0.0,
    age: '12m',
    persona: null,
    repo: 'analytics-funnel',
    spark: [1, 1, 2, 1, 1],
  },
  {
    id: 'TAS-1670',
    col: 'triage',
    title: 'iOS 17.4 swipe gesture conflicts with cart drawer',
    priority: 'p2',
    cost: 0.0,
    age: '34m',
    persona: null,
    repo: 'ios-shop',
    spark: [1, 2, 1, 2, 2],
  },
  {
    id: 'TAS-1669',
    col: 'triage',
    title: 'Vendor portal: bulk-edit margin shows stale on save',
    priority: 'p2',
    cost: 0.0,
    age: '1h',
    persona: null,
    repo: 'vendor-portal',
    spark: [1, 1, 1, 2, 1],
  },

  // Investigating
  {
    id: 'TAS-1665',
    col: 'invest',
    title: 'Auth tokens leak into Datadog logs on 4xx response',
    priority: 'p1',
    cost: 1.42,
    age: '18m',
    persona: 'aster',
    repo: 'auth-service',
    spark: [2, 4, 3, 5, 7],
  },
  {
    id: 'TAS-1664',
    col: 'invest',
    title: 'Webhook deliveries delayed by 9 mins after region failover',
    priority: 'p2',
    cost: 0.84,
    age: '42m',
    persona: 'aster',
    repo: 'webhook-router',
    spark: [1, 3, 3, 4, 4],
  },
  {
    id: 'TAS-1663',
    col: 'invest',
    title: 'Gift card redemption double-charges on retry',
    priority: 'p1',
    cost: 2.1,
    age: '54m',
    persona: 'vega',
    repo: 'payments-core',
    spark: [3, 5, 7, 8, 9],
  },
  {
    id: 'TAS-1660',
    col: 'invest',
    title: 'Search ranking suddenly down-weights branded queries',
    priority: 'p2',
    cost: 0.36,
    age: '1h',
    persona: 'aster',
    repo: 'search-rank',
    spark: [2, 2, 3, 3, 4],
  },

  // Building (current task lives here)
  {
    id: 'TAS-1662',
    col: 'building',
    title: 'Investigate cart abandonment metric drift in BI dashboard',
    priority: 'p2',
    cost: 1.2,
    age: '5m',
    persona: 'bram',
    repo: 'transaction-verification-api',
    spark: [3, 5, 4, 6, 7],
    current: true,
  },
  {
    id: 'TAS-1658',
    col: 'building',
    title: 'Migrate billing emails to new template engine',
    priority: 'p3',
    cost: 0.62,
    age: '2h',
    persona: 'bram',
    repo: 'comms-service',
    spark: [2, 3, 2, 3, 3],
  },
  {
    id: 'TAS-1655',
    col: 'building',
    title: 'Adaptive image CDN: switch to AVIF where supported',
    priority: 'p3',
    cost: 0.94,
    age: '3h',
    persona: 'bram',
    repo: 'cdn-edge',
    spark: [4, 4, 5, 5, 6],
  },

  // Reviewing
  {
    id: 'TAS-1653',
    col: 'reviewing',
    title: 'Strip PII from session replay before sampling',
    priority: 'p1',
    cost: 1.88,
    age: '4h',
    persona: 'cyra',
    repo: 'session-replay',
    spark: [5, 6, 5, 6, 6],
  },
  {
    id: 'TAS-1651',
    col: 'reviewing',
    title: 'Reduce checkout TBT from 412ms to <200ms',
    priority: 'p2',
    cost: 2.4,
    age: '6h',
    persona: 'cyra',
    repo: 'checkout-web',
    spark: [6, 5, 6, 6, 5],
  },

  // Done
  {
    id: 'TAS-1647',
    col: 'done',
    title: 'Order status email subject line A/B test',
    priority: 'p3',
    cost: 0.18,
    age: 'yday',
    persona: 'niko',
    repo: 'comms-service',
    spark: [3, 3, 3, 3, 3],
  },
  {
    id: 'TAS-1645',
    col: 'done',
    title: 'Fix flaky webdriver test in cart-suite (race on cookie banner)',
    priority: 'p3',
    cost: 0.42,
    age: 'yday',
    persona: 'niko',
    repo: 'qa-suite',
    spark: [2, 2, 2, 3, 3],
  },
  {
    id: 'TAS-1644',
    col: 'done',
    title: 'Promote inventory-cache rollout flag to 100%',
    priority: 'p2',
    cost: 0.06,
    age: 'yday',
    persona: 'bram',
    repo: 'inventory-cache',
    spark: [1, 2, 2, 3, 4],
  },
  {
    id: 'TAS-1640',
    col: 'done',
    title: 'Add idempotency keys to refund endpoint',
    priority: 'p1',
    cost: 1.1,
    age: '2d',
    persona: 'bram',
    repo: 'payments-core',
    spark: [3, 4, 4, 5, 5],
  },
  {
    id: 'TAS-1638',
    col: 'done',
    title: 'Move marketing pixel out of critical render path',
    priority: 'p3',
    cost: 0.32,
    age: '2d',
    persona: 'bram',
    repo: 'checkout-web',
    spark: [2, 3, 3, 3, 4],
  },
];

const PR_COLOR = {
  p1: 'var(--danger)',
  p2: 'var(--warning)',
  p3: 'var(--fg-3)',
};

function Sparkline({ data, color = 'var(--accent)' }) {
  const w = 56,
    h = 16,
    max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonaDot({ id }) {
  const p = D.personas.find((x) => x.id === id);
  if (!p) return null;
  return <span className={`avatar sm ${p.cls}`}>{p.initials}</span>;
}

function BoardCard({ t, onOpen }) {
  return (
    <button
      onClick={() => onOpen(t)}
      className="bd-card"
      style={{
        display: 'block',
        width: '100%',
        padding: 12,
        background: t.current ? 'var(--accent-soft)' : 'var(--bg-elev)',
        border: t.current ? '1px solid var(--accent-line)' : '1px solid var(--line)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: 'pointer',
        transition:
          'transform var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast)',
        boxShadow: t.current ? 'var(--shadow-sm)' : 'none',
      }}
    >
      <div className="row gap-2" style={{ marginBottom: 7 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: PR_COLOR[t.priority],
            flexShrink: 0,
          }}
        />
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: 'var(--fg-3)',
            textTransform: 'uppercase',
            letterSpacing: 0.05,
          }}
        >
          {t.id}
        </span>
        <span className="grow" />
        {t.current && (
          <span
            className="pill accent"
            style={{ height: 17, fontSize: 9.5, padding: '0 6px', letterSpacing: 0.05 }}
          >
            OPEN
          </span>
        )}
        <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
          {t.age}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--fg)',
          lineHeight: 1.4,
          fontWeight: 500,
          textWrap: 'pretty',
          marginBottom: 10,
        }}
      >
        {t.title}
      </div>
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        {t.persona ? (
          <PersonaDot id={t.persona} />
        ) : (
          <span
            className="avatar sm"
            style={{
              background: 'transparent',
              border: '1px dashed var(--line-2)',
              color: 'var(--fg-3)',
            }}
          >
            —
          </span>
        )}
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
          {t.repo}
        </span>
        <span className="grow" />
        <Sparkline data={t.spark} color={t.persona ? `var(--p-${t.persona})` : 'var(--fg-4)'} />
        <span
          className="mono tnum"
          style={{ fontSize: 10.5, color: 'var(--fg-3)', minWidth: 32, textAlign: 'right' }}
        >
          ${t.cost.toFixed(2)}
        </span>
      </div>
    </button>
  );
}

function BoardColumn({ col, tasks, onOpen }) {
  const list = tasks.filter((t) => t.col === col.k);
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 260,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        borderRadius: 10,
        border: '1px solid var(--line)',
        maxHeight: '100%',
        minHeight: 0,
      }}
    >
      <div
        className="row gap-2"
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', letterSpacing: 0.01 }}>
          {col.label}
        </span>
        <span className="mono tnum" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          {list.length}
        </span>
        <span className="grow" />
        <button className="btn ghost sm" style={{ height: 22, padding: '0 6px' }}>
          <BIcons.Plus size={11} />
        </button>
      </div>
      <div
        style={{
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {list.map((t) => (
          <BoardCard key={t.id} t={t} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function BoardView({ onOpenTask }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-elev-2)',
      }}
      data-screen-label="Board"
    >
      <div
        className="row gap-3"
        style={{
          padding: '14px 22px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
          background: 'var(--bg-elev)',
        }}
      >
        <div className="row gap-2">
          <BIcons.Layers size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>smartpay-platform</span>
          <span style={{ color: 'var(--fg-4)' }}>·</span>
          <span style={{ fontSize: 14, color: 'var(--fg-2)' }}>This week</span>
        </div>
        <span className="grow" />
        <div className="row gap-2">
          <span className="pill">
            <span className="dot live" />
            17 active
          </span>
          <span className="pill mono tnum">
            <BIcons.Coin size={11} /> $14.62 today
          </span>
          <span style={{ width: 1, height: 18, background: 'var(--line)' }} />
          <button className="btn sm">
            <BIcons.Filter size={12} />
            Filter
          </button>
          <button className="btn sm">
            <BIcons.Sliders size={12} />
            Group
          </button>
          <button className="btn sm primary">
            <BIcons.Plus size={12} />
            New task
          </button>
        </div>
      </div>
      <div
        style={{ flex: 1, padding: 16, display: 'flex', gap: 12, overflowX: 'auto', minHeight: 0 }}
      >
        {COLUMNS.map((c) => (
          <BoardColumn key={c.k} col={c} tasks={BOARD_TASKS} onOpen={onOpenTask} />
        ))}
      </div>
    </div>
  );
}

window.BoardView = BoardView;
window.BOARD_TASKS = BOARD_TASKS;
