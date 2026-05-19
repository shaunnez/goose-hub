import { formatPathDriftReport, loadPathDriftReport } from '../core/agent-runtime/path-drift-report.js';

const [, , projectIdArg, limitArg] = process.argv;
const limit = limitArg != null ? Number.parseInt(limitArg, 10) : undefined;

const report = loadPathDriftReport({
  ...(projectIdArg != null && projectIdArg.length > 0 ? { projectId: projectIdArg } : {}),
  ...(Number.isFinite(limit) ? { limit } : {}),
});

process.stdout.write(formatPathDriftReport(report));
