import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '@ikimetr/database';

import { ForbiddenError, UnauthenticatedError } from './errors.js';
import { createAuthPreHandler, extractToken } from './guard.js';
import { canEditProperty, type AgencyMembership } from './authz.js';
import type { AuthUser } from './identity/service.js';
import type { PaymentProvider } from './billing/provider.js';
import {
  DEFAULT_TEST_SECRET,
  HmacPaymentProvider,
} from './billing/provider.js';
import { requirePlatformAdmin } from './admin/guard.js';
import {
  adminListQuerySchema,
  adminStatusUpdateSchema,
  adminSubscriptionOverrideSchema,
} from './admin/schema.js';
import {
  createCheckout,
  createOwnerAlert,
  getEntitlements,
  getMySubscription,
  handleWebhook,
  listOwnerAlerts,
  listPlans,
} from './billing/service.js';
import {
  createCheckoutSchema,
  ownerAlertCreateSchema,
  webhookParamsSchema,
} from './billing/schema.js';
import {
  getAuditLog,
  listAgencies,
  listExternalListings,
  listListings,
  listRealtors,
  listRequests as adminListRequests,
  listSubscriptions,
  listUsers,
  overrideSubscription,
  setAgencyStatus,
  setExternalListingStatus,
  setListingStatus,
  setRealtorStatus,
  setRequestStatus,
  setUserStatus,
} from './admin/service.js';
import { getPlatformAnalytics } from './analytics/service.js';
import {
  addAgencyMember,
  authenticateUser,
  createAgency,
  createSession,
  getAgency,
  getMembership,
  getOrCreateRealtor,
  getProfile,
  listAgencyMembers,
  registerUser,
  requireActiveMembership,
  revokeSession,
  getUserFromSession,
  updateAgency,
  updateProfile,
  updateRealtor,
} from './identity/service.js';
import {
  addPropertyImage,
  changePropertyStatus,
  createProperty,
  getProperty,
  getPropertyImages,
  listOwnProperties,
  updateProperty,
} from './properties/service.js';
import {
  addAgencyMemberSchema,
  createAgencySchema,
  createPropertySchema,
  loginSchema,
  paginationSchema,
  propertyStatusSchema,
  addPropertyImageSchema,
  registerSchema,
  updateAgencySchema,
  updateProfileSchema,
  updatePropertySchema,
  updateRealtorSchema,
} from './schemas.js';
import { ingestListing } from './ingestion/service.js';
import { ingestionPayloadSchema } from './ingestion/contract.js';
import { createServiceAuthPreHandler } from './ingestion/guard.js';
import { searchListings, ownerFeedListings } from './search/service.js';
import { ownerFeedQuerySchema, searchQuerySchema } from './search/schema.js';
import {
  archiveRequest,
  createRequest,
  getRequest,
  listRequests,
  updateRequest,
} from './requests/service.js';
import { createRequestSchema, updateRequestSchema } from './requests/schema.js';
import { matchListing, matchRequest } from './matching/service.js';
import type { JobEnqueue } from './app.js';
import {
  conversationParamsSchema,
  conversationQuerySchema,
  createConversationSchema,
  messageQuerySchema,
  sendMessageSchema,
} from './messaging/schema.js';
import {
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from './messaging/service.js';
import {
  notificationParamsSchema,
  notificationQuerySchema,
  updatePreferencesSchema,
} from './notifications/schema.js';
import {
  getNotificationPreferences,
  listNotifications,
  markNotificationRead,
  updateNotificationPreferences,
} from './notifications/service.js';

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, status: user.status };
}

export function registerRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  enqueueJob: JobEnqueue,
  paymentProvider?: PaymentProvider,
): void {
  const requireAuth = createAuthPreHandler(connection);
  const provider: PaymentProvider =
    paymentProvider ??
    new HmacPaymentProvider(
      {
        name: 'test',
        eventTypeMap: (raw) => {
          const type = raw['type'];
          if (type === 'checkout.completed' || type === 'payment.succeeded') {
            return 'payment.succeeded';
          }
          if (type === 'subscription.cancelled') {
            return 'subscription.cancelled';
          }
          if (type === 'subscription.expired') {
            return 'subscription.expired';
          }
          return 'unknown';
        },
      },
      DEFAULT_TEST_SECRET,
    );

  const requirePlatformAdminPre = async (request: {
    user?: AuthUser;
  }): Promise<void> => {
    if (!request.user) {
      throw new UnauthenticatedError('authentication required');
    }
    await requirePlatformAdmin(connection, request.user.id);
  };

  const adminPre = { preHandler: [requireAuth, requirePlatformAdminPre] };

  const membershipFor = async (
    agencyId: string | null,
    userId: string,
  ): Promise<AgencyMembership | null> =>
    agencyId === null ? null : getMembership(connection, agencyId, userId);

  // ---- Auth ----
  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body ?? {});
    const { userId } = await registerUser(connection, body);
    const token = await createSession(connection, userId, sessionMeta(request));
    const user = await getUserFromSession(connection, token);
    if (user === null) {
      throw new UnauthenticatedError('session not found');
    }
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body ?? {});
    const user = await authenticateUser(connection, body.email, body.password);
    if (user === null) {
      throw new UnauthenticatedError('invalid credentials');
    }
    const token = await createSession(
      connection,
      user.id,
      sessionMeta(request),
    );
    return reply.code(200).send({ token, user: publicUser(user) });
  });

  app.post(
    '/api/v1/auth/logout',
    { preHandler: requireAuth },
    async (request, reply) => {
      const token = extractToken(request);
      if (token) {
        await revokeSession(connection, token);
      }
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: publicUser(request.user!) };
  });

  // ---- Profile ----
  app.get('/api/v1/me', { preHandler: requireAuth }, async (request) => {
    return { profile: await getProfile(connection, request.user!.id) };
  });

  app.patch('/api/v1/me', { preHandler: requireAuth }, async (request) => {
    const fields = updateProfileSchema.parse(request.body ?? {});
    return {
      profile: await updateProfile(connection, request.user!.id, fields),
    };
  });

  // ---- Realtor ----
  app.get(
    '/api/v1/realtors/me',
    { preHandler: requireAuth },
    async (request) => {
      return {
        realtor: await getOrCreateRealtor(connection, request.user!.id),
      };
    },
  );

  app.patch(
    '/api/v1/realtors/me',
    { preHandler: requireAuth },
    async (request) => {
      const fields = updateRealtorSchema.parse(request.body ?? {});
      return {
        realtor: await updateRealtor(connection, request.user!.id, fields),
      };
    },
  );

  // ---- Agencies ----
  app.post(
    '/api/v1/agencies',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = createAgencySchema.parse(request.body ?? {});
      const agency = await createAgency(connection, request.user!.id, body);
      return reply.code(201).send({ agency });
    },
  );

  app.get('/api/v1/agencies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agency = await getAgency(connection, id);
    return reply.send({ agency });
  });

  app.patch(
    '/api/v1/agencies/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      await requireActiveMembership(connection, id, request.user!.id, 'admin');
      const fields = updateAgencySchema.parse(request.body ?? {});
      return { agency: await updateAgency(connection, id, fields) };
    },
  );

  app.get(
    '/api/v1/agencies/:id/members',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      await requireActiveMembership(connection, id, request.user!.id, 'member');
      return { members: await listAgencyMembers(connection, id) };
    },
  );

  app.post(
    '/api/v1/agencies/:id/members',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await requireActiveMembership(connection, id, request.user!.id, 'admin');
      const body = addAgencyMemberSchema.parse(request.body ?? {});
      const member = await addAgencyMember(
        connection,
        id,
        body.userId,
        body.role,
      );
      return reply.code(201).send({ member });
    },
  );

  // ---- Properties ----
  app.post(
    '/api/v1/my/properties',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = createPropertySchema.parse(request.body ?? {});
      let agencyId: string | null = null;
      if (body.agencyId) {
        const membership = await getMembership(
          connection,
          body.agencyId,
          request.user!.id,
        );
        if (membership === null || membership.status !== 'active') {
          throw new ForbiddenError(
            'not an active member of the selected agency',
          );
        }
        agencyId = body.agencyId;
      }
      const property = await createProperty(
        connection,
        request.user!.id,
        agencyId,
        body,
      );
      return reply.code(201).send({ property });
    },
  );

  app.get(
    '/api/v1/my/properties',
    { preHandler: requireAuth },
    async (request) => {
      const options = paginationSchema.parse(request.query ?? {});
      const result = await listOwnProperties(
        connection,
        request.user!.id,
        options,
      );
      return result;
    },
  );

  app.get(
    '/api/v1/my/properties/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      const property = await getProperty(connection, id);
      const membership = await membershipFor(
        property.agencyId,
        request.user!.id,
      );
      if (!canEditProperty(property, request.user!.id, membership)) {
        throw new ForbiddenError('not allowed to view this property');
      }
      return { property };
    },
  );

  app.patch(
    '/api/v1/my/properties/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      const property = await getProperty(connection, id);
      const membership = await membershipFor(
        property.agencyId,
        request.user!.id,
      );
      const actor = { userId: request.user!.id, membership };
      if (!canEditProperty(property, request.user!.id, membership)) {
        throw new ForbiddenError('not allowed to modify this property');
      }
      const fields = updatePropertySchema.parse(request.body ?? {});
      return { property: await updateProperty(connection, id, fields, actor) };
    },
  );

  app.post(
    '/api/v1/my/properties/:id/status',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const property = await getProperty(connection, id);
      const membership = await membershipFor(
        property.agencyId,
        request.user!.id,
      );
      const actor = { userId: request.user!.id, membership };
      if (!canEditProperty(property, request.user!.id, membership)) {
        throw new ForbiddenError('not allowed to modify this property');
      }
      const { status } = propertyStatusSchema.parse(request.body ?? {});
      const updated = await changePropertyStatus(connection, id, status, actor);
      return reply.send({ property: updated });
    },
  );

  app.post(
    '/api/v1/my/properties/:id/images',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const property = await getProperty(connection, id);
      const membership = await membershipFor(
        property.agencyId,
        request.user!.id,
      );
      const actor = { userId: request.user!.id, membership };
      if (!canEditProperty(property, request.user!.id, membership)) {
        throw new ForbiddenError('not allowed to modify this property');
      }
      const body = addPropertyImageSchema.parse(request.body ?? {});
      const image = await addPropertyImage(connection, id, body, actor);
      return reply.code(201).send({ image });
    },
  );

  app.get(
    '/api/v1/my/properties/:id/images',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      const property = await getProperty(connection, id);
      const membership = await membershipFor(
        property.agencyId,
        request.user!.id,
      );
      if (!canEditProperty(property, request.user!.id, membership)) {
        throw new ForbiddenError('not allowed to view this property');
      }
      return { images: await getPropertyImages(connection, id) };
    },
  );

  // ---- Search (public read model) ----
  app.get('/api/v1/search', async (request) => {
    const query = searchQuerySchema.parse(request.query ?? {});
    return searchListings(connection, query);
  });

  // ---- Ingestion (service-to-service) ----
  app.post(
    '/api/v1/ingestion/listings',
    {
      preHandler: createServiceAuthPreHandler(
        process.env['INGESTION_SERVICE_TOKEN'],
      ),
    },
    async (request, reply) => {
      const payload = ingestionPayloadSchema.parse(request.body ?? {});
      const result = await ingestListing(connection, payload);
      return reply.code(201).send({ result });
    },
  );

  // ---- Owner Feed ----
  app.get(
    '/api/v1/owner-feed',
    { preHandler: requireAuth },
    async (request) => {
      const query = ownerFeedQuerySchema.parse(request.query ?? {});
      return ownerFeedListings(connection, query);
    },
  );

  // ---- Client Requests ----
  app.post(
    '/api/v1/requests',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = createRequestSchema.parse(request.body ?? {});
      const created = await createRequest(connection, request.user!.id, body);
      return reply.code(201).send({ request: created });
    },
  );

  app.get('/api/v1/requests', { preHandler: requireAuth }, async (request) => {
    const options = paginationSchema.parse(request.query ?? {});
    return listRequests(connection, request.user!.id, options);
  });

  app.get(
    '/api/v1/requests/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      return { request: await getRequest(connection, id, request.user!.id) };
    },
  );

  app.patch(
    '/api/v1/requests/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      const fields = updateRequestSchema.parse(request.body ?? {});
      return {
        request: await updateRequest(connection, id, request.user!.id, fields),
      };
    },
  );

  app.post(
    '/api/v1/requests/:id/archive',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const created = await archiveRequest(connection, id, request.user!.id);
      return reply.send({ request: created });
    },
  );

  app.get(
    '/api/v1/requests/:id/matches',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      return matchRequest(connection, id, request.user!.id);
    },
  );

  app.get(
    '/api/v1/listings/:id/matches',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      return matchListing(connection, id, request.user!.id);
    },
  );

  // ---- Messaging ----
  app.post(
    '/api/v1/conversations',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = createConversationSchema.parse(request.body ?? {});
      const conversation = await createConversation(
        connection,
        request.user!.id,
        body.withUserId,
      );
      return reply.code(201).send({ conversation });
    },
  );

  app.get(
    '/api/v1/conversations',
    { preHandler: requireAuth },
    async (request) => {
      const query = conversationQuerySchema.parse(request.query ?? {});
      return listConversations(connection, request.user!.id, query);
    },
  );

  app.get(
    '/api/v1/conversations/:id',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = conversationParamsSchema.parse(request.params);
      return {
        conversation: await getConversation(connection, id, request.user!.id),
      };
    },
  );

  app.get(
    '/api/v1/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = conversationParamsSchema.parse(request.params);
      const query = messageQuerySchema.parse(request.query ?? {});
      return listMessages(connection, id, request.user!.id, query);
    },
  );

  app.post(
    '/api/v1/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = conversationParamsSchema.parse(request.params);
      const body = sendMessageSchema.parse(request.body ?? {});
      const message = await sendMessage(
        connection,
        id,
        request.user!.id,
        body,
        enqueueJob,
      );
      return reply.code(201).send({ message });
    },
  );

  app.post(
    '/api/v1/conversations/:id/read',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = conversationParamsSchema.parse(request.params);
      return markConversationRead(connection, id, request.user!.id);
    },
  );

  // ---- Notifications ----
  app.get(
    '/api/v1/notifications',
    { preHandler: requireAuth },
    async (request) => {
      const query = notificationQuerySchema.parse(request.query ?? {});
      return listNotifications(connection, request.user!.id, query);
    },
  );

  app.post(
    '/api/v1/notifications/:id/read',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = notificationParamsSchema.parse(request.params);
      return {
        notification: await markNotificationRead(
          connection,
          id,
          request.user!.id,
        ),
      };
    },
  );

  app.get(
    '/api/v1/notification-preferences',
    { preHandler: requireAuth },
    async (request) => {
      return {
        preferences: await getNotificationPreferences(
          connection,
          request.user!.id,
        ),
      };
    },
  );

  app.patch(
    '/api/v1/notification-preferences',
    { preHandler: requireAuth },
    async (request) => {
      const fields = updatePreferencesSchema.parse(request.body ?? {});
      return {
        preferences: await updateNotificationPreferences(
          connection,
          request.user!.id,
          fields,
        ),
      };
    },
  );

  // ---- Billing ----
  app.get('/api/v1/billing/plans', async () => {
    return { plans: await listPlans(connection) };
  });

  app.get(
    '/api/v1/billing/subscription',
    { preHandler: requireAuth },
    async (request) => {
      return {
        subscription: await getMySubscription(connection, request.user!.id),
        entitlements: await getEntitlements(connection, request.user!.id),
      };
    },
  );

  app.post(
    '/api/v1/billing/checkout',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = createCheckoutSchema.parse(request.body ?? {});
      const result = await createCheckout(
        connection,
        provider,
        request.user!.id,
        body.planCode,
      );
      return reply.code(200).send(result);
    },
  );

  app.get(
    '/api/v1/me/entitlements',
    { preHandler: requireAuth },
    async (request) => {
      return {
        entitlements: await getEntitlements(connection, request.user!.id),
      };
    },
  );

  app.post(
    '/api/v1/owner-alerts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = ownerAlertCreateSchema.parse(request.body ?? {});
      const result = await createOwnerAlert(
        connection,
        request.user!.id,
        body.listingId,
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/api/v1/owner-alerts',
    { preHandler: requireAuth },
    async (request) => {
      return { alerts: await listOwnerAlerts(connection, request.user!.id) };
    },
  );

  app.post('/api/v1/billing/webhooks/:provider', async (request, reply) => {
    const { provider: providerName } = webhookParamsSchema.parse(
      request.params,
    );
    if (providerName !== provider.name) {
      throw new ForbiddenError('provider mismatch');
    }
    const signature = request.headers['x-payment-signature'];
    const result = await handleWebhook(
      connection,
      provider,
      request.body,
      typeof signature === 'string' ? signature : undefined,
      enqueueJob,
    );
    return reply.code(200).send(result);
  });

  // ---- Admin (platform administrator only) ----
  app.get('/api/v1/admin/users', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { users: await listUsers(connection, query) };
  });

  app.patch(
    '/api/v1/admin/users/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setUserStatus(connection, request.user!.id, id, body);
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/realtors', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { realtors: await listRealtors(connection, query) };
  });

  app.patch(
    '/api/v1/admin/realtors/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setRealtorStatus(
        connection,
        request.user!.id,
        id,
        body,
      );
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/agencies', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { agencies: await listAgencies(connection, query) };
  });

  app.patch(
    '/api/v1/admin/agencies/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setAgencyStatus(connection, request.user!.id, id, body);
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/listings', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { listings: await listListings(connection, query) };
  });

  app.patch(
    '/api/v1/admin/listings/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setListingStatus(
        connection,
        request.user!.id,
        id,
        body,
      );
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/external-listings', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { externalListings: await listExternalListings(connection, query) };
  });

  app.patch(
    '/api/v1/admin/external-listings/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setExternalListingStatus(
        connection,
        request.user!.id,
        id,
        body,
      );
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/requests', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { requests: await adminListRequests(connection, query) };
  });

  app.patch(
    '/api/v1/admin/requests/:id/status',
    adminPre,
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = adminStatusUpdateSchema.parse(request.body ?? {});
      const row = await setRequestStatus(
        connection,
        request.user!.id,
        id,
        body,
      );
      return reply.send(row);
    },
  );

  app.get('/api/v1/admin/subscriptions', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { subscriptions: await listSubscriptions(connection, query) };
  });

  app.post(
    '/api/v1/admin/subscriptions/override',
    adminPre,
    async (request, reply) => {
      const body = adminSubscriptionOverrideSchema.parse(request.body ?? {});
      const row = await overrideSubscription(
        connection,
        request.user!.id,
        body,
      );
      return reply.code(200).send(row);
    },
  );

  app.get('/api/v1/admin/audit', adminPre, async (request) => {
    const query = adminListQuerySchema.parse(request.query ?? {});
    return { audit: await getAuditLog(connection, query) };
  });

  // ---- Analytics (platform administrator only) ----
  app.get('/api/v1/analytics', adminPre, async () => {
    return { analytics: await getPlatformAnalytics(connection) };
  });
}

function sessionMeta(request: {
  ip?: string;
  headers: Record<string, unknown>;
}) {
  const userAgent =
    typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : null;
  return { ipAddress: request.ip ?? null, userAgent };
}
