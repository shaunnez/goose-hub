// sections-c.jsx — sections 5-7
const { Icons } = window;
const D = window.HARNESS_DATA;
const { Shell, Card, StatRow, PInline } = window.Sec._helpers;

function Code() {
  const [active, setActive] = React.useState(D.files[0].path);
  const file = D.files.find(f => f.path === active);
  const adds = D.files.reduce((a, f) => a + f.add, 0);
  const dels = D.files.reduce((a, f) => a + f.del, 0);
  return (
    <Shell eyebrow="05 · Code" title="Patch in flight"
      hint={`Bram · 12 files · +${adds} / −${dels} · branch tas-1662/cart-abandonment-fix`}
      actions={<><button className="btn sm"><Icons.Term size={12}/>Editor</button><button className="btn sm primary"><Icons.GitBranch size={12}/>Open PR</button></>}>
      <Card pad={0}>
        <div style={{ display: 'grid', gridTemplateColumns: '270px 1fr', minHeight: 460 }}>
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}><div className="eyebrow">Files · 12</div></div>
            {D.files.map(f => (
              <button key={f.path} onClick={() => setActive(f.path)} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 14px', border: 'none',
                background: active === f.path ? 'var(--accent-soft)' : 'transparent', textAlign: 'left', cursor: 'pointer',
                borderLeft: active === f.path ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, width: 12, color: f.status === 'new' ? 'var(--success)' : 'var(--warning)' }}>{f.status === 'new' ? 'A' : 'M'}</span>
                <span className="mono nowrap" style={{ flex: 1, fontSize: 11.5, color: active === f.path ? 'var(--fg)' : 'var(--fg-2)' }}>{f.path.split('/').slice(-1)[0]}</span>
                <span className="mono tnum" style={{ fontSize: 10, color: 'var(--success)' }}>+{f.add}</span>
                <span className="mono tnum" style={{ fontSize: 10, color: 'var(--danger)' }}>−{f.del}</span>
              </button>
            ))}
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="row gap-3" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 12.5 }}>{file.path}</span>
              <span className="grow" />
              <span className="mono tnum" style={{ fontSize: 11.5 }}><span style={{ color: 'var(--success)' }}>+{file.add}</span> <span style={{ color: 'var(--danger)' }}>−{file.del}</span></span>
            </div>
            <Diff />
          </div>
        </div>
      </Card>
    </Shell>
  );
}

function Diff() {
  const lines = [
    { k: 'meta', c: '@@ -134,12 +134,18 @@ src/metrics/cart.ts' },
    { k: 'ctx', l: 134, r: 134, c: 'export class CartTracker {' },
    { k: 'ctx', l: 135, r: 135, c: '  private windows = new Map<string, AbandonWindow>();' },
    { k: 'del', l: 137, r: '',  c: '  shouldAbandon(s: Session): boolean {' },
    { k: 'del', l: 138, r: '',  c: '    const start = new Date(s.lastEvent).getTime();' },
    { k: 'del', l: 139, r: '',  c: '    return Date.now() - start > 30 * 60 * 1000;' },
    { k: 'del', l: 140, r: '',  c: '  }' },
    { k: 'add', l: '',  r: 137, c: '  shouldAbandon(s: Session): boolean {' },
    { k: 'add', l: '',  r: 138, c: '    // FIX: pin to UTC; window must not cross day-boundary' },
    { k: 'add', l: '',  r: 139, c: '    const start = utcMillis(s.lastEvent);' },
    { k: 'add', l: '',  r: 140, c: '    const now   = utcMillis(new Date());' },
    { k: 'add', l: '',  r: 141, c: '    return (now - start) > THIRTY_MIN_MS;' },
    { k: 'add', l: '',  r: 142, c: '  }' },
    { k: 'ctx', l: 141, r: 143, c: '' },
    { k: 'ctx', l: 142, r: 144, c: '  emit(s: Session) {' },
  ];
  const bg = { add: 'oklch(0.68 0.16 156 / 0.12)', del: 'oklch(0.65 0.20 28 / 0.12)' };
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55 }}>
      {lines.map((l, i) => l.k === 'meta' ? (
        <div key={i} style={{ padding: '6px 16px', color: 'var(--fg-3)', background: 'var(--bg-elev-2)' }}>{l.c}</div>
      ) : (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 40px 14px 1fr', padding: '0 8px', background: bg[l.k] }}>
          <span className="mono tnum" style={{ color: 'var(--fg-4)', textAlign: 'right', paddingRight: 6 }}>{l.l}</span>
          <span className="mono tnum" style={{ color: 'var(--fg-4)', textAlign: 'right', paddingRight: 6 }}>{l.r}</span>
          <span style={{ color: 'var(--fg-3)', textAlign: 'center' }}>{l.k === 'add' ? '+' : l.k === 'del' ? '−' : ' '}</span>
          <span style={{ color: l.k === 'ctx' ? 'var(--fg-2)' : 'var(--fg)', whiteSpace: 'pre' }}>{l.c}</span>
        </div>
      ))}
    </div>
  );
}

function QA() {
  const suites = [
    { n: 'cart.test.ts',     tot: 18, p: 18, ms: 412,  s: 'pass' },
    { n: 'funnel.test.ts',   tot: 12, p: 12, ms: 288,  s: 'pass' },
    { n: 'abandon.int.ts',   tot: 6,  p: 6,  ms: 1840, s: 'pass' },
    { n: 'timestamps.prop',  tot: 2,  p: 2,  ms: 5120, s: 'pass' },
    { n: '24h-replay.ts',    tot: 1,  p: 0,  ms: 0,    s: 'queue' },
  ];
  return (
    <Shell eyebrow="06 · QA" title="Niko's regression sweep"
      hint="38 of 39 passing · 1 queued · 0 failing"
      actions={<><button className="btn sm"><Icons.Refresh size={12}/>Re-run</button><button className="btn sm primary"><Icons.Plus size={12}/>Add test</button></>}>
      <StatRow items={[
        { label: 'Pass / Fail', v: '38 / 0', sub: 'queued: 1', color: 'var(--success)' },
        { label: 'Coverage', v: '94.2%', sub: '+1.8 baseline' },
        { label: 'Wall time', v: '7.7s', sub: '4 workers' },
        { label: 'Flake risk', v: 'low', sub: '0 reruns', color: 'var(--success)' },
      ]} />
      <Card pad={0}>
        {suites.map((s, i) => (
          <div key={s.n} style={{
            display: 'grid', gridTemplateColumns: '1.5fr 1fr 100px 100px 100px',
            padding: '12px 16px', alignItems: 'center',
            borderTop: i ? '1px solid var(--line)' : 'none',
          }}>
            <div className="row gap-3">
              <span style={{ width: 8, height: 8, borderRadius: 4, background: s.s === 'pass' ? 'var(--success)' : 'var(--warning)' }} />
              <span className="mono" style={{ fontSize: 12.5 }}>{s.n}</span>
            </div>
            <div className="row gap-1">
              {Array.from({ length: s.tot }).map((_, j) => (
                <span key={j} style={{ width: 8, height: 14, borderRadius: 1.5, background: j < s.p ? 'var(--success)' : 'var(--line-2)' }} />
              ))}
            </div>
            <span className="mono tnum" style={{ textAlign: 'right', fontSize: 12, color: 'var(--fg-2)' }}>{s.p}/{s.tot}</span>
            <span className="mono tnum" style={{ textAlign: 'right', fontSize: 12, color: 'var(--fg-3)' }}>{s.ms ? `${s.ms}ms` : '—'}</span>
            <span style={{ textAlign: 'right' }}>
              {s.s === 'pass'
                ? <span className="pill" style={{ color: 'var(--success)', borderColor: 'oklch(from var(--success) l c h / 0.4)', background: 'oklch(from var(--success) l c h / 0.1)' }}>passing</span>
                : <span className="pill" style={{ color: 'var(--warning)', borderColor: 'oklch(from var(--warning) l c h / 0.4)', background: 'oklch(from var(--warning) l c h / 0.1)' }}>queued</span>}
            </span>
          </div>
        ))}
      </Card>
    </Shell>
  );
}

function Review() {
  const checks = [
    { ok: true, t: 'Lint clean (0 errors, 0 warnings)' },
    { ok: true, t: 'Type check passes (tsc --strict)' },
    { ok: true, t: 'All tests passing (38/38)' },
    { ok: true, t: 'Bundle size delta within budget (+0.4kb)' },
    { ok: true, t: 'No new accessibility regressions' },
    { ok: true, t: 'No secrets / PII in diff' },
    { ok: true, t: 'Feature flag wired correctly' },
    { ok: true, t: 'Migration plan documented in PR body' },
    { ok: false, t: 'Replay against 24h traffic (queued — runs on PR open)' },
  ];
  return (
    <Shell eyebrow="07 · Review" title="Cyra's pre-merge checklist"
      hint="8 of 9 checks pass · 1 queued. Open PR to run the final replay."
      actions={<><button className="btn sm"><Icons.Refresh size={12}/>Re-run</button><button className="btn sm primary"><Icons.GitBranch size={12}/>Open PR</button></>}>
      <Card pad={0}>
        {checks.map((c, i) => (
          <div key={i} className="row gap-3" style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              background: c.ok ? 'var(--success)' : 'transparent',
              border: c.ok ? 'none' : '1.5px dashed var(--line-2)',
              display: 'grid', placeItems: 'center' }}>
              {c.ok && <Icons.Check size={12} sw={2.4}/>}
            </span>
            <span style={{ flex: 1, fontSize: 13, color: c.ok ? 'var(--fg)' : 'var(--fg-3)' }}>{c.t}</span>
            <button className="btn sm" style={{ opacity: c.ok ? 0.6 : 1 }}><Icons.Term size={11}/>Log</button>
          </div>
        ))}
      </Card>
    </Shell>
  );
}

window.Sec.Investigation = window.Sec.Investigation;  // already set in sections-b
window.Sec.PRD = window.Sec.PRD;
window.Sec.Code = Code;
window.Sec.QA = QA;
window.Sec.Review = Review;
