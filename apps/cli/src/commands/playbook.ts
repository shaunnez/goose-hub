import { exportPlaybook } from '@goose-hub/core/learning/playbook-export.js';
import { importPlaybook } from '@goose-hub/core/learning/playbook-import.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export async function playbookCommand(subArgs: string[]): Promise<void> {
  const [sub = '', slug = '', ...rest] = subArgs;
  const jsonMode = rest.includes('--json');

  if (sub === 'export') {
    if (!slug) {
      console.error('Usage: goose playbook export <project-slug> [--json]');
      process.exit(1);
    }
    const projects = await loadProjects(targetProjectsRoot);
    const config = projects.find((p) => p.slug === slug);
    if (!config) {
      console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
      process.exit(1);
    }
    const manifest = exportPlaybook(config.id, config.name);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(manifest));
    } else {
      process.stdout.write(JSON.stringify(manifest, null, 2));
    }
    process.exit(0);
  }

  if (sub === 'import') {
    if (!slug) {
      console.error('Usage: goose playbook import <project-slug> [--json]');
      process.exit(1);
    }
    const projects = await loadProjects(targetProjectsRoot);
    const config = projects.find((p) => p.slug === slug);
    if (!config) {
      console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
      process.exit(1);
    }
    // Read manifest from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      console.error('Invalid JSON on stdin');
      process.exit(1);
    }
    const result = importPlaybook(config.id, manifest);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(result));
    } else {
      if (result.ok) {
        console.log(
          `Imported ${result.decisionPatternsImported} decision patterns, ${result.gateThresholdsImported} gate thresholds.`,
        );
      } else {
        console.error(`Import failed: ${result.reason}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error('Usage: goose playbook export|import <project-slug> [--json]');
  process.exit(1);
}
