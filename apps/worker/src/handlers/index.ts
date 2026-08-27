import type { JobHandler } from '../job-processor.js';
import { handleNotificationDeliver } from './notifications.js';
import { handleStaleListing } from './stale-listing.js';

export function createJobHandlers(): Record<string, JobHandler> {
  return {
    'notification.deliver': handleNotificationDeliver,
    'stale_listing.process': handleStaleListing,
  };
}
