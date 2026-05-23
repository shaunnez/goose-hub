export interface PrDiffHunkContext {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading?: string;
}

export interface PrDiffWithContext {
  changedFiles: string[];
  hunkCount: number;
  hunks: PrDiffHunkContext[];
  diffCharCount: number;
}

export function buildPrDiffWithContext(
  prDiff: string,
  options: { maxHunks?: number } = {},
): PrDiffWithContext {
  const maxHunks = options.maxHunks ?? 120;
  const changedFiles: string[] = [];
  const hunks: PrDiffHunkContext[] = [];
  const seenFiles = new Set<string>();
  let currentFile: string | undefined;

  for (const line of prDiff.split('\n')) {
    const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (fileMatch != null) {
      currentFile = fileMatch[1];
      if (!seenFiles.has(currentFile)) {
        seenFiles.add(currentFile);
        changedFiles.push(currentFile);
      }
      continue;
    }
    if (currentFile == null || hunks.length >= maxHunks) continue;
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s?(.*)$/.exec(line);
    if (hunkMatch == null) continue;
    hunks.push({
      file: currentFile,
      oldStart: Number(hunkMatch[1]),
      oldLines: Number(hunkMatch[2] ?? 1),
      newStart: Number(hunkMatch[3]),
      newLines: Number(hunkMatch[4] ?? 1),
      ...(hunkMatch[5].trim().length > 0 ? { heading: hunkMatch[5].trim() } : {}),
    });
  }

  return {
    changedFiles,
    hunkCount: hunks.length,
    hunks,
    diffCharCount: prDiff.length,
  };
}
