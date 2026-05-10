CREATE TABLE `scout_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`investigation_run_id` text NOT NULL,
	`scout_skill` text NOT NULL,
	`report` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_reports_project_work_item_run_skill_uniq` ON `scout_reports` (`project_id`,`work_item_id`,`investigation_run_id`,`scout_skill`);--> statement-breakpoint
CREATE INDEX `scout_reports_project_work_item_run_idx` ON `scout_reports` (`project_id`,`work_item_id`,`investigation_run_id`);