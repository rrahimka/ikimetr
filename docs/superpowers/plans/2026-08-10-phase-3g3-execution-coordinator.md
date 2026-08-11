# Phase 3G.3 — Execution Coordinator Implementation Plan

> Для выполнения: идти строго по шагам, без subagents и без расширения scope.

**Цель:** добавить минимальный `ExecutionCoordinator`, который получает уже готовый `RoutingDecision` и направляет выполнение либо в `LocalInvoker`, либо в `CheapCloudInvoker`, не меняя решение роутера.

**Архитектура:** `CostRouter` остаётся decision-only. `ExecutionCoordinator` получает `LocalInvoker` и `CheapCloudInvoker` через constructor injection, сам их не создаёт. При вызове coordinator получает готовый `RoutingDecision`, соответствующий adapter и параметры исполнения и вызывает только разрешённую ветку.

**Стек:** TypeScript 6, Vitest 4, существующие `RoutingDecision`, `LocalInvoker`, `CheapCloudInvoker`, `OllamaAdapter`, `DeepSeekAdapter`.

## Глобальные ограничения

- Не менять `CostRouter`.
- Не менять `LocalInvoker`.
- Не менять `CheapCloudInvoker`.
- Не менять `OllamaAdapter`.
- Не менять `DeepSeekAdapter`.
- Не менять budget.
- Не менять ledger.
- Не менять policy.
- Не менять config.
- Не менять routing contracts.
- Не добавлять зависимости.
- Не делать retry.
- Не делать fallback.
- Не делать provider reselection.
- Не делать network/fetch внутри Coordinator.
- Не читать API keys.
- Не использовать subagents.
- Не делать git commit без явного разрешения пользователя.

---

# Файлы

## Создать

`packages/ai-cost-system/src/providers/execution-coordinator.ts`

Ответственность:
получить готовый `RoutingDecision` и безопасно передать выполнение в соответствующий invoker.

## Создать

`packages/ai-cost-system/test/execution-coordinator.test.ts`

Ответственность:
проверить маршрутизацию исполнения, exactly-once, zero-call, no retry, no fallback.

## Изменить

`packages/ai-cost-system/src/index.ts`

Только exports нового Coordinator и его public types.

---

# Task 1 — Написать failing tests

## Разрешено читать

- `AGENTS.md`
- `packages/ai-cost-system/src/providers/local-invoker.ts`
- `packages/ai-cost-system/src/providers/cheap-cloud-invoker.ts`
- `packages/ai-cost-system/test/local-invoker.test.ts`
- `packages/ai-cost-system/test/cheap-cloud-invoker.test.ts`
- `packages/ai-cost-system/src/providers/ollama-adapter.ts`
- `packages/ai-cost-system/src/providers/deepseek-adapter.ts`
- `packages/ai-cost-system/src/routing-contracts.ts`
- `packages/ai-cost-system/src/index.ts`

## Создать только

`packages/ai-cost-system/test/execution-coordinator.test.ts`

Production-код пока не создавать.

## Тестовая модель

Coordinator должен получать invoker'ы через constructor injection.

Предпочтительный public shape:

```ts
const coordinator = new ExecutionCoordinator({
  localInvoker,
  cheapCloudInvoker,
});