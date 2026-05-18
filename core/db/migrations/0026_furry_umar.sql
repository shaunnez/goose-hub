CREATE TABLE `agent_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_key` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_artifacts_artifact_key_uniq` ON `agent_artifacts` (`artifact_key`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_project_work_item_idx` ON `agent_artifacts` (`project_id`,`work_item_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_id_idx` ON `agent_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_project_work_item_run_kind_idx` ON `agent_artifacts` (`project_id`,`work_item_id`,`run_id`,`kind`);