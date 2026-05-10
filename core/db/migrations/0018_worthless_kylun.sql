CREATE TABLE `engineering_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`pipeline_run_id` text NOT NULL,
	`spec` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_specs_project_work_item_uniq` ON `engineering_specs` (`project_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `engineering_specs_project_work_item_idx` ON `engineering_specs` (`project_id`,`work_item_id`);