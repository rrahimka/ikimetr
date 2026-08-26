import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '@ikimetr/database';

import { ForbiddenError, UnauthenticatedError } from './errors.js';
import { createAuthPreHandler, extractToken } from './guard.js';
import { canEditProperty, type AgencyMembership } from './authz.js';
import type { AuthUser } from './identity/service.js';
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

function publicUser(user: AuthUser) {
  return { id: user.id, email: user.email, status: user.status };
}

export function registerRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): void {
  const requireAuth = createAuthPreHandler(connection);

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
