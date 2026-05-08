CREATE TABLE `run_quality_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`iteration` integer DEFAULT 0 NOT NULL,
	`score` real NOT NULL,
	`components_json` text NOT NULL,
	`audit_score` real,
	`ts` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_quality_scores_run_iteration_uniq` ON `run_quality_scores` (`run_id`,`iteration`);
--> statement-breakpoint
CREATE INDEX `run_quality_scores_project_ts_idx` ON `run_quality_scores` (`project_id`,`ts`);
