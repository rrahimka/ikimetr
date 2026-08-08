# Technical Architecture v1.1

## Style
Модульный монолит + отдельные worker-процессы.

## Основные компоненты
- Web: Next.js
- API: Fastify + TypeScript
- Database: PostgreSQL + PostGIS
- Cache/queue: Redis
- Background queue: BullMQ-class queue abstraction
- Storage: S3-compatible object storage
- AI: provider-independent AI Gateway

## High-level
Internet → CDN/Reverse Proxy → Next.js Web / Fastify API → Domain Modules → PostgreSQL/Redis/Object Storage.

Workers обслуживают ingestion, normalization, dedupe, matching, notifications, AI и image processing.

## Domain modules
- auth
- users/realtors
- properties/listings
- requests
- matching
- freshness
- owner-intelligence
- ingestion
- deduplication
- notifications
- moderation/admin
- audit/security

## Core principles
- Database model ≠ API DTO.
- Heavy jobs do not block user HTTP requests.
- Redis is never a source of truth.
- Search v1 uses PostgreSQL indexes/full-text/PostGIS; separate search engine only after measured need.
- Business modules call AI Gateway, never a concrete model SDK directly.
- Workers have least-privilege access.

## Core event flow
Frontend → API command → validation → authorization → transaction → domain event/outbox when required → queue job → worker → resulting domain changes/notifications.

## Environments
Development, Staging, Production are separated. Secrets, databases and storage are not shared between environments.

## Deployment
Initial production deployment may use Docker on a VPS/cloud host. Kubernetes is explicitly out of MVP scope.
