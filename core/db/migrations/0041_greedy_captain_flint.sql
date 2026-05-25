ALTER TABLE `agent_run_costs` ADD `cached_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_run_costs` ADD `reasoning_output_tokens` integer DEFAULT 0 NOT NULL;