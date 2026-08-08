# Admin & Moderation v1.1

## Purpose
Operate the platform without direct production database manipulation.

## MVP capabilities
- realtor verification review;
- user status/blocking;
- duplicate candidate review;
- source/adapter health visibility and kill switch;
- reported data/content handling;
- security event review;
- owner-classification correction where permitted.

## Security
Moderator and admin are different concepts. Moderators do not receive blanket access to clients, private notes or messages. Privileged data access is reason-bound and auditable.

## Principle
No operational workflow should require routine manual SQL edits in production.
