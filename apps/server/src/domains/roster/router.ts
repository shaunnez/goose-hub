import { Hono } from 'hono';
import { getPersonaCandidates, getPersonaRuns, listPersonas } from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const result = await listPersonas();
  return result.ok ? c.json(result.data) : c.json({ personas: [] });
});

router.get('/runs', async (c) => {
  const persona = c.req.query('persona') ?? '';
  const result = await getPersonaRuns(persona);
  return result.ok ? c.json(result.data) : c.json({ runs: [] });
});

router.get('/candidates', async (c) => {
  const persona = c.req.query('persona') ?? '';
  const result = await getPersonaCandidates(persona);
  return result.ok ? c.json(result.data) : c.json({ candidates: [] });
});

export { router as rosterRouter };
