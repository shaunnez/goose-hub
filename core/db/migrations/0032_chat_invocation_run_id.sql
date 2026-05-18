-- Adds run_id to chat_tool_invocations so chat-driven invoke_skill runs
-- can be linked back to the spawned agent run.
ALTER TABLE `chat_tool_invocations` ADD COLUMN `run_id` text;
