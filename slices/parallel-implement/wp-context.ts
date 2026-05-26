import { basename } from 'node:path';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import type { ExecutableCheck } from '@goose-hub/core/acceptance-contracts/types.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';

export type ImplementWpSpecContext = {
  objective: string;
  architecture: EngineeringSpec['architecture'];
  functionalRequirements: EngineeringSpec['functionalRequirements'];
  interfaceContracts: EngineeringSpec['interfaceContracts'];
  constraints: EngineeringSpec['constraints'];
  dependencyWpIds: string[];
  dependencyFilesOwned: string[];
};

export type ImplementWpSpecHandoff = {
  specContext: ImplementWpSpecContext;
  acceptanceContract: AcceptanceContract;
  verificationCommands: ExecutableCheck[];
};

function normalizePathForCompare(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+$/, '');
}

function pathsMatch(left: string, right: string): boolean {
  const a = normalizePathForCompare(left);
  const b = normalizePathForCompare(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function pascalCaseToken(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function commandReferenceTokensForPath(path: string): string[] {
  const name = basename(path);
  const withoutFinalExt = name.replace(/\.[^.]+$/, '');
  const testStem = withoutFinalExt.replace(/\.(test|spec)$/, '');
  const humanStem = testStem.replace(/[-_]+/g, ' ');
  const tokens = new Set<string>([
    normalizePathForCompare(path),
    name,
    withoutFinalExt,
    testStem,
    humanStem,
    pascalCaseToken(testStem),
  ]);
  return [...tokens].filter((token) => token.length >= 3);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textContainsBoundaryToken(text: string, token: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(token)}([^A-Za-z0-9]|$)`, 'i').test(text);
}

export function commandMentionsWpFile(command: string, filesOwned: string[]): boolean {
  const normalizedCommand = command.replace(/\\/g, '/');
  return filesOwned.some((path) =>
    commandReferenceTokensForPath(path).some((token) =>
      textContainsBoundaryToken(normalizedCommand, token.replace(/\\/g, '/')),
    ),
  );
}

function wpRelevantExecutableChecks(input: {
  acceptanceContract?: AcceptanceContract;
  verificationCommands?: ExecutableCheck[];
  filesOwned: string[];
}): ExecutableCheck[] {
  const fromCriteria =
    input.acceptanceContract?.criteria.flatMap((criterion) => criterion.executableChecks ?? []) ??
    [];
  const candidates = [...fromCriteria, ...(input.verificationCommands ?? [])];
  const seen = new Set<string>();
  return candidates.filter((check) => {
    if (!commandMentionsWpFile(check.command, input.filesOwned)) return false;
    const key = check.command;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verificationCommandsFromSpec(spec: EngineeringSpec): ExecutableCheck[] {
  return spec.verificationTooling.map((tool, index) => ({
    id: `verification-tool-${index + 1}`,
    command: tool.command,
    expectedExitCodes: tool.expectedExitCodes,
    kind: 'custom',
  }));
}

function textMentionsAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => textContainsBoundaryToken(text, token));
}

function relevanceTokensForWp(input: {
  wp: WorkPackage;
  filesOwned: string[];
  interfaceContracts: EngineeringSpec['interfaceContracts'];
}): string[] {
  const tokens = new Set<string>([input.wp.id]);
  for (const file of input.filesOwned) {
    for (const token of commandReferenceTokensForPath(file)) tokens.add(token);
  }
  for (const contract of input.interfaceContracts) {
    tokens.add(contract.name);
    for (const requiredExport of contract.requiredExports ?? []) {
      tokens.add(requiredExport.name);
    }
  }
  return [...tokens].filter((token) => token.length >= 3);
}

function sourcePath(source: string): string {
  return source.replace(/:\d+$|:[A-Za-z_][\w-]*$/, '');
}

function acceptanceContractFromSpec(
  spec: EngineeringSpec,
  pipelineRunId: string,
  tokens: string[],
  filesOwned: string[],
): AcceptanceContract {
  return {
    source: 'engineering-spec',
    runId: pipelineRunId,
    criteria: spec.acceptanceCriteria
      .filter((ac) => {
        if (ac.crossCutting === true) return true;
        if (
          (ac.executableChecks ?? []).some((check) =>
            commandMentionsWpFile(check.command, filesOwned),
          )
        ) {
          return true;
        }
        return textMentionsAnyToken([ac.id, ac.statement, ac.journeyRef ?? ''].join('\n'), tokens);
      })
      .map((ac, index) => ({
        id: ac.id ?? `AC-${index + 1}`,
        statement: ac.statement,
        ...(ac.executableChecks != null && ac.executableChecks.length > 0
          ? { executableChecks: ac.executableChecks }
          : {}),
        ...(ac.journeyRef != null ? { journeyRef: ac.journeyRef } : {}),
        ...(ac.stepIdx != null ? { stepIdx: ac.stepIdx } : {}),
        ...(ac.crossCutting != null ? { crossCutting: ac.crossCutting } : {}),
        sourceRef: 'engineering_specs.spec.acceptanceCriteria',
      })),
  };
}

export function buildImplementWpContextFromSpec(input: {
  spec: EngineeringSpec;
  wp: WorkPackage;
  pipelineRunId: string;
}): ImplementWpSpecHandoff {
  const wpById = new Map(input.spec.workPackages.map((wp) => [wp.id, wp]));
  const dependencyWps = input.wp.dependsOn.flatMap((wpId) => {
    const wp = wpById.get(wpId);
    return wp == null ? [] : [wp];
  });
  const currentFilesOwned = input.wp.filesOwned.map(fileOwnedPath);
  const dependencyFilesOwned = dependencyWps.flatMap((wp) => wp.filesOwned.map(fileOwnedPath));
  const contractFilesOwned = [...currentFilesOwned, ...dependencyFilesOwned];
  const interfaceContracts = input.spec.interfaceContracts.filter((contract) => {
    if (contractFilesOwned.some((path) => pathsMatch(contract.file, path))) return true;
    return (contract.requiredExports ?? []).some(
      (requiredExport) =>
        requiredExport.file != null &&
        contractFilesOwned.some((path) => pathsMatch(requiredExport.file as string, path)),
    );
  });
  const tokens = relevanceTokensForWp({
    wp: input.wp,
    filesOwned: currentFilesOwned,
    interfaceContracts,
  });
  const acceptanceContract = acceptanceContractFromSpec(
    input.spec,
    input.pipelineRunId,
    tokens,
    currentFilesOwned,
  );
  const verificationCommands = wpRelevantExecutableChecks({
    acceptanceContract,
    verificationCommands: verificationCommandsFromSpec(input.spec),
    filesOwned: currentFilesOwned,
  });
  return {
    specContext: {
      objective: input.spec.objective,
      architecture: input.spec.architecture,
      functionalRequirements: input.spec.functionalRequirements.filter((requirement) =>
        textMentionsAnyToken([requirement.id, requirement.statement].join('\n'), tokens),
      ),
      interfaceContracts,
      constraints: input.spec.constraints.filter((constraint) =>
        contractFilesOwned.some((path) => pathsMatch(sourcePath(constraint.source), path)),
      ),
      dependencyWpIds: dependencyWps.map((wp) => wp.id),
      dependencyFilesOwned,
    },
    acceptanceContract,
    verificationCommands,
  };
}
