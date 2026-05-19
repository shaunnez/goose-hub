// sections-d.jsx — sections 8, 9, 10 (Timeline, Chat, Costs)
const { Icons } = window;
const D = window.HARNESS_DATA;
const { Shell, Card, StatRow, PInline } = window.Sec._helpers;
const personaById = (id) => D.personas.find((p) => p.id === id);

// ─── 8. Timeline ─────────────────────────────────────────────
function Timeline() {
  const events = [
    { t: '00:00', who: 'system', verb: 'Task created from #cart-bug', ic: 'Spark' },
    { t: '00:08', who: 'aster', verb: 'Began investigation · 7 repos scored', ic: 'Brain' },
    { t: '01:22', who: 'aster', verb: 'Identified high-sev finding · cart.ts:142', ic: 'Bug' },
    { t: '02:40', who: 'cyra', verb: 'Drafted PRD v1', ic: 'Doc' },
    { t: '02:58', who: 'cto', verb: 'Requested AC for DST + concurrent sessions', ic: 'Chat' },
    { t: '03:14', who: 'cyra', verb: 'PRD v3 · approved', ic: 'Check' },
    {
      t: '03:20',
      who: 'bram',
      verb: 'Started patch · branch tas-1662/cart-abandonment-fix',
      ic: 'Code',
    },
    { t: '04:55', who: 'bram', verb: 'Subtask 1/3 complete · cart.ts patched', ic: 'Check' },
    { t: '05:20', who: 'niko', verb: 'Test suites running · 38/38 pass', ic: 'Check' },
    { t: '05:38', who: 'bram', verb: 'Subtask 2/3 in flight · funnel.ts call sites', ic: 'Code' },
    { t: '05:40', who: 'system', verb: 'PR draft prepared', ic: 'GitBranch' },
  ];
  return (
    <Shell
      eyebrow="08 · Timeline"
      title="Everything that happened on this task"
      hint="11 events · 5 personas · 5m 40s elapsed"
      actions={
        <>
          <button className="btn sm">
            <Icons.Filter size={12} />
            Filter
          </button>
          <button className="btn sm">
            <Icons.Eye size={12} />
            Watch live
          </button>
        </>
      }
    >
      <Card pad={0}>
        {events.map((e, i) => {
          const p = e.who === 'system' ? null : e.who === 'cto' ? null : personaById(e.who);
          const I = Icons[e.ic] || Icons.Spark;
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 24px 1fr 80px',
                padding: '12px 16px',
                alignItems: 'center',
                gap: 12,
                borderTop: i ? '1px solid var(--line)' : 'none',
              }}
            >
              <span className="mono tnum" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                {e.t}
              </span>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--bg-active)',
                  color: 'var(--accent)',
                }}
              >
                <I size={11} />
              </span>
              <div className="row gap-2">
                {p ? (
                  <span className={`avatar sm ${p.cls}`}>{p.initials}</span>
                ) : e.who === 'cto' ? (
                  <span className="avatar sm" style={{ background: 'oklch(0.42 0.02 260)' }}>
                    JS
                  </span>
                ) : (
                  <span
                    className="avatar sm"
                    style={{
                      background: 'transparent',
                      border: '1px dashed var(--line-2)',
                      color: 'var(--fg-3)',
                    }}
                  >
                    SY
                  </span>
                )}
                <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>
                  {p ? p.name : e.who === 'cto' ? 'You' : 'system'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{e.verb}</span>
              </div>
              <span style={{ textAlign: 'right' }}>
                <Icons.ArrowR size={11} style={{ color: 'var(--fg-4)' }} />
              </span>
            </div>
          );
        })}
      </Card>
    </Shell>
  );
}

// ─── 9. Chat ─────────────────────────────────────────────────
function Chat() {
  const msgs = [
    { who: 'cto', t: 'Why does the metric drift?', tm: '03:01' },
    {
      who: 'aster',
      t: 'Timer window for the abandon event uses local time. After UTC midnight, sessions get split across day-buckets and counted twice. I traced it to cart.ts:142.',
      tm: '03:02',
    },
    { who: 'cto', t: 'Confidence?', tm: '03:03' },
    {
      who: 'aster',
      t: '0.94. Vega cross-checked. Drift trend matches DST boundary on 04/12.',
      tm: '03:03',
    },
    { who: 'cto', t: 'Cyra — make sure the AC includes DST + concurrent sessions.', tm: '03:05' },
    { who: 'cyra', t: 'On it. Adding to v3 now. PRD will be ready in ~1 min.', tm: '03:06' },
    {
      who: 'cyra',
      t: 'PRD v3 ready. 4 acceptance criteria, behind cart_abandon_v2 flag. Approved on my side.',
      tm: '03:14',
    },
    { who: 'cto', t: 'Approved. Bram, ship it.', tm: '03:18' },
  ];
  return (
    <Shell
      eyebrow="09 · Chat"
      title="Conversation with the harness"
      hint="@-mention any persona to delegate. Decisions and approvals live here."
      actions={
        <button className="btn sm">
          <Icons.Plus size={12} />
          New thread
        </button>
      }
    >
      <Card pad={0}>
        <div style={{ padding: '0 0' }}>
          {msgs.map((m, i) => {
            const isUser = m.who === 'cto';
            const p = isUser ? null : personaById(m.who);
            return (
              <div
                key={i}
                style={{
                  padding: '12px 18px',
                  borderTop: i ? '1px solid var(--line)' : 'none',
                  background: isUser ? 'var(--bg-elev-2)' : 'transparent',
                }}
              >
                <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  {isUser ? (
                    <span
                      className="avatar"
                      style={{ background: 'oklch(0.42 0.02 260)', color: 'var(--fg)' }}
                    >
                      JS
                    </span>
                  ) : (
                    <span className={`avatar ${p.cls}`}>{p.initials}</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row gap-2" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {isUser ? 'You' : p.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        · {isUser ? 'Engineering Lead' : p.role}
                      </span>
                      <span className="grow" />
                      <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
                        {m.tm}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13.5,
                        color: 'var(--fg-2)',
                        lineHeight: 1.55,
                        textWrap: 'pretty',
                      }}
                    >
                      {m.t}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            borderTop: '1px solid var(--line)',
            padding: 14,
            background: 'var(--bg-elev-2)',
          }}
        >
          <div
            className="row gap-2"
            style={{
              alignItems: 'center',
              background: 'var(--bg)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <Icons.Spark size={13} style={{ color: 'var(--accent)' }} />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--fg-3)' }}>
              Reply to the harness… use @ to mention a persona
            </span>
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

// ─── 10. Costs ───────────────────────────────────────────────
function Costs() {
  const t = D.task;
  const breakdown = [
    {
      who: 'aster',
      model: 'sonnet 4.5',
      tok: 142_000,
      dol: 0.62,
      op: 'investigation, repo selection',
    },
    { who: 'cyra', model: 'opus 4', tok: 48_000, dol: 0.34, op: 'PRD drafting, review' },
    { who: 'bram', model: 'sonnet 4.5', tok: 188_000, dol: 0.18, op: 'patching, tests' },
    { who: 'vega', model: 'sonnet 4.5', tok: 62_000, dol: 0.06, op: 'cross-check' },
    { who: 'niko', model: 'haiku 4.5', tok: 24_000, dol: 0.0, op: 'idle until QA' },
  ];
  return (
    <Shell
      eyebrow="10 · Costs"
      title="Token economics for this task"
      hint={`$${t.cost.toFixed(2)} of $5.00 budget · projecting $2.10 at PR-ready`}
      actions={
        <>
          <button className="btn sm">
            <Icons.Pen size={12} />
            Set budget
          </button>
          <button className="btn sm">
            <Icons.Coin size={12} />
            Per-persona caps
          </button>
        </>
      }
    >
      <StatRow
        items={[
          {
            label: 'Spent',
            v: `$${t.cost.toFixed(2)}`,
            sub: `of $5.00 (${Math.round((t.cost / 5) * 100)}%)`,
            color: 'var(--accent)',
          },
          { label: 'Tokens', v: '464k', sub: 'across 5 personas' },
          { label: 'Projected', v: '$2.10', sub: 'at PR-ready' },
          { label: 'Cost/loc', v: '$0.0048', sub: '+284 lines added' },
        ]}
      />
      <Card pad={0}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 130px 100px 100px 1fr',
            padding: '11px 16px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-elev-2)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.05,
            textTransform: 'uppercase',
            color: 'var(--fg-3)',
          }}
        >
          <span>Persona</span>
          <span>Model</span>
          <span style={{ textAlign: 'right' }}>Tokens</span>
          <span style={{ textAlign: 'right' }}>Cost</span>
          <span style={{ paddingLeft: 14 }}>Operations</span>
        </div>
        {breakdown.map((b, i) => {
          const p = personaById(b.who);
          const max = Math.max(...breakdown.map((x) => x.dol));
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 130px 100px 100px 1fr',
                padding: '12px 16px',
                borderTop: i ? '1px solid var(--line)' : 'none',
                alignItems: 'center',
              }}
            >
              <div className="row gap-2">
                <span className={`avatar sm ${p.cls}`}>{p.initials}</span>
                <span style={{ fontSize: 12.5 }}>{p.name}</span>
              </div>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                {b.model}
              </span>
              <span className="mono tnum" style={{ textAlign: 'right', fontSize: 12 }}>
                {(b.tok / 1000).toFixed(0)}k
              </span>
              <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                <div style={{ width: 36, height: 4, background: 'var(--line)', borderRadius: 2 }}>
                  <div
                    style={{
                      width: `${(b.dol / max) * 100}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 2,
                    }}
                  />
                </div>
                <span
                  className="mono tnum"
                  style={{ fontSize: 12, minWidth: 44, textAlign: 'right' }}
                >
                  ${b.dol.toFixed(2)}
                </span>
              </div>
              <span style={{ paddingLeft: 14, fontSize: 12, color: 'var(--fg-3)' }}>{b.op}</span>
            </div>
          );
        })}
      </Card>
    </Shell>
  );
}

window.Sec.Timeline = Timeline;
window.Sec.Chat = Chat;
window.Sec.Costs = Costs;
