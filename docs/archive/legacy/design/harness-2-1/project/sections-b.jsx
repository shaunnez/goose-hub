// sections-b.jsx — sections 3, 4 (Investigation, PRD)
const { Icons } = window;
const D = window.HARNESS_DATA;
const { Shell, Card, StatRow, PInline } = window.Sec._helpers;
const personaById = (id) => D.personas.find((p) => p.id === id);

// ─── 3. Investigation ─────────────────────────────────────────
function Investigation() {
  const findings = [
    {
      sev: 'high',
      by: 'aster',
      t: 'Timer window leaks across UTC midnight',
      file: 'src/metrics/cart.ts:142',
      body: 'cart.ts uses local time for the 30-min abandonment window. After 23:30 local, sessions split across day-buckets and double-count.',
      conf: 0.94,
    },
    {
      sev: 'med',
      by: 'vega',
      t: 'sendBeacon flush race on tab unload',
      file: 'src/api/events.ts:54',
      body: 'flush() resolves before sendBeacon completes when tab unloads <80ms after event. ~0.4pp drift independently.',
      conf: 0.78,
    },
    {
      sev: 'low',
      by: 'aster',
      t: 'Funnel SQL aliases timestamp column',
      file: 'analytics/funnel.sql:22',
      body: 'Pre-existing, unrelated to drift. Worth filing as TAS-1671.',
      conf: 0.52,
    },
  ];
  const sevC = { high: 'var(--danger)', med: 'var(--warning)', low: 'var(--fg-3)' };
  const trail = [
    { t: '0:04', who: 'aster', verb: 'rg', obj: '"abandon" → 23 hits across 4 files' },
    { t: '0:31', who: 'aster', verb: 'read', obj: 'src/metrics/cart.ts:88-180' },
    { t: '1:12', who: 'aster', verb: 'web', obj: 'mixpanel docs · funnels · timezone handling' },
    { t: '1:48', who: 'vega', verb: 'note', obj: 'reproduced double-count in 23:45→00:15 session' },
    { t: '2:14', who: 'aster', verb: 'finding', obj: 'high-sev #1 filed' },
  ];
  return (
    <Shell
      eyebrow="03 · Investigation"
      title="What Aster found"
      hint="47 file reads · 12 searches · 3 web fetches · cross-checked by Vega"
      actions={
        <>
          <button className="btn sm">
            <Icons.Filter size={12} />
            Filter
          </button>
          <button className="btn sm">
            <Icons.Refresh size={12} />
            Re-run
          </button>
        </>
      }
    >
      <StatRow
        items={[
          { label: 'Findings', v: '3', sub: '1 high · 1 med · 1 low' },
          { label: 'Reads', v: '47', sub: 'across 12 files' },
          { label: 'Searches', v: '12', sub: 'rg + ast-grep' },
          { label: 'Conf avg', v: '0.75', sub: 'weighted by severity' },
        ]}
      />
      {findings.map((f, i) => {
        const p = personaById(f.by);
        return (
          <Card key={i} pad={0}>
            <div style={{ display: 'grid', gridTemplateColumns: '4px 1fr', minHeight: 90 }}>
              <div style={{ background: sevC[f.sev] }} />
              <div style={{ padding: 16 }}>
                <div className="row gap-2" style={{ marginBottom: 6 }}>
                  <span
                    className="pill"
                    style={{
                      borderColor: `oklch(from ${sevC[f.sev]} l c h / 0.4)`,
                      color: sevC[f.sev],
                      background: `oklch(from ${sevC[f.sev]} l c h / 0.1)`,
                      fontWeight: 600,
                      letterSpacing: 0.06,
                    }}
                  >
                    {f.sev.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{f.t}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55 }}>
                  {f.body}
                </p>
                <div
                  className="row gap-3"
                  style={{ marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    {f.file}
                  </span>
                  <span style={{ width: 1, height: 12, background: 'var(--line)' }} />
                  <span className="row gap-2" style={{ fontSize: 11.5 }}>
                    <span className={`avatar sm ${p.cls}`}>{p.initials}</span>
                    <span style={{ color: 'var(--fg-2)' }}>{p.name}</span>
                  </span>
                  <span className="grow" />
                  <span className="row gap-2" style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--fg-3)' }}>conf</span>
                    <div
                      style={{ width: 60, height: 4, background: 'var(--line)', borderRadius: 2 }}
                    >
                      <div
                        style={{
                          width: `${f.conf * 100}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <span className="mono tnum" style={{ color: 'var(--fg-2)' }}>
                      {f.conf.toFixed(2)}
                    </span>
                  </span>
                  <button className="btn sm">
                    <Icons.Code size={11} />
                    View
                  </button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
      <Card eyebrow="Investigation trail" title="What was looked at, in order">
        <div className="col gap-2">
          {trail.map((s, i) => {
            const p = personaById(s.who);
            return (
              <div key={i} className="row gap-3" style={{ fontSize: 12.5, padding: '4px 0' }}>
                <span className="mono tnum" style={{ width: 38, color: 'var(--fg-4)' }}>
                  {s.t}
                </span>
                <span className={`avatar sm ${p.cls}`}>{p.initials}</span>
                <span className="mono" style={{ width: 60, color: 'var(--fg-3)' }}>
                  {s.verb}
                </span>
                <span style={{ flex: 1, color: 'var(--fg-2)' }}>{s.obj}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </Shell>
  );
}

// ─── 4. PRD ───────────────────────────────────────────────────
function PRD() {
  const ac = [
    {
      ok: true,
      t: 'BI dashboard cart-abandon counter matches in-product analytics within ±1.5pp over 7d window',
    },
    { ok: true, t: 'Fix is gated behind cart_abandon_v2 feature flag with 1% → 100% ramp' },
    { ok: true, t: 'No retroactive backfill — historical drift acknowledged in CHANGELOG' },
    { ok: false, t: 'Property tests cover UTC-midnight, DST, and concurrent session edge cases' },
  ];
  return (
    <Shell
      eyebrow="04 · PRD"
      title="Restore parity in cart-abandonment counter"
      hint="v3 · approved by Cyra 2m ago"
      actions={
        <>
          <button className="btn sm">
            <Icons.Pen size={12} />
            Edit
          </button>
          <button className="btn sm">
            <Icons.History size={12} />
            v1 · v2 · v3
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <Card pad={20}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Goal
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--fg)' }}>
            Eliminate the 11–14% drift between BI's cart-abandonment metric and in-product analytics
            so finance, growth, and product can share a single source of truth.
          </p>
          <div className="eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>
            Non-goals
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              color: 'var(--fg-2)',
              lineHeight: 1.7,
            }}
          >
            <li>Re-architecting the metrics transport layer.</li>
            <li>Backfilling historical events (acknowledged loss).</li>
            <li>Changing the in-product analytics SDK.</li>
          </ul>
          <div className="eyebrow" style={{ marginTop: 18, marginBottom: 10 }}>
            Acceptance criteria
          </div>
          <div className="col gap-2">
            {ac.map((c, i) => (
              <div key={i} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    flexShrink: 0,
                    marginTop: 1,
                    background: c.ok ? 'var(--success)' : 'transparent',
                    border: c.ok ? 'none' : '1.5px dashed var(--line-2)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {c.ok && <Icons.Check size={11} sw={2.4} />}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: c.ok ? 'var(--fg-2)' : 'var(--fg-3)',
                    lineHeight: 1.5,
                  }}
                >
                  {c.t}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <div className="col gap-3">
          <Card eyebrow="Owner" pad={14}>
            <div className="row gap-3" style={{ alignItems: 'center' }}>
              <span className="avatar lg cyra">CY</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Cyra</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>PM persona · approved v3</div>
              </div>
            </div>
          </Card>
          <Card eyebrow="Stakeholders" pad={14}>
            <div className="col gap-2" style={{ fontSize: 12.5 }}>
              {[
                ['cto', 'requested'],
                ['growth lead', 'consulted'],
                ['data eng', 'informed'],
              ].map(([r, o], i) => (
                <div key={i} className="row gap-2">
                  <span
                    style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }}
                  />
                  <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{r}</span>
                  <span style={{ color: 'var(--fg-3)' }}>· {o}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card eyebrow="Rollout plan" pad={14}>
            <div className="col gap-2" style={{ fontSize: 12.5 }}>
              {[
                ['day 1', '1% cohort'],
                ['day 3', '10% cohort'],
                ['day 5', '50% cohort'],
                ['day 7', '100% — flag retired'],
              ].map(([d, t], i) => (
                <div key={i} className="row gap-3">
                  <span className="mono" style={{ width: 50, color: 'var(--fg-3)' }}>
                    {d}
                  </span>
                  <span style={{ color: 'var(--fg)' }}>{t}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

window.Sec.Investigation = Investigation;
window.Sec.PRD = PRD;
