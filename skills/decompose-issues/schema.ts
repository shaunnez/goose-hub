import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const DecomposedIssueSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  dependsOn: z.array(z.number().int().min(0)),
});

export const DecomposeOutputSchema = z
  .object({
    issues: z.array(DecomposedIssueSchema),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine((data, ctx) => {
    for (let i = 0; i < data.issues.length; i++) {
      for (const n of data.issues[i].dependsOn) {
        if (n >= i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `issues[${i}].dependsOn contains ${n} which is >= its own index ${i} (forward reference not allowed)`,
            path: ['issues', i, 'dependsOn'],
          });
        }
      }
    }
  });

export type DecomposeOutput = z.infer<typeof DecomposeOutputSchema>;
