import { Hono } from 'hono';
import {
  approveCandidate,
  getPersonaCandidates,
  getPersonaNames,
  getPersonaRuns,
  getQualityTrend,
  listPersonas,
  rejectCandidate,
} from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const result = await listPersonas();
  return result.ok ? c.json(result.data) : c.json({ personas: [] });
});

router.get('/names', async (c) => {
  const result = await getPersonaNames();
  return result.ok ? c.json(result.data) : c.json({ names: [] });
});

router.get('/runs', async (c) => {
  const persona = c.req.query('persona') ?? '';
  const result = await getPersonaRuns(persona);
  return result.ok ? c.json(result.data) : c.json({ runs: [] });
});

router.get('/quality-trend', async (c) => {
  const project = c.req.query('project') ?? '';
  const raw = Number(c.req.query('limit') ?? '50');
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 200) : 50;
  const result = await getQualityTrend(project, limit);
  return result.ok ? c.json(result.data) : c.json({ trend: [] });
});

router.get('/candidates', async (c) => {
  const persona = c.req.query('persona') ?? '';
  const result = await getPersonaCandidates(persona);
  return result.ok ? c.json(result.data) : c.json({ candidates: [] });
});

router.post('/candidates/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const result = await approveCandidate(id);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/candidates/:id/reject', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const result = await rejectCandidate(id);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as rosterRouter };
