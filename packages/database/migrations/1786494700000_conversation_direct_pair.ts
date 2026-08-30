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

    -- Detect historical duplicate direct pairs BEFORE creating the unique
    -- index. Aborting here rolls back the whole migration (the column add
    -- included) so no partial/destructive state is left behind. Manual
    -- reconciliation (merge or delete the duplicate conversations) is required
    -- before this migration can be applied on an existing database.
    DO $$
    DECLARE
      v_duplicate_pairs int;
      v_sample text;
    BEGIN
      SELECT count(*) INTO v_duplicate_pairs FROM (
        SELECT direct_pair_key
        FROM app.conversations
        WHERE direct_pair_key IS NOT NULL
        GROUP BY direct_pair_key
        HAVING count(*) > 1
      ) d;

      IF v_duplicate_pairs > 0 THEN
        SELECT string_agg(direct_pair_key, ', ' ORDER BY direct_pair_key)
        INTO v_sample FROM (
          SELECT direct_pair_key
          FROM app.conversations
          WHERE direct_pair_key IS NOT NULL
          GROUP BY direct_pair_key
          HAVING count(*) > 1
          LIMIT 5
        ) s;

        RAISE EXCEPTION 'MIGRATION ABORTED: found % duplicate direct conversation pair(s); sample keys: %. Manual reconciliation required: merge or delete the duplicate direct conversations (same two participants) before applying this migration, then re-run.', v_duplicate_pairs, v_sample;
      END IF;
    END $$;

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
