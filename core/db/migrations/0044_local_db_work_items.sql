CREATE TABLE `work_items` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `external_id` text NOT NULL,
  `title` text NOT NULL,
  `body` text DEFAULT '' NOT NULL,
  `state` text NOT NULL,
  `type` text NOT NULL,
  `priority` text NOT NULL,
  `mode` text NOT NULL,
  `schedule` text NOT NULL,
  `exec` text NOT NULL,
  `parent_id` text,
  `author_is_owner` integer DEFAULT true NOT NULL,
  `milestone_id` text,
  `milestone_title` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
  `closed_at` text
);
--> statement-breakpoint
CREATE INDEX `work_items_project_state_idx` ON `work_items` (`project_id`,`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_items_project_external_id_uniq` ON `work_items` (`project_id`,`external_id`);
--> statement-breakpoint
CREATE INDEX `work_items_project_schedule_idx` ON `work_items` (`project_id`,`schedule`);
--> statement-breakpoint
CREATE INDEX `work_items_project_milestone_idx` ON `work_items` (`project_id`,`milestone_id`);
--> statement-breakpoint
CREATE TABLE `work_item_milestones` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `number` integer NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `due_on` text,
  `state` text DEFAULT 'open' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_milestones_project_number_uniq` ON `work_item_milestones` (`project_id`,`number`);
--> statement-breakpoint
CREATE INDEX `work_item_milestones_project_state_idx` ON `work_item_milestones` (`project_id`,`state`);
--> statement-breakpoint
CREATE TABLE `work_item_labels` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `label` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_labels_work_item_label_uniq` ON `work_item_labels` (`work_item_id`,`label`);
--> statement-breakpoint
CREATE INDEX `work_item_labels_project_label_idx` ON `work_item_labels` (`project_id`,`label`);
--> statement-breakpoint
CREATE TABLE `work_item_repo_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `repo_ref` text NOT NULL,
  `role` text DEFAULT 'unknown' NOT NULL,
  `confidence` real,
  `source` text DEFAULT 'manual' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_repo_links_work_item_repo_role_uniq` ON `work_item_repo_links` (`work_item_id`,`repo_ref`,`role`);
--> statement-breakpoint
CREATE INDEX `work_item_repo_links_project_work_item_idx` ON `work_item_repo_links` (`project_id`,`work_item_id`);
--> statement-breakpoint
CREATE TABLE `work_item_external_refs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `provider` text NOT NULL,
  `kind` text NOT NULL,
  `repo_ref` text,
  `external_id` text NOT NULL,
  `url` text,
  `metadata_json` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_item_external_refs_project_external_ref_idx` ON `work_item_external_refs` (`project_id`,`provider`,`kind`,`repo_ref`,`external_id`);
--> statement-breakpoint
CREATE INDEX `work_item_external_refs_work_item_kind_idx` ON `work_item_external_refs` (`work_item_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `work_item_comments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `body` text NOT NULL,
  `author_login` text DEFAULT 'goose-hub' NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_item_comments_work_item_idx` ON `work_item_comments` (`work_item_id`,`id`);
--> statement-breakpoint
CREATE INDEX `work_item_comments_project_work_item_idx` ON `work_item_comments` (`project_id`,`work_item_id`);
--> statement-breakpoint
CREATE TABLE `work_item_state_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `from_state` text,
  `to_state` text NOT NULL,
  `mode` text NOT NULL,
  `note` text,
  `actor` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_item_state_events_work_item_idx` ON `work_item_state_events` (`work_item_id`,`id`);
--> statement-breakpoint
CREATE INDEX `work_item_state_events_project_work_item_idx` ON `work_item_state_events` (`project_id`,`work_item_id`,`id`);
