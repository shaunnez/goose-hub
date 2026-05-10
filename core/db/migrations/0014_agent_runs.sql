CREATE TABLE IF NOT EXISTS `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`work_item_id` text,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`skill` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_runs_run_id_uniq` ON `agent_runs` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_runs_persona_idx` ON `agent_runs` (`persona_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_runs_project_idx` ON `agent_runs` (`project_id`);
