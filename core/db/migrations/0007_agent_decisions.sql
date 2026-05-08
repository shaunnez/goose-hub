CREATE TABLE `agent_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`iteration` integer DEFAULT 0 NOT NULL,
	`phase` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`what` text NOT NULL,
	`why` text NOT NULL,
	`ts` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_decisions_run_kind_what_uniq` ON `agent_decisions` (`run_id`,`kind`,`what`);--> statement-breakpoint
CREATE INDEX `agent_decisions_run_idx` ON `agent_decisions` (`run_id`);
