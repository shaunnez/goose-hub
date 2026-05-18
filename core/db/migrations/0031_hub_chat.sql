CREATE TABLE `chat_conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `project_id` text,
  `work_item_id` text,
  `title` text NOT NULL DEFAULT '',
  `runtime` text NOT NULL DEFAULT 'claude',
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX `chat_conversations_scope_idx` ON `chat_conversations` (`scope`, `project_id`, `work_item_id`);
--> statement-breakpoint
CREATE INDEX `chat_conversations_updated_idx` ON `chat_conversations` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `run_id` text,
  `meta_json` text,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_idx` ON `chat_messages` (`conversation_id`, `id`);
--> statement-breakpoint
CREATE TABLE `chat_tool_invocations` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `message_id` integer,
  `tool_name` text NOT NULL,
  `input_json` text NOT NULL,
  `mutating` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL,
  `result_json` text,
  `error_message` text,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX `chat_tool_invocations_conversation_idx` ON `chat_tool_invocations` (`conversation_id`, `id`);
--> statement-breakpoint
CREATE INDEX `chat_tool_invocations_status_idx` ON `chat_tool_invocations` (`status`);
