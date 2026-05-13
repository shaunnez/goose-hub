import { runDescriptionLoop } from '@goose-hub/core/learning/description-loop.js';

export async function skillCommand(subArgs: string[]): Promise<void> {
  const [sub = '', skillName = '', ...rest] = subArgs;
  const jsonMode = rest.includes('--json');

  if (sub === 'triggers') {
    if (!skillName) {
      console.error('Usage: goose skill triggers <skill-name> [--json]');
      process.exit(1);
    }
    const result = runDescriptionLoop(skillName);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(result));
    } else {
      if ('error' in result) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      const { tpRate, tnRate, accuracy, failures } = result;
      console.log(`Skill: ${skillName}`);
      console.log(`  TP rate:  ${(tpRate * 100).toFixed(1)}%`);
      console.log(`  TN rate:  ${(tnRate * 100).toFixed(1)}%`);
      console.log(`  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
      if (failures.length > 0) {
        console.log(`\nFailures (${failures.length}):`);
        for (const f of failures) {
          console.log(`  [expected: ${f.expected}, got: ${f.actual}] ${f.prompt}`);
        }
      }
      if (accuracy < 0.8) {
        console.error(`\nAccuracy ${(accuracy * 100).toFixed(1)}% is below the 0.8 threshold.`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error('Usage: goose skill triggers <skill-name> [--json]');
  process.exit(1);
}
