import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

// Enforce at the database level that a direct conversation between a given pair
// of users is unique (A+B == B+A). Previously the code did a SELECT-then-INSERT
// which races under concurrency and can create duplicate direct conversations.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.conversations ADD COLUMN direct_pair_key varchar(73) NULL;

    UPDATE app.conversations c
    SET direct_pair_key = sub.key
    FROM (
      SELECT p.conversation_id,
             string_agg(p.user_id::text, ':' ORDER BY p.user_id::text) AS key
      FROM app.conversation_participants p
      JOIN app.conversations cc ON cc.id = p.conversation_id
      WHERE cc.conversation_type = 'direct'
      GROUP BY p.conversation_id
      HAVING count(DISTINCT p.user_id) = 2
    ) sub
    WHERE c.id = sub.conversation_id;

    CREATE UNIQUE INDEX app_idx_conversations_direct_pair
      ON app.conversations (direct_pair_key);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS app.app_idx_conversations_direct_pair;
    ALTER TABLE app.conversations DROP COLUMN IF EXISTS direct_pair_key;
  `);
}
