import 'fastify';

import type { AuthUser } from './identity/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
