import type { DatabaseConnection } from '@ikimetr/database';

import { NotFoundError, ValidationError } from '../errors.js';
import type { JobEnqueue } from '../app.js';
import {
  MESSAGES_MAX_PAGE_SIZE,
  type ConversationQuery,
  type MessageQuery,
  type SendMessageInput,
} from './schema.js';

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderUserId: string;
  content: string;
  contentType: string;
  createdAt: Date;
}

export interface ConversationRecord {
  id: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  participantIds: string[];
  lastMessage: MessageRecord | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function createConversation(
  db: DatabaseConnection,
  currentUserId: string,
  withUserId: string,
): Promise<ConversationRecord> {
  if (withUserId === currentUserId) {
    throw new ValidationError('cannot start a conversation with yourself');
  }

  const target = await db.transaction((tx) =>
    tx.query<{ id: string }>('SELECT id FROM app.users WHERE id = $1', [
      withUserId,
    ]),
  );
  if (target.rowCount === null || target.rowCount === 0) {
    throw new NotFoundError('target user not found');
  }

  const existing = await db.transaction((tx) =>
    tx.query<{ id: string }>(
      `SELECT c.id FROM app.conversations c
       JOIN app.conversation_participants p1 ON p1.conversation_id = c.id
       JOIN app.conversation_participants p2 ON p2.conversation_id = c.id
       WHERE c.conversation_type = 'direct'
         AND p1.user_id = $1 AND p2.user_id = $2
       LIMIT 1`,
      [currentUserId, withUserId],
    ),
  );
  if (existing.rowCount !== null && existing.rowCount > 0) {
    return getConversation(db, existing.rows[0]!.id, currentUserId);
  }

  const created = await db.transaction(async (tx) => {
    const inserted = await tx.query<ConversationInsertRow>(
      `INSERT INTO app.conversations (conversation_type)
       VALUES ('direct')
       RETURNING id, conversation_type, created_at, updated_at`,
      [],
    );
    const conversation = inserted.rows[0];
    if (!conversation) {
      throw new Error('conversation insert failed');
    }
    await tx.query(
      `INSERT INTO app.conversation_participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [conversation.id, currentUserId, withUserId],
    );
    return conversation;
  });

  return {
    id: created.id,
    type: created.conversation_type,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
    participantIds: [currentUserId, withUserId],
    lastMessage: null,
  };
}

export async function requireParticipant(
  db: DatabaseConnection,
  conversationId: string,
  userId: string,
): Promise<void> {
  const result = await db.transaction((tx) =>
    tx.query(
      `SELECT 1 FROM app.conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    ),
  );
  if (result.rowCount === null || result.rowCount === 0) {
    throw new NotFoundError('conversation not found');
  }
}

export async function getConversation(
  db: DatabaseConnection,
  conversationId: string,
  userId: string,
): Promise<ConversationRecord> {
  await requireParticipant(db, conversationId, userId);
  const result = await db.transaction((tx) =>
    tx.query<ConversationRow>(
      `SELECT c.id, c.conversation_type, c.created_at, c.updated_at,
              coalesce(array_agg(p.user_id) FILTER (WHERE p.user_id IS NOT NULL), ARRAY[]::uuid[]) AS participant_ids,
              (SELECT row_to_json(m) FROM (
                 SELECT id, conversation_id, sender_user_id, content_type, content, created_at
                 FROM app.messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) m
              ) AS last_message
       FROM app.conversations c
       LEFT JOIN app.conversation_participants p ON p.conversation_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [conversationId],
    ),
  );
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError('conversation not found');
  }
  return toConversation(row);
}

export async function listConversations(
  db: DatabaseConnection,
  userId: string,
  query: ConversationQuery,
): Promise<Page<ConversationRecord>> {
  const limit = Math.min(query.limit, MESSAGES_MAX_PAGE_SIZE);
  const cursorCreatedAt = query.cursor
    ? await getConversationUpdatedAt(db, query.cursor)
    : null;

  const result = await db.transaction((tx) =>
    tx.query<ConversationRow>(
      `SELECT c.id, c.conversation_type, c.created_at, c.updated_at,
              coalesce(array_agg(p.user_id) FILTER (WHERE p.user_id IS NOT NULL), ARRAY[]::uuid[]) AS participant_ids,
              (SELECT row_to_json(m) FROM (
                 SELECT id, conversation_id, sender_user_id, content_type, content, created_at
                 FROM app.messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1) m
              ) AS last_message
       FROM app.conversations c
       JOIN app.conversation_participants me ON me.conversation_id = c.id AND me.user_id = $1
       LEFT JOIN app.conversation_participants p ON p.conversation_id = c.id
       WHERE ($2::uuid IS NULL OR (c.updated_at, c.id) < ($3::timestamptz, $2::uuid))
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $4`,
      [userId, query.cursor ?? null, cursorCreatedAt, limit + 1],
    ),
  );

  return pageFrom(
    result.rows.slice(0, limit).map((row) => toConversation(row)),
    limit,
    (c) => c.id,
  );
}

export async function listMessages(
  db: DatabaseConnection,
  conversationId: string,
  userId: string,
  query: MessageQuery,
): Promise<Page<MessageRecord>> {
  await requireParticipant(db, conversationId, userId);
  const limit = Math.min(query.limit, MESSAGES_MAX_PAGE_SIZE);
  const cursorCreatedAt = query.cursor
    ? await getMessageCreatedAt(db, query.cursor)
    : null;

  const result = await db.transaction((tx) =>
    tx.query<MessageRow>(
      `SELECT id, conversation_id, sender_user_id, content_type, content, created_at
       FROM app.messages
       WHERE conversation_id = $1
         AND ($2::uuid IS NULL OR (created_at, id) < ($3::timestamptz, $2::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [conversationId, query.cursor ?? null, cursorCreatedAt, limit + 1],
    ),
  );

  return pageFrom(
    result.rows.slice(0, limit).map((row) => toMessage(row)),
    limit,
    (m) => m.id,
  );
}

export async function sendMessage(
  db: DatabaseConnection,
  conversationId: string,
  senderUserId: string,
  input: SendMessageInput,
  enqueueJob: JobEnqueue,
): Promise<MessageRecord> {
  await requireParticipant(db, conversationId, senderUserId);

  const inserted = await db.transaction(async (tx) => {
    const message = await tx.query<MessageRow>(
      `INSERT INTO app.messages (conversation_id, sender_user_id, content_type, content)
       VALUES ($1, $2, 'text', $3)
       RETURNING id, conversation_id, sender_user_id, content_type, content, created_at`,
      [conversationId, senderUserId, input.content],
    );
    await tx.query(
      'UPDATE app.conversations SET updated_at = now() WHERE id = $1',
      [conversationId],
    );
    const row = message.rows[0];
    if (!row) {
      throw new Error('message insert failed');
    }
    return row;
  });

  const others = await db.transaction((tx) =>
    tx.query<{ user_id: string }>(
      `SELECT user_id FROM app.conversation_participants
       WHERE conversation_id = $1 AND user_id <> $2`,
      [conversationId, senderUserId],
    ),
  );

  for (const other of others.rows) {
    await enqueueJob(
      'notification.deliver',
      {
        userId: other.user_id,
        type: 'new_message',
        referenceType: 'conversation',
        referenceId: conversationId,
        title: 'New message',
        body: input.content,
      },
      `new_message:${inserted.id}:${other.user_id}`,
    );
  }

  return toMessage(inserted);
}

export async function markConversationRead(
  db: DatabaseConnection,
  conversationId: string,
  userId: string,
): Promise<{ readAt: Date }> {
  await requireParticipant(db, conversationId, userId);
  const result = await db.transaction((tx) =>
    tx.query<{ id: string }>(
      `SELECT id FROM app.messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversationId],
    ),
  );
  const lastMessageId =
    result.rowCount !== null && result.rowCount > 0 ? result.rows[0]!.id : null;
  await db.transaction((tx) =>
    tx.query(
      `INSERT INTO app.conversation_participants (conversation_id, user_id, last_read_message_id, last_read_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET last_read_message_id = $3, last_read_at = now()`,
      [conversationId, userId, lastMessageId],
    ),
  );
  return { readAt: new Date() };
}

interface ConversationInsertRow {
  id: string;
  conversation_type: string;
  created_at: Date;
  updated_at: Date;
}

interface ConversationRow {
  id: string;
  conversation_type: string;
  created_at: Date;
  updated_at: Date;
  participant_ids: string[];
  last_message: MessageRow | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  content_type: string;
  content: string;
  created_at: Date;
}

function toConversation(row: unknown): ConversationRecord {
  const r = row as ConversationRow;
  return {
    id: r.id,
    type: r.conversation_type,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    participantIds: r.participant_ids,
    lastMessage: r.last_message ? toMessage(r.last_message) : null,
  };
}

function toMessage(row: unknown): MessageRecord {
  const r = row as MessageRow;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderUserId: r.sender_user_id,
    content: r.content,
    contentType: r.content_type,
    createdAt: r.created_at,
  };
}

async function getConversationUpdatedAt(
  db: DatabaseConnection,
  id: string,
): Promise<Date | null> {
  const result = await db.transaction((tx) =>
    tx.query<{ updated_at: Date }>(
      'SELECT updated_at FROM app.conversations WHERE id = $1',
      [id],
    ),
  );
  return result.rowCount !== null && result.rowCount > 0
    ? result.rows[0]!.updated_at
    : null;
}

async function getMessageCreatedAt(
  db: DatabaseConnection,
  id: string,
): Promise<Date | null> {
  const result = await db.transaction((tx) =>
    tx.query<{ created_at: Date }>(
      'SELECT created_at FROM app.messages WHERE id = $1',
      [id],
    ),
  );
  return result.rowCount !== null && result.rowCount > 0
    ? result.rows[0]!.created_at
    : null;
}

function pageFrom<T>(
  items: T[],
  limit: number,
  cursorOf: (item: T) => string,
): Page<T> {
  const hasMore = items.length === limit;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? cursorOf(last) : null,
  };
}
