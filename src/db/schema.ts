import { index, integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const chats = sqliteTable('chats', {
  jid: text('jid').primaryKey(),
  name: text('name'),
  last_message_time: text('last_message_time'),
  channel: text('channel'),
  is_group: integer('is_group').default(0),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').notNull(),
    chat_jid: text('chat_jid')
      .notNull()
      .references(() => chats.jid),
    sender: text('sender'),
    sender_name: text('sender_name'),
    content: text('content'),
    timestamp: text('timestamp'),
    is_from_me: integer('is_from_me'),
    is_bot_message: integer('is_bot_message').default(0),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.chat_jid] }),
    index('idx_timestamp').on(table.timestamp),
  ],
);

export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: text('id').primaryKey(),
    group_folder: text('group_folder').notNull(),
    chat_jid: text('chat_jid').notNull(),
    prompt: text('prompt').notNull(),
    schedule_type: text('schedule_type').notNull(),
    schedule_value: text('schedule_value').notNull(),
    context_mode: text('context_mode').default('isolated'),
    next_run: text('next_run'),
    last_run: text('last_run'),
    last_result: text('last_result'),
    status: text('status').default('active'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_next_run').on(table.next_run),
    index('idx_status').on(table.status),
  ],
);

export const taskRunLogs = sqliteTable(
  'task_run_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    task_id: text('task_id')
      .notNull()
      .references(() => scheduledTasks.id),
    run_at: text('run_at').notNull(),
    duration_ms: integer('duration_ms').notNull(),
    status: text('status').notNull(),
    result: text('result'),
    error: text('error'),
  },
  (table) => [index('idx_task_run_logs').on(table.task_id, table.run_at)],
);

export const routerState = sqliteTable('router_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const sessions = sqliteTable('sessions', {
  group_folder: text('group_folder').primaryKey(),
  session_id: text('session_id').notNull(),
});

export const registeredGroups = sqliteTable('registered_groups', {
  jid: text('jid').primaryKey(),
  name: text('name').notNull(),
  folder: text('folder').notNull().unique(),
  trigger_pattern: text('trigger_pattern').notNull(),
  added_at: text('added_at').notNull(),
  container_config: text('container_config'),
  requires_trigger: integer('requires_trigger').default(1),
});

export const swarmAgents = sqliteTable(
  'swarm_agents',
  {
    id: text('id').primaryKey(),
    role: text('role').notNull(),
    model: text('model').notNull(),
    fallback_model: text('fallback_model'),
    status: text('status').default('idle'),
    current_task_id: text('current_task_id'),
    last_heartbeat: text('last_heartbeat'),
    total_tasks: integer('total_tasks').default(0),
    success_count: integer('success_count').default(0),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_swarm_agents_status').on(table.status)],
);

export const swarmTasks = sqliteTable(
  'swarm_tasks',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    priority: integer('priority').default(0),
    prompt: text('prompt').notNull(),
    context: text('context'),
    from_agent: text('from_agent').notNull(),
    to_agent: text('to_agent'),
    parent_task_id: text('parent_task_id'),
    status: text('status').default('pending'),
    result: text('result'),
    error: text('error'),
    tokens_used: integer('tokens_used'),
    cost: integer('cost'),
    created_at: text('created_at').notNull(),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    timeout_ms: integer('timeout_ms').default(300000),
    retries: integer('retries').default(0),
    max_retries: integer('max_retries').default(3),
    user_id: text('user_id'),
    chat_jid: text('chat_jid'),
  },
  (table) => [
    index('idx_swarm_tasks_status').on(table.status),
    index('idx_swarm_tasks_to_agent').on(table.to_agent, table.status),
    index('idx_swarm_tasks_created').on(table.created_at),
  ],
);

export const swarmMessages = sqliteTable(
  'swarm_messages',
  {
    id: text('id').primaryKey(),
    from_agent: text('from_agent').notNull(),
    to_agent: text('to_agent'),
    type: text('type').notNull(),
    content: text('content').notNull(),
    task_id: text('task_id'),
    read_at: text('read_at'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_swarm_messages_to').on(table.to_agent, table.read_at),
    index('idx_swarm_messages_created').on(table.created_at),
  ],
);

export const swarmMemory = sqliteTable('swarm_memory', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  type: text('type').default('string'),
  updated_by: text('updated_by').notNull(),
  updated_at: text('updated_at').notNull(),
  expires_at: text('expires_at'),
});
