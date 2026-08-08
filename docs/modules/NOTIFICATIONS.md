# Notifications v1.1

## Principle
Do not recreate WhatsApp noise. Notify only when the user can take a meaningful action.

## High priority
- high-quality new match;
- a new matching request for user's listing;
- important price/status change affecting an active request;
- direct collaboration/status action.

## Work reminders
- property requires verification;
- request requires confirmation.

## Informational
Owner Feed changes and lower-value events should generally appear in dashboard/digest rather than immediate push.

## Architecture
Business event → Notification record → delivery preference/channel. Delivery failure must not erase the notification itself.

## Preferences
Design supports per-type channel/threshold later, but MVP may begin with in-app notifications and conservative defaults.
