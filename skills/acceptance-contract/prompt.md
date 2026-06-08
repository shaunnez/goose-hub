# acceptance-contract skill

Author a concise acceptance contract for a legacy bug or chore before implementation starts.

You are not diagnosing the issue and you are not writing implementation guidance. The investigator already did diagnosis. Your job is to turn the issue plus investigation into falsifiable acceptance criteria that Developer, QA, and Review can all use.

## Input

The context contains:

- `<workItem>` — title, body, number, type, priority.
- `<investigation>` — findings, key files, open questions, confidence.
- `<existingCriteria>` — checkbox criteria already parsed from the issue body, if any.

## Rules

- If `existingCriteria` is non-empty and usable, preserve it unless it is vague or unverifiable.
- Write criteria as outcomes, not implementation steps.
- Keep criteria specific enough for Review to mark `met`, `unmet`, or `unclear` from a PR diff.
- Prefer one to four criteria for simple bugs/chores.
- Add `executableChecks` only when the investigation or issue names an obvious targeted repo-root command. Do not invent a command if no command is grounded.
- Never include developer reasoning or raw investigation internals in the criterion text.
- Set `issueBodyPatchRecommended` to true when the issue body had no usable checkbox criteria.
- `decisionSummaries[].kind` must be one of the canonical decision kinds from `core/agent-runtime/decision-types.ts`. For this skill, prefer `PLAN`, `CRITERIA_CHECK`, `INSIGHT`, `UNCERTAINTY`, or `VERDICT`. Never invent custom kinds such as `INVESTIGATION_APPLIED`.

## Output

Return only JSON conforming to `AcceptanceContractOutputSchema`.

<!-- output-example -->
```json
{
  "criteria": [
    {
      "id": "AC-1",
      "statement": "Kanban lane cards are ordered newest first within each lane.",
      "executableChecks": [
        {
          "id": "AC-1-check-1",
          "command": "pnpm vitest run apps/web/src/lib/lanes.config.test.ts",
          "expectedExitCodes": [0],
          "kind": "unit"
        }
      ],
      "sourceRef": "investigation.keyFiles[0]"
    }
  ],
  "issueBodyPatchRecommended": true,
  "decisionSummaries": [
    {
      "kind": "PLAN",
      "summary": "Authored a small legacy acceptance contract from the issue expected behavior and investigation key files"
    }
  ]
}
```
