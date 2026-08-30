import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_type varchar(20) NOT NULL DEFAULT 'direct',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.conversation_participants (
      conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      last_read_message_id uuid NULL,
      last_read_at timestamptz NULL,
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE INDEX app_idx_conv_part_user ON app.conversation_participants (user_id);

    CREATE TABLE app.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
      sender_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      content_type varchar(20) NOT NULL DEFAULT 'text',
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX app_idx_messages_conv ON app.messages (conversation_id, created_at, id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.messages;
    DROP TABLE IF EXISTS app.conversation_participants;
    DROP TABLE IF EXISTS app.conversations;
  `);
}
