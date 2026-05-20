import type { ProjectConfigDto } from '@/lib/types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-line last:border-0">
      <span className="w-40 shrink-0 text-[11.5px] text-fg-2 uppercase tracking-wider pt-0.5">
        {label}
      </span>
      <span className="text-[12.5px] text-fg font-mono break-all">{value}</span>
    </div>
  );
}

function OptionalRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === '') return null;
  return <Row label={label} value={value} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] uppercase tracking-wider text-fg-2 mb-1.5">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

interface Props {
  config: ProjectConfigDto;
}

export function ProjectConfigPanel({ config }: Props) {
  return (
    <div data-testid="project-config-panel" className="flex flex-col gap-6">
      <Section title="Project">
        <Row label="Name" value={config.name} />
        <Row label="Slug" value={config.slug} />
        <Row label="Source" value={`${config.source.kind}:${config.source.repo}`} />
        <Row
          label="Active milestone"
          value={
            config.activeMilestone != null ? (
              config.activeMilestone
            ) : (
              <span className="text-fg-2 italic">github default</span>
            )
          }
        />
        <Row label="Mode" value={config.mode} />
        <Row
          label="Color"
          value={
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: config.colorStripe }}
              />
              {config.colorStripe}
            </span>
          }
        />
      </Section>

      <Section title="Target repo">
        <Row label="Default branch" value={config.targetRepo.defaultBranch} />
        <Row label="Local path" value={config.targetRepo.localPath} />
        <Row label="Clone URL" value={config.targetRepo.cloneUrl} />
      </Section>

      <Section title="Stack">
        <Row label="Runtime" value={config.stack.runtime} />
        <Row label="Package manager" value={config.stack.packageManager} />
        <OptionalRow label="Test command" value={config.stack.testCommand} />
        <OptionalRow label="Lint command" value={config.stack.lintCommand} />
        <OptionalRow label="Typecheck command" value={config.stack.typecheckCommand} />
        <OptionalRow label="E2E command" value={config.stack.e2eCommand} />
      </Section>

      <Section title="Runtime context">
        <Row label="Storage path" value={config.storage.path} />
        <Row label="Isolation" value={config.isolation.mode} />
      </Section>
    </div>
  );
}
