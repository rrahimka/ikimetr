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
