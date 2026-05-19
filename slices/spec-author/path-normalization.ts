import {
  type RepoRelativePathNormalization,
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '@goose-hub/core/workspaces/path-normalization.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';

export type SpecPathNormalizationField = {
  field: string;
  from: string;
  to: string;
  source: RepoRelativePathNormalization['source'];
  ambiguous?: string[];
};

export function normalizeEngineeringSpecPaths(input: {
  spec: EngineeringSpec;
  worktreePath: string;
  referencePaths?: string[];
}): {
  spec: EngineeringSpec;
  fields: SpecPathNormalizationField[];
  ambiguousFields: SpecPathNormalizationField[];
} {
  const packageRoots = discoverPackageRoots(input.worktreePath);
  const fields: SpecPathNormalizationField[] = [];
  const referencePaths = [
    ...input.spec.workPackages.flatMap((wp) => wp.filesOwned),
    ...input.spec.interfaceContracts.map((contract) => contract.file),
    ...input.spec.verificationTooling.map((tool) => tool.scriptPath),
    ...input.spec.schemaChanges.migrations,
    ...(input.referencePaths ?? []),
  ];

  const normalizeField = (field: string, rawPath: string): string => {
    const result = normalizeRepoRelativePath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths,
    });
    if (result.path !== rawPath || result.ambiguous != null) {
      fields.push({
        field,
        from: rawPath,
        to: result.path,
        source: result.source,
        ...(result.ambiguous != null && { ambiguous: result.ambiguous }),
      });
    }
    return result.path;
  };

  const spec: EngineeringSpec = {
    ...input.spec,
    schemaChanges: {
      ...input.spec.schemaChanges,
      migrations: input.spec.schemaChanges.migrations.map((path, index) =>
        normalizeField(`schemaChanges.migrations[${index}]`, path),
      ),
    },
    interfaceContracts: input.spec.interfaceContracts.map((contract, index) => ({
      ...contract,
      file: normalizeField(`interfaceContracts[${index}].file`, contract.file),
    })),
    workPackages: input.spec.workPackages.map((wp, wpIndex) => ({
      ...wp,
      filesOwned: wp.filesOwned.map((path, pathIndex) =>
        normalizeField(`workPackages[${wpIndex}].filesOwned[${pathIndex}]`, path),
      ),
    })),
    verificationTooling: input.spec.verificationTooling.map((tool, index) => ({
      ...tool,
      scriptPath: normalizeField(`verificationTooling[${index}].scriptPath`, tool.scriptPath),
    })),
  };

  return {
    spec,
    fields,
    ambiguousFields: fields.filter(
      (field) => field.source === 'unresolved' && field.ambiguous != null,
    ),
  };
}
