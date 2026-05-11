ALTER TABLE `run_quality_scores` ADD `pipeline_run_id` text;
--> statement-breakpoint
CREATE INDEX `run_quality_scores_pipeline_run_idx` ON `run_quality_scores` (`pipeline_run_id`);
