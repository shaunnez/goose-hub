import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eventsRouter } from './domains/events/router.js';
import { inboxRouter } from './domains/inbox/router.js';
import { issuesRouter } from './domains/issues/router.js';
import { milestonesRouter } from './domains/milestones/router.js';
import { projectsRouter } from './domains/projects/router.js';
import { webhooksRouter } from './domains/webhooks/router.js';
import { workflowsRouter } from './domains/workflows/router.js';

const app = new Hono();
app.use('*', cors());

app.route('/', projectsRouter);            // GET /health, GET /projects
app.route('/projects', milestonesRouter);  // GET/POST /projects/:slug/milestones/**, /active-milestone
app.route('/projects', issuesRouter);      // GET/POST /projects/:slug/issues/**
app.route('/projects', workflowsRouter);   // POST /projects/:slug/tick
app.route('/inbox', inboxRouter);          // GET/POST /inbox/**
app.route('/events', eventsRouter);        // GET /events
app.route('/webhooks', webhooksRouter);    // POST /webhooks/github

export { app };
