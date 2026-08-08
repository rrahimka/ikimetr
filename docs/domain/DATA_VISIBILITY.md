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
