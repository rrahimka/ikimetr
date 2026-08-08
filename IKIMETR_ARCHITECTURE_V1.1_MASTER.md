# İkiMetr Architecture v1.1 — Master Documentation

Официальная сводная версия. При конфликте ранних идей с Architecture Review v1.1 применяются решения v1.1.

---

## Source: `README.md`

# İkiMetr Architecture v1.1

Официальный пакет проектной документации для разработки İkiMetr с нуля.

## Статус
- Версия: 1.1
- Состояние: Architecture Review completed / ready for Foundation implementation
- Основной пользователь MVP: риелтор
- Первый рынок: Азербайджан, с приоритетом Баку

## Главная идея
İkiMetr — профессиональная рабочая платформа риелтора, которая объединяет личную базу недвижимости, клиентские заявки, автоматическое сопоставление спроса и предложения и поток объектов от собственников.

## Порядок чтения
1. `docs/PROJECT_CONSTITUTION.md`
2. `docs/product/PRODUCT.md`
3. `docs/product/MVP.md`
4. `docs/product/BUSINESS_RULES.md`
5. `docs/domain/DOMAIN_MODEL.md`
6. `docs/security/DATA_VISIBILITY.md`
7. `docs/architecture/ARCHITECTURE.md`
8. `docs/development/DEVELOPMENT_PLAN.md`
9. `AGENTS.md`
10. Первая задача: `specs/phase-00-foundation/00.01-bootstrap.md`

## Принцип разработки
Documentation → Task Specification → Implementation → Automated Checks → Review → Commit.

---

## Source: `docs/PROJECT_CONSTITUTION.md`

# İkiMetr Project Constitution v1.1

Этот документ содержит архитектурные и продуктовые правила верхнего уровня. Они обязательны для разработчиков и AI-агентов. Изменение фундаментального правила допускается только через отдельное архитектурное решение (ADR).

## 1. Realtor-first
Главный пользователь MVP — риелтор. Решения первой версии оптимизируются под его ежедневную работу.

## 2. Product core
Ядро v1 состоит из четырёх частей:
1. личная база риелтора;
2. клиентские заявки;
3. автоматический matching спроса и предложения;
4. поток объектов от собственников.

## 3. Property ≠ Listing
`Property` — физический объект недвижимости. `Listing` — конкретное предложение по этому объекту. Один Property может иметь много Listings.

## 4. RealtorProperty ≠ Listing
`RealtorProperty` — приватная рабочая запись риелтора об объекте. Она не становится публичным или профессиональным объявлением автоматически.

## 5. Client ≠ Request
`Client` — человек/контакт. `Request` — конкретная потребность. Request может существовать без обязательного полноценного Client profile.

## 6. Match is an entity
Match создаётся между Request и конкретным Listing, сохраняется в базе и имеет историю score, причин и бизнес-статуса.

## 7. Privacy by default
Любые клиентские контакты, контакты собственников, приватные заметки, документы и переписка закрыты по умолчанию.

## 8. Backend decides authorization
Frontend никогда не является источником прав. Backend обязан проверять authentication, permission, ownership и resource policy для каждого чувствительного действия.

## 9. Rules before AI
Сначала обычный код, правила, SQL, статистика и детерминированные алгоритмы. AI применяется только там, где они недостаточны.

## 10. AI is not a source of truth
AI может классифицировать, извлекать, сравнивать и рекомендовать, но не может самостоятельно раскрывать контакты, выдавать права, менять ownership, выполнять привилегированные операции или принимать критические решения без бизнес-правил.

## 11. AI provider independence
Бизнес-код обращается к AI через абстрактный AI Gateway. Провайдеры и модели должны быть заменяемыми.

## 12. PostgreSQL is source of truth
Основные бизнес-данные хранятся в PostgreSQL. Redis, поисковые индексы, кэши и AI-результаты являются производными.

## 13. Modular monolith first
MVP строится как модульный монолит с отдельными worker-процессами. Микросервисы не создаются без реальной эксплуатационной необходимости.

## 14. Heavy work goes to workers
Ingestion, deduplication, массовый matching, AI, изображения и уведомления выполняются фоновыми worker-процессами.

## 15. External data is untrusted
Внешние данные проходят Raw → Validation → Normalization → Classification → Deduplication до попадания в core domain.

## 16. Conservative deduplication
False merge хуже дополнительного дубля. При недостаточной уверенности объекты не объединяются автоматически.

## 17. History matters
Критичные изменения цены, статуса, актуальности, match score и доступа к данным должны сохранять историю.

## 18. Sensitive actions are auditable
Раскрытие контакта, изменение ролей, merge объектов, административный доступ к приватным данным и аналогичные действия должны создавать audit event.

## 19. Stepwise development
Каждая задача имеет ограниченный scope, out-of-scope и Definition of Done. AI-агент не имеет права самовольно расширять задачу.

## 20. Architecture changes require ADR
Замена фундаментального компонента или доменной модели требует отдельного ADR с контекстом, альтернативами, рисками и последствиями.

---

## Source: `docs/product/PRODUCT.md`

# Product Definition

## Проблема рынка
Работа риелтора сегодня распределена между сайтами объявлений, телефонными звонками, WhatsApp-группами, личными чатами, тетрадями и разрозненными базами. Это создаёт четыре системные проблемы:
- трудно быстро находить свежие предложения собственников;
- личные базы быстро устаревают;
- спрос и предложение риелторов плохо сопоставляются;
- взаимодействие через WhatsApp перегружено и неструктурировано.

## Решение
İkiMetr объединяет рабочий процесс риелтора в одной системе:
- Owner Feed — обработанный поток предложений собственников;
- My Database — личная база объектов и их актуальность;
- Requests — структурированные потребности клиентов;
- Matching — автоматическое сопоставление Request ↔ Listing;
- Realtor Contact Flow — взаимодействие риелторов по найденному совпадению.

## Позиционирование
İkiMetr — не просто сайт объявлений. Это профессиональная операционная система риелтора на рынке недвижимости Азербайджана.

## Главный пользователь MVP
Риелтор.

## Первый рынок
Азербайджан, с приоритетом Баку. Архитектура не должна быть жёстко привязана к одному городу.

## Повседневная ценность
Риелтор открывает систему и сразу видит:
- новые объекты собственников;
- новые matches;
- объекты, требующие проверки;
- заявки, требующие подтверждения;
- изменения цены;
- действия по текущим совпадениям.

## Долгосрочная модель
После появления достаточной ликвидности платформа может подключить покупателей, арендаторов и собственников как прямых участников, не меняя фундаментальную доменную модель.

---

## Source: `docs/product/MVP.md`

# MVP Scope v1.1

## Входит в MVP
1. Authentication foundation
2. Realtor Profile
3. My Properties / private working database
4. Basic freshness management
5. Requests
6. Deterministic Matching
7. Realtor contact/status flow
8. Owner ingestion from initially one approved source
9. Owner classification v1
10. Basic conservative deduplication
11. Owner Feed
12. Minimal notifications
13. Moderation/Admin foundation
14. Minimal product analytics

## Не входит в MVP
- native iOS/Android applications;
- полноценный внутренний чат;
- semantic AI matching;
- complex agency CRM;
- advanced deal management;
- public marketplace for all buyers;
- mass self-service owner publishing;
- advertising platform;
- payments/subscriptions;
- advanced BI;
- international expansion;
- broad realtime infrastructure.

## MVP success path
REGISTER → CREATE PROFILE → ADD PROPERTY → CREATE REQUEST → GET MATCH → CONTACT REALTOR → UPDATE RESULT.

Параллельно:
EXTERNAL LISTING → NORMALIZE → CLASSIFY OWNER → DEDUPE → OWNER FEED → MATCH TO REQUEST.

## Product validation metrics
- active realtors / retention;
- active properties maintained;
- active requests created;
- useful matches created;
- match viewed/contacted rate;
- viewing/status update rate;
- precision of Owner Feed;
- freshness quality.

---

## Source: `docs/product/BUSINESS_RULES.md`

# Business Rules

## Core
- **BR-001** Добавление объекта в личную базу не делает его публичным объявлением.
- **BR-002** Один физический Property может иметь несколько Listings.
- **BR-003** Один риелтор может иметь приватную RealtorProperty для существующего Property.
- **BR-004** Один Client может иметь несколько Requests.
- **BR-005** Request может существовать без обязательного Client profile.
- **BR-006** Match создаётся между Request и конкретным Listing.
- **BR-007** Match хранит историю score и статуса.

## Privacy
- **BR-010** Клиентская база риелтора закрыта для других риелторов.
- **BR-011** Телефон клиента не раскрывается другой стороне автоматически.
- **BR-012** Приватный контакт собственника не раскрывается другой стороне без policy decision.
- **BR-013** Личные заметки риелтора не доступны другим пользователям.
- **BR-014** Скрытие данных на frontend не является механизмом безопасности; backend не должен отправлять запрещённые данные.

## Freshness
- **BR-020** Наличие записи в базе не означает её актуальность.
- **BR-021** У Listing/Request должны быть данные последней проверки и состояние свежести.
- **BR-022** Stale/Inactive records не участвуют в обычном matching.
- **BR-023** Исчезновение объявления из одного внешнего источника не означает автоматически `SOLD`.

## Matching
- **BR-030** Matching v1 детерминированный и объяснимый.
- **BR-031** Жёсткие ограничения применяются до weighted scoring.
- **BR-032** Отсутствующее значение = `UNKNOWN`, а не отрицательный факт.
- **BR-033** Score не представляется пользователю как вероятность сделки.
- **BR-034** Повторный расчёт той же пары Request+Listing обновляет существующий Match, а не создаёт дубликат.

## Owner intelligence
- **BR-040** Owner classification хранит confidence/evidence и версию алгоритма.
- **BR-041** Нельзя утверждать `confirmed owner` только на основании LLM-оценки.
- **BR-042** Высокая вероятность собственника и подтверждённый собственник — разные состояния.

## Deduplication
- **BR-050** Исходные Listings не удаляются при объединении.
- **BR-051** False merge считается более опасным, чем лишний дубль.
- **BR-052** Сомнительные кандидаты направляются на moderation.

## External data
- **BR-060** Для каждого источника фиксируется разрешённый способ получения и ограничения.
- **BR-061** Raw data хранится отдельно от core domain.
- **BR-062** Неизменившийся payload не запускает дорогостоящую повторную обработку без необходимости.

## Audit
- **BR-070** CONTACT_REVEALED и аналогичные чувствительные действия аудируются.
- **BR-071** Audit log, security events, product analytics и application logs — разные потоки данных.

---

## Source: `docs/product/UX_MAP.md`

# UX Map v1.1

## Main navigation
Dashboard / Owners / My Properties / Requests / Matches / Realtors / Notifications / Profile. Admin is role-gated. Internal Messages are post-MVP unless beta proves necessary.

## Dashboard purpose
Answer: “What requires my attention now?”
Show high-value actions rather than vanity charts:
- new owner listings;
- new/high-quality matches;
- matches to user's own listings;
- properties needing verification;
- requests needing verification;
- price changes;
- scheduled viewings/status follow-up.

## Owner Feed
Each card shows district, type, rooms, area, price, first seen, freshness, owner-confidence class, source count and price change. Actions: open, save/add to private database, check matches, hide.

## My Properties
Views by active / needs verification / reserved / sold-rented / archive. Must support bulk freshness confirmation.

## Requests
Views by active / needs confirmation / has matches / closed. Creation starts with essential structured fields, then optional constraints and free-text notes.

## Match screen
Side-by-side Request vs Listing with explainable differences. Actions in MVP: interested, not suitable, contact realtor, update outcome/viewing status.

## Realtor directory
Professional directory, not a social network. Filter by geography/specialization/verification. Never reveal private client or property notes.

## Mobile
Web MVP must be strongly responsive because field use on phones is expected. Native apps are post-beta.

## UX principle
Every major screen should help the realtor do at least one of: find a property, find demand, keep data current, or move a match toward an outcome.

---

## Source: `docs/product/ANALYTICS.md`

# Minimal Product Analytics

## Separate from audit/security logs
Product analytics measures usage and product value; it must not be used as a substitute for audit evidence.

## MVP events/metrics
- realtor_registered / realtor_active;
- property_added / property_verified;
- request_created / request_verified;
- match_created / match_viewed / match_interested / match_contacted;
- viewing/status outcome where implemented;
- owner_feed_viewed / owner_listing_saved;
- owner classification feedback;
- stale property/request counts.

## Core questions
- Do realtors return?
- Do they keep data current?
- Are matches useful enough to produce contact?
- Is Owner Feed precise enough to trust?
- Which workflow actually saves time?

---

## Source: `docs/domain/DOMAIN_MODEL.md`

# Domain Model

## User
Учётная запись и identity в системе. Не содержит всей профессиональной логики риелтора.

## RealtorProfile
Профессиональный профиль риелтора: имя, специализация, районы работы, верификация, публичные профессиональные контакты.

## Agency
Организация риелторов. Поддерживается архитектурно, но сложный agency workspace не входит в MVP.

## Property
Физический объект недвижимости. Хранит устойчивые характеристики: тип, географию, комнаты, площадь, этажность и т.п.

## Listing
Конкретное рыночное предложение по Property. Содержит transaction type, price, description, source, visibility, status и временные атрибуты.

## RealtorProperty
Приватная рабочая запись риелтора относительно Property: личные заметки, локальный статус, контакт, last_verified_at и рабочие данные.

## Owner
Собственник или предполагаемый собственник. Личные контакты должны храниться через отдельную защищённую модель.

## Client
Клиент риелтора. Может не иметь собственного аккаунта İkiMetr.

## Request
Конкретная потребность клиента/риелтора: тип сделки, район, бюджет, комнаты, площадь, ограничения и свободные требования.

## Match
Связь Request ↔ Listing с score, объяснением, версией алгоритма и статусом.

## Collaboration
Опциональный workflow взаимодействия двух риелторов вокруг Match. В MVP может быть упрощён до статусов contact/viewing/closed.

## Viewing
Событие просмотра объекта, связанное с Match/Collaboration.

## Source
Внешний источник данных с разрешённым acquisition mode, состоянием адаптера и health metadata.

## RawListing
Необработанный или транспортно нормализованный снимок объявления из Source.

## DuplicateCandidate
Кандидат на объединение Listing/Property с evidence и confidence.

## Notification
Пользовательское уведомление о match, freshness, price change и других событиях.

## AuditEvent
Неизменяемая запись о чувствительном действии.

## SecurityEvent
Сигнал подозрительного поведения или угрозы.

## Базовые связи
User → RealtorProfile
RealtorProfile → RealtorProperty → Property
Property → Listing
RealtorProfile → Client → Request
Request → Match → Listing → Property
Source → RawListing → Listing

---

## Source: `docs/domain/DATA_VISIBILITY.md`

# Data Visibility & Ownership

## Базовый принцип
Private by default. Любое раскрытие чувствительных данных требует явного policy decision на backend.

## Матрица
| Data | Владелец/риелтор | Другой риелтор | Покупатель | Собственник | Moderator | Admin |
|---|---|---|---|---|---|---|
| Публичные характеристики Listing | Да | Да по visibility | Да если public | Свой объект | Да | Да |
| Realtor private notes | Да | Нет | Нет | Нет | Нет | Только privileged |
| Client request criteria | Да | Только необходимые параметры | Своя заявка | Aggregate/нет | Ограниченно | Privileged |
| Client phone | Да | Нет по умолчанию | Свой | Нет | Нет | Privileged |
| Owner private contact | По policy | По policy | Нет | Свой | Ограниченно | Privileged |
| Match | Сторона | Сторона | Только если предусмотрено | Только если предусмотрено | Ограниченно | Privileged |
| Conversation | Участник | Участник | Участник | Участник | Нет по умолчанию | Только спец. доступ |
| Audit | Частично | Нет | Нет | Частично | По роли | Уполномоченный |

## Ownership
Каждая чувствительная запись должна иметь явный owner/workspace relation. Нельзя вычислять принадлежность по косвенным признакам.

## Contact Access Boundary
Доступ к owner/client contacts осуществляется только через отдельный domain policy/module с:
1. permission check;
2. ownership/business-basis check;
3. rate limit;
4. audit event;
5. controlled response DTO.

## Export
Пользователь может экспортировать свои данные согласно policy, но массовая выгрузка чужих owner/client contacts запрещена.

---

## Source: `docs/architecture/ARCHITECTURE.md`

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

---

## Source: `docs/architecture/ARCHITECTURE_REVIEW_V1.1.md`

# Architecture Review — v1.0 to v1.1

The red-team review resulted in these corrections:

1. Separate **MVP Core** (realtor database, requests, deterministic matching, contact flow) from **MVP Intelligence** (ingestion, owner classification, dedupe, Owner Feed). The product must remain useful if external ingestion is temporarily unavailable.
2. Match targets a concrete **Listing**, then reaches Property through it.
3. Canonical merge is conservative; introduce Listing Cluster if useful before asserting physical identity.
4. Client profile is optional for Request in early MVP.
5. Full internal chat is removed from mandatory MVP.
6. Realtime is removed from mandatory MVP.
7. Complex agency workspaces are deferred.
8. Semantic AI matching is deferred until deterministic matching is validated.
9. Owner/client contact reveal becomes a dedicated security boundary.
10. Add feature flags, versioned/configurable rules, data provenance and minimal analytics.
11. Separate audit, security events, product analytics and application logs.
12. Owner Feed must not be the only durable value proposition; core professional workflow must stand alone.

These corrections supersede earlier v1.0 assumptions where they conflict.

---

## Source: `docs/architecture/EVENTS.md`

# Domain Events & Queue Jobs

## Domain events
Events describe business facts that already happened.

### User/Realtor
- USER_REGISTERED
- USER_VERIFIED
- REALTOR_VERIFIED
- USER_BLOCKED

### Property/Listing
- PROPERTY_CREATED
- PROPERTY_UPDATED
- PROPERTY_STATUS_CHANGED
- LISTING_CREATED
- LISTING_UPDATED
- LISTING_PRICE_CHANGED
- LISTING_DISAPPEARED
- LISTING_REAPPEARED

### Requests/Matches
- REQUEST_CREATED
- REQUEST_UPDATED
- REQUEST_VERIFIED
- REQUEST_EXPIRED
- REQUEST_CLOSED
- MATCH_CREATED
- MATCH_SCORE_CHANGED
- MATCH_STATUS_CHANGED

### Owner/Dedupe
- OWNER_CLASSIFIED
- OWNER_CONFIDENCE_CHANGED
- DUPLICATE_CANDIDATE_FOUND
- PROPERTIES_MERGED
- DUPLICATE_REJECTED

### Security/Audit
- CONTACT_REVEALED
- ROLE_CHANGED
- ADMIN_PRIVATE_DATA_ACCESSED

## Queue jobs
Jobs describe technical work to perform.
- PROCESS_RAW_LISTING
- NORMALIZE_LISTING
- CLASSIFY_OWNER
- FIND_DUPLICATE_CANDIDATES
- RUN_MATCHING_FOR_REQUEST
- RUN_MATCHING_FOR_LISTING
- SEND_NOTIFICATION
- PROCESS_IMAGE

## Reliability
Critical DB change + event scheduling should use an outbox pattern where loss of the event would create incorrect business state.

## Idempotency
Jobs and commands that may retry must have idempotency strategy. In particular Request+Listing cannot create duplicate active Match records.

---

## Source: `docs/architecture/CONFIG_AND_FLAGS.md`

# Configuration & Feature Flags

## Configurable business values
Avoid magic numbers for freshness windows, match thresholds, owner-confidence cutoffs, rate limits and notification thresholds. Keep them in a versioned configuration layer with safe defaults.

## Feature flags
Architecture should support controlled enablement such as:
- OWNER_FEED_SOURCE_X
- AI_OWNER_REVIEW
- AI_SEMANTIC_MATCHING
- INTERNAL_CHAT
- PUBLIC_LISTINGS

Flags are deployment/product controls, not substitutes for authorization.

---

## Source: `docs/security/SECURITY.md`

# Security Architecture

## Threat priorities
1. Account takeover
2. IDOR/BOLA / authorization bypass
3. Mass scraping of owner/client data
4. Malicious or fake realtor accounts
5. Admin/internal misuse
6. File upload abuse
7. SSRF via external-source tooling
8. Secret leakage
9. Prompt injection / unsafe AI tool use
10. Data loss / failed recovery

## Required controls
- server-side authorization for every protected resource;
- ownership/resource policy checks;
- strong session controls and session revocation;
- rate limiting by endpoint category;
- protected contact-access module;
- audit logging for sensitive access;
- separate security events;
- secrets outside repository;
- secure upload validation;
- outbound URL restrictions for ingestion;
- least-privilege workers and admin roles;
- backups + restore drills;
- dependency/security checks in CI;
- sanitised application logs.

## AI security
AI output is untrusted. It cannot directly execute SQL, reveal contacts, change roles, modify ownership or perform destructive admin actions. External listing text is data, never instructions.

## Admin
Admin is not omnipotent by default. Privileged access to private content should be reason-bound and auditable.

## Contact data
Owner/client contacts are treated as high-value sensitive data. UI hiding is insufficient; unauthorized data must never be included in API response payloads.

---

## Source: `docs/security/SECURITY_RULES.md`

# Security Rules for Coding Agents

NEVER trust authorization decisions from frontend.
NEVER trust `user_id`, role or ownership supplied by client payload.
NEVER expose owner/client private contacts without a domain policy check.
NEVER log passwords, tokens, secrets or full sensitive contacts.
NEVER commit credentials or `.env` secrets.
NEVER return raw database entities when they contain internal/private fields.
NEVER execute AI output as privileged instructions.
NEVER allow a worker broader database access than its task requires.
ALWAYS validate inputs before domain logic.
ALWAYS enforce ownership/permission server-side.
ALWAYS audit sensitive data reveal and privileged administrative access.
ALWAYS add authorization tests for new protected resources.

---

## Source: `docs/database/DATABASE.md`

# Logical Database Model

## Core tables
- users
- realtor_profiles
- agencies
- agency_members
- properties
- listings
- realtor_properties
- owners
- owner_contacts
- clients
- client_contacts
- requests
- matches
- match_reasons
- match_score_history
- viewings
- conversations (post-MVP if needed)
- messages (post-MVP if needed)
- data_sources
- raw_listings
- property_images
- price_history
- status_history
- freshness_checks
- duplicate_candidates
- property_merges
- verifications
- consents
- notifications
- notification_preferences
- audit_events
- security_events

## Design rules
- UUID/UUIDv7-style identifiers preferred for externally exposed resources.
- Money uses exact numeric/integer semantics, never float.
- Time stored in UTC.
- Soft delete only where business history requires it; not universally.
- Contact data is separated from core owner/client entities.
- Price lives on Listing, not Property.
- Match references Request + Listing; Property is reached through Listing.
- History tables preserve important changes.
- Algorithm outputs store algorithm/version metadata.

## Geography
Use normalized city/district/subdistrict references plus PostGIS geometry/coordinates.

## Images
Prefer content hash metadata; physical storage is object storage, not PostgreSQL BLOBs.

---

## Source: `docs/api/API.md`

# API Contract Principles

## Versioning
All public application endpoints live under `/api/v1`.

## Core resource groups
- `/auth/*`
- `/me`
- `/realtors/*`
- `/properties/*`
- `/my/properties/*`
- `/requests/*`
- `/matches/*`
- `/owner-properties/*`
- `/notifications/*`
- `/dashboard`
- `/admin/*`

## API rules
- Validate every payload using schemas.
- Authorize every protected resource server-side.
- Never expose internal/private DB fields accidentally.
- Use stable error codes, not raw stack traces.
- Attach request/correlation IDs.
- Heavy work is queued after the transactional business operation.
- For upload flows, prefer signed upload URLs when appropriate.

## Example request flow
`POST /api/v1/requests`
1. validate payload;
2. authenticate;
3. authorize realtor;
4. save Request in transaction;
5. create `REQUEST_CREATED`/outbox event where required;
6. enqueue matching job;
7. return `201` without waiting for heavy matching.

---

## Source: `docs/modules/PROPERTIES.md`

# Properties Module

## Purpose
Manage physical Property, private RealtorProperty and market-facing Listing as separate concepts.

## MVP capabilities
- create/update RealtorProperty;
- attach/create canonical Property conservatively;
- add images;
- manage listing price/status;
- track price/status history;
- freshness confirmation;
- search/filter own database.

## Non-goals
Public advertising marketplace and complex agency inventory are out of MVP.

---

## Source: `docs/modules/REQUESTS.md`

# Requests Module

## Purpose
Represent structured demand from a realtor/client.

## Core fields
Transaction type, property type, geography, price range, room range, area range, floor preferences, renovation, structured constraints and free-text requirements.

## Lifecycle
ACTIVE → NEEDS_VERIFICATION → CLOSED_SUCCESS / CLOSED_NO_RESULT / EXPIRED.

## Rules
- client_id may be optional;
- stale request is excluded from normal matching;
- private client contact is not part of matching payload.

---

## Source: `docs/modules/MATCHING.md`

# Matching Engine v1

## Goal
Rank Listings against Requests with explainable deterministic scoring.

## Pipeline
1. Eligibility filters
2. Candidate generation
3. Hard constraints
4. Weighted scoring
5. Negative/exclusion rules
6. Save/update Match
7. Notify only when materially useful

## Principles
- Start without LLM semantic matching.
- Unknown values are not treated as negative values.
- Score is not a probability of deal success.
- Store reasons and algorithm version.
- Recalculate on meaningful Request/Listing changes.
- Same Request+Listing updates existing Match.

## Future
Semantic text/AI layer may supplement deterministic scoring after beta evidence justifies it.

---

## Source: `docs/modules/FRESHNESS.md`

# Freshness Module

## Purpose
Prevent the database from becoming a graveyard of outdated properties and requests.

## Listing states
CONFIRMED / NEEDS_VERIFICATION / STALE / INACTIVE.

## Principles
- Business status and freshness are separate concepts.
- Disappearance from one source is evidence, not proof of sale.
- Different property/transaction types may have different verification cadence.
- Bulk confirmation UX is required.
- Stale records are deprioritized/excluded from matching.

---

## Source: `docs/modules/INGESTION.md`

# Ingestion Module

## Goal
Safely ingest external listing data through source-specific adapters into a common raw pipeline.

## Pipeline
SOURCE REGISTRY → ADAPTER → RAW LISTING → PAYLOAD HASH → VALIDATION → NORMALIZATION → DELTA DETECTION → OWNER INTELLIGENCE → DEDUPE → CORE.

## Rules
- One adapter per source.
- Prefer authorized/official data access modes.
- Every source stores acquisition constraints/status.
- Raw payload is retained sufficiently to reprocess errors.
- Unchanged payload should not trigger expensive downstream work.
- Source outage must not mass-mark records inactive.
- Each source has health state and kill switch.

---

## Source: `docs/modules/OWNER_INTELLIGENCE.md`

# Owner Intelligence v1

## Goal
Estimate whether a listing is likely from an owner or professional intermediary.

## Signal families
- phone history;
- number of unique properties;
- geography/property diversity;
- text signals;
- behavior/frequency;
- cross-source activity;
- public account signals where permitted.

## Output classes
- HIGH_OWNER_CONFIDENCE
- UNCERTAIN
- HIGH_AGENT_CONFIDENCE

## Principles
- Do not use LLM as the primary classifier for every listing.
- AI may assist uncertain cases.
- Store evidence/signals and engine version.
- Do not present uncalibrated scores as exact probability.
- Precision is prioritized for Owner Feed quality.

---

## Source: `docs/modules/DEDUPLICATION.md`

# Deduplication v1

## Principle
False merge is worse than an extra duplicate.

## Pipeline
Candidate generation → exact IDs/URLs → contact signals → structured attributes → geo → image hashes → text similarity → advanced analysis if needed.

## Outputs
- duplicate candidate with evidence;
- auto-merge only at conservative high confidence;
- moderation for uncertain cases;
- explicit reject state.

## Data preservation
Original Listings are never deleted because of canonical merging. Merge history must be retained.

## Architecture review addition
A `Listing Cluster` concept may be used as an intermediate grouping where similarity is high but physical-property identity is not yet certain.

---

## Source: `docs/modules/COLLABORATION.md`

# Realtor Contact & Collaboration Flow

## MVP objective
Turn a Match into a professional action without building a full CRM or internal messenger prematurely.

## Flow
MATCH_FOUND → INTERESTED → CONTACTED → VIEWING_PLANNED/VIEWING_DONE → CLOSED_SUCCESS/CLOSED_NO_RESULT.

## Privacy boundary
The client remains protected by the demand-side realtor. A matched listing does not automatically expose the client's identity/phone. Likewise, a private owner contact is not automatically exposed to the demand-side realtor.

## Contact
Professional realtor contact may be visible according to verification and profile policy. Users may continue by phone/external messenger. The important business status is updated in İkiMetr.

## Outcome feedback
When a match fails, record a lightweight reason such as price, location, floor, repair, owner/client refusal or object unavailable. These signals can improve later ranking and product analytics.

## Post-beta expansion
If real usage shows the need: internal context-bound conversations, richer viewings, negotiation and Deal entities.

---

## Source: `docs/modules/NOTIFICATIONS.md`

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

---

## Source: `docs/modules/ADMIN_MODERATION.md`

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

---

## Source: `docs/development/DEVELOPMENT_PLAN.md`

# Development Plan v1.1

## Phase 00 — Foundation
00.01 Bootstrap repository
00.02 Database foundation
00.03 Logging & observability
00.04 Error handling
00.05 Queue infrastructure
00.06 Security foundation
00.07 Testing infrastructure
00.08 CI/CD foundation

## Phase 01 — Authentication
Identity, sessions, verification flows.

## Phase 02 — Authorization
Roles, ownership and explicit domain policies.

## Phase 03 — Realtor Profile
Professional profile, work areas and verification status.

## Phase 04 — Property Core
Property, Listing, RealtorProperty, images, price/status history.

## Phase 05 — Freshness
Verification workflows and stale handling.

## Phase 06 — Requests
Structured property demand, optional client linkage.

## Phase 07 — Deterministic Matching
Candidate generation, hard rules, explainable score.

## Phase 08 — Contact/Status Flow
Match interest, contact, viewing/status result without requiring internal chat.

## Phase 09 — Ingestion
One approved source, adapter + raw pipeline.

## Phase 10 — Owner Intelligence
Rules/signals classifier v1.

## Phase 11 — Basic Deduplication
Conservative candidate generation and moderation.

## Phase 12 — Owner Feed
Processed owner listings + filters + matching to user requests.

## Phase 13 — Admin/Moderation
Verification, duplicate review, reports, source health, security events.

## Phase 14 — Closed Beta
Small set of real realtors; measure usage and utility before expanding scope.

## Post-beta candidates
Internal chat, semantic AI matching, agency workspaces, public buyers/owners, payments, native apps.

---

## Source: `AGENTS.md`

# AGENTS.md

These rules apply to any AI coding agent working on İkiMetr.

1. Read the task specification before changing code.
2. Read only the project documents explicitly referenced by that task unless additional context is technically necessary.
3. Do not redesign unrelated modules.
4. Do not introduce new major dependencies without task justification.
5. Never weaken authorization, privacy or security rules.
6. Do not trust frontend-supplied role/ownership/user IDs.
7. Do not expose raw database models in API responses when they contain internal fields.
8. Do not commit secrets or real production credentials.
9. Add tests for every new business rule and authorization rule.
10. Run lint, typecheck, tests and production build before reporting completion.
11. Do not change architecture silently. Create/report an ADR need instead.
12. Keep scope narrow. Out-of-scope features must not be implemented “for completeness”.
13. Prefer deterministic rules before AI.
14. If blocked by a real architectural conflict, report the conflict instead of guessing.

## Required final report
TASK: <id>
STATUS: COMPLETED | BLOCKED
CHANGED: <summary>
MIGRATIONS: <none or list>
TESTS: <commands/results>
SECURITY: <relevant checks>
KNOWN ISSUES: <list>
NEXT: <next recommended task only>

---

## Source: `specs/phase-00-foundation/00.01-bootstrap.md`

# Task 00.01 — Bootstrap İkiMetr Repository

## Goal
Create an empty but production-oriented technical foundation for İkiMetr without implementing business features.

## Read first
- `AGENTS.md`
- `docs/PROJECT_CONSTITUTION.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/security/SECURITY_RULES.md`
- `docs/development/DEVELOPMENT_PLAN.md`

## Scope
Create a monorepo structure with:
- `apps/web`
- `apps/api`
- `apps/worker`
- `packages/config`
- `packages/shared`
- `packages/database`
- `packages/validation`
- `infrastructure`
- `docs`
- `specs`

Configure:
- TypeScript;
- workspace/package manager;
- linting;
- formatting;
- environment validation;
- basic testing infrastructure;
- production builds;
- local PostgreSQL and Redis dependencies through Docker;
- API health endpoint;
- worker heartbeat/health mechanism;
- CI pipeline.

## Out of scope
DO NOT IMPLEMENT:
- authentication;
- users/realtors business schema;
- properties/listings;
- requests;
- matching;
- ingestion/scraping;
- owner detection;
- AI;
- chat;
- payments;
- final UI design system.

## Architecture requirements
- Next.js web app.
- Fastify TypeScript API.
- Separate worker app/process.
- PostgreSQL + PostGIS-compatible foundation.
- Redis-ready queue/cache foundation.
- No microservices/Kubernetes.

## Security requirements
- No secrets in Git.
- Provide `.env.example` only.
- Fail fast on missing required production configuration.
- Do not log secrets.
- CI must include basic security/dependency checks where reasonable.

## API requirement
`GET /health` returns a stable health response and does not expose secrets or internal stack traces.

## Definition of Done
- clean install succeeds;
- web starts;
- api starts;
- worker starts;
- `/health` works;
- PostgreSQL connection works;
- Redis connection works;
- environment validation works;
- lint passes;
- typecheck passes;
- tests pass;
- production build passes;
- Docker local environment works;
- CI is configured;
- no secrets committed;
- README explains local setup.

## Final report format
Use the report format defined in `AGENTS.md`.

---

## Source: `docs/architecture/ADR/ADR-001-modular-monolith.md`

# ADR-001 — Modular Monolith First

## Decision
MVP uses one modular backend application with separate worker processes instead of multiple independently deployed microservices.

## Reason
Lower DevOps cost, easier transactions, simpler debugging and lower AI-agent context complexity while preserving clean module boundaries.

## Consequence
Modules must not bypass public domain interfaces arbitrarily. High-load modules may be extracted later without changing product semantics.

---

## Source: `docs/architecture/ADR/ADR-002-postgresql-source-of-truth.md`

# ADR-002 — PostgreSQL as Source of Truth

## Decision
PostgreSQL stores all core business state. Redis/search/cache are rebuildable derivatives.

## Reason
Strong transactions, relational integrity, PostGIS capability and simplified recovery model.

---

## Source: `docs/architecture/ADR/ADR-003-rules-before-ai.md`

# ADR-003 — Rules Before AI

## Decision
Deterministic code, rules, SQL, hashes and statistical signals are applied before LLM/vision usage.

## Reason
Lower cost, better explainability, deterministic testing and reduced attack surface.
