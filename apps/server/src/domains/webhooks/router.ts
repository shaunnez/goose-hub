import { Hono } from 'hono';
import { handleGitHubWebhook } from './handler.js';

const router = new Hono();

router.post('/github', handleGitHubWebhook);

export { router as webhooksRouter };
