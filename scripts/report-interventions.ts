import {
  formatInterventionAuditReport,
  loadInterventionAuditReport,
} from '../core/interventions/audit.js';

const [, , projectIdArg, limitArg] = process.argv;
const limit = limitArg != null ? Number.parseInt(limitArg, 10) : undefined;

const report = loadInterventionAuditReport({
  ...(projectIdArg != null && projectIdArg.length > 0 ? { projectId: projectIdArg } : {}),
  ...(Number.isFinite(limit) ? { limit } : {}),
});

process.stdout.write(formatInterventionAuditReport(report));
