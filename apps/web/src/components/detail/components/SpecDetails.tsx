import type { EngineeringSpecDto } from '@/lib/types';
import {
  ClipboardCheck,
  Database,
  FileCode2,
  GitBranch,
  Package,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { DetailAccordion } from './DetailAccordion';

function hasText(value: string | null | undefined): value is string {
  return value != null && value.trim().length > 0;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-fg-3 mb-2">{title}</div>
      {children}
    </section>
  );
}

function MonoList({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-fg-5">None</span>;
  return (
    <div className="flex flex-col gap-1">
      {values.map((value) => (
        <span key={value} className="font-mono text-[10.5px] text-fg-4 break-words">
          {value}
        </span>
      ))}
    </div>
  );
}

export function SpecDetails({
  spec,
}: {
  spec: EngineeringSpecDto;
  itemState?: string;
}) {
  const wpCount = spec.workPackages.length;
  const hasArchitecture =
    spec.architecture != null &&
    (hasText(spec.architecture.current) ||
      hasText(spec.architecture.new) ||
      hasText(spec.architecture.decisionRationale));
  const hasSchemaChanges =
    spec.schemaChanges != null &&
    (spec.schemaChanges.ddl.length > 0 || spec.schemaChanges.migrations.length > 0);

  return (
    <DetailAccordion
      title="Engineering Spec"
      summary={`${wpCount} work package${wpCount !== 1 ? 's' : ''} · ${spec.acceptanceCriteriaCount} AC`}
      icon={<Package size={12} />}
    >
      <div className="flex flex-col gap-4">
        <Section title="Objective">
          <p className="text-[12.5px] text-fg-2 leading-relaxed">{spec.objective}</p>
        </Section>

        {hasArchitecture && spec.architecture != null && (
          <Section title="Architecture">
            <div className="grid gap-2 text-[12px] text-fg-2">
              {hasText(spec.architecture.current) && (
                <div>
                  <span className="text-fg-4">Current: </span>
                  {spec.architecture.current}
                </div>
              )}
              {hasText(spec.architecture.new) && (
                <div>
                  <span className="text-fg-4">New: </span>
                  {spec.architecture.new}
                </div>
              )}
              {hasText(spec.architecture.decisionRationale) && (
                <div>
                  <span className="text-fg-4">Rationale: </span>
                  {spec.architecture.decisionRationale}
                </div>
              )}
            </div>
          </Section>
        )}

        {spec.workPackages.length > 0 && (
          <Section title="Work Packages">
            <div className="rounded border border-line overflow-hidden">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-line bg-bg-elev-2">
                    <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">ID</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium">Changes</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium">Files</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium w-28">Depends</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.workPackages.map((wp) => (
                    <tr key={wp.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-3 py-2 font-mono text-fg-2 whitespace-nowrap">{wp.id}</td>
                      <td className="px-3 py-2 text-fg-2 leading-relaxed">{wp.changes}</td>
                      <td className="px-3 py-2">
                        <MonoList values={wp.filesOwned} />
                      </td>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-fg-4">
                        {wp.dependsOn.length > 0 ? wp.dependsOn.join(', ') : 'None'}
                      </td>
                      <td className="px-3 py-2 font-mono text-fg-4 whitespace-nowrap">
                        {wp.builderTier}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {spec.executionOrder.length > 0 && (
          <Section title="Execution Order">
            <div className="flex flex-col gap-2">
              {spec.executionOrder.map((batch) => (
                <div
                  key={`${batch.batch}:${batch.wpIds.join(',')}`}
                  className="flex items-center gap-2 text-[12px] text-fg-2"
                >
                  <GitBranch size={12} className="shrink-0 text-fg-4" />
                  <span className="font-mono text-fg-4">Batch {batch.batch}</span>
                  <span>{batch.wpIds.join(', ')}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Acceptance Criteria">
          <div className="flex items-center gap-2 text-[11.5px] text-fg-3 mb-2">
            <ClipboardCheck size={12} className="text-fg-4 shrink-0" />
            <span>{spec.acceptanceCriteriaCount} acceptance criteria</span>
          </div>
          {spec.acceptanceCriteria.length > 0 && (
            <ol className="flex flex-col gap-2">
              {spec.acceptanceCriteria.map((ac) => (
                <li key={ac.id} className="grid grid-cols-[3.5rem_1fr] gap-3 text-[12px] text-fg-2">
                  <span className="font-mono text-[11px] text-fg-4">{ac.id}</span>
                  <div className="min-w-0">
                    <div className="leading-relaxed">{ac.statement}</div>
                    {(ac.executableChecks?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {ac.executableChecks?.map((check) => (
                          <div
                            key={check.id}
                            className="flex items-start gap-2 rounded border border-line bg-bg-elev-2 px-2 py-1.5"
                          >
                            <Terminal size={10} className="mt-0.5 shrink-0 text-fg-4" />
                            <div className="min-w-0">
                              <div className="font-mono text-[10.5px] text-fg-4 break-words">
                                {check.command}
                              </div>
                              <div className="text-[10px] text-fg-5">
                                {(check.kind ?? 'custom').toUpperCase()} · exit{' '}
                                {(check.expectedExitCodes ?? [0]).join(', ')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {spec.verificationTooling.length > 0 && (
          <Section title="Verification">
            <div className="flex flex-col gap-2">
              {spec.verificationTooling.map((tool) => (
                <div key={tool.name} className="rounded border border-line bg-bg-elev-2 px-3 py-2">
                  <div className="flex items-center gap-2 text-[12px] text-fg-2">
                    <Terminal size={12} className="shrink-0 text-fg-4" />
                    <span className="font-medium">{tool.name}</span>
                    <span className="text-[10px] text-fg-5">
                      exit {tool.expectedExitCodes.join(', ')}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-fg-4 break-words">
                    {tool.command}
                  </div>
                  {hasText(tool.inputSpec) && (
                    <div className="mt-1 text-[11px] text-fg-4">{tool.inputSpec}</div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {spec.interfaceContracts.length > 0 && (
          <Section title="Interfaces">
            <div className="flex flex-col gap-2">
              {spec.interfaceContracts.map((contract) => (
                <div
                  key={`${contract.file}:${contract.name}`}
                  className="rounded border border-line bg-bg-elev-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-[12px] text-fg-2">
                    <FileCode2 size={12} className="shrink-0 text-fg-4" />
                    <span className="font-medium">{contract.name}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-fg-4 break-words">
                    {contract.file}
                    {contract.lineRange != null ? `:${contract.lineRange}` : ''}
                  </div>
                  {contract.requiredExports != null && contract.requiredExports.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {contract.requiredExports.map((requiredExport) => (
                        <span
                          key={`${requiredExport.file ?? contract.file}:${requiredExport.name}`}
                          className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-3"
                        >
                          export {requiredExport.name}
                          {requiredExport.file != null ? ` @ ${requiredExport.file}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-bg px-2 py-2 text-[10.5px] text-fg-3">
                    {contract.signature}
                  </pre>
                </div>
              ))}
            </div>
          </Section>
        )}

        {hasSchemaChanges && spec.schemaChanges != null && (
          <Section title="Schema">
            <div className="flex flex-col gap-2 text-[12px] text-fg-2">
              {spec.schemaChanges.ddl.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-fg-4 mb-1">
                    <Database size={12} />
                    <span>DDL</span>
                  </div>
                  <MonoList values={spec.schemaChanges.ddl} />
                </div>
              )}
              {spec.schemaChanges.migrations.length > 0 && (
                <div>
                  <div className="text-fg-4 mb-1">Migrations</div>
                  <MonoList values={spec.schemaChanges.migrations} />
                </div>
              )}
            </div>
          </Section>
        )}

        {spec.constraints.length > 0 && (
          <Section title="Constraints">
            <div className="flex flex-col gap-1">
              {spec.constraints.map((constraint) => (
                <div
                  key={`${constraint.kind}:${constraint.name}:${constraint.source}`}
                  className="grid grid-cols-[5.5rem_1fr] gap-2 text-[12px]"
                >
                  <span className="font-mono text-[10.5px] text-fg-4">{constraint.kind}</span>
                  <span className="text-fg-2">
                    {constraint.name}{' '}
                    <span className="font-mono text-[10.5px] text-fg-4 break-words">
                      {constraint.source}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {spec.riskRegister.length > 0 && (
          <Section title="Risks">
            <div className="flex flex-col gap-2">
              {spec.riskRegister.map((risk) => (
                <div key={`${risk.severity}:${risk.risk}`} className="text-[12px] text-fg-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={12} className="shrink-0 text-fg-4" />
                    <span className="font-mono text-[10.5px] uppercase text-fg-4">
                      {risk.severity}
                    </span>
                    <span>{risk.risk}</span>
                  </div>
                  <div className="ml-5 mt-1 text-fg-4">{risk.mitigation}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Metadata">
          <div className="grid gap-1 text-[11px] text-fg-4">
            <div>
              <span className="text-fg-5">Pipeline: </span>
              <span className="font-mono break-words">{spec.pipelineRunId}</span>
            </div>
            <div>
              <span className="text-fg-5">Updated: </span>
              <span className="font-mono">{spec.updatedAt}</span>
            </div>
          </div>
        </Section>
      </div>
    </DetailAccordion>
  );
}
