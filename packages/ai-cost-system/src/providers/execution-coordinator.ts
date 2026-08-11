import type { RoutingDecision } from '../routing-contracts.js';
import type { CheapCloudInvoker } from './cheap-cloud-invoker.js';
import type { LocalInvoker } from './local-invoker.js';

export interface ExecutionUnsupported {
  readonly status: 'unsupported';
  readonly reason: string;
}

export interface ExecutionDenied {
  readonly status: 'denied';
  readonly reason: string;
}

export type ExecutionCoordinatorResult =
  | Awaited<ReturnType<LocalInvoker['invoke']>>
  | Awaited<ReturnType<CheapCloudInvoker['invoke']>>
  | ExecutionUnsupported
  | ExecutionDenied;

interface LocalExecuteInput {
  readonly route: 'local';
  readonly decision: RoutingDecision;
  readonly adapter: Parameters<LocalInvoker['invoke']>[1];
  readonly params: Parameters<LocalInvoker['invoke']>[2];
}

interface CheapCloudExecuteInput {
  readonly route: 'cheap-cloud';
  readonly decision: RoutingDecision;
  readonly adapter: Parameters<CheapCloudInvoker['invoke']>[1];
  readonly params: Parameters<CheapCloudInvoker['invoke']>[2];
}

interface NoneExecuteInput {
  readonly route: 'none';
  readonly decision: RoutingDecision;
}

type ExecuteInput = LocalExecuteInput | CheapCloudExecuteInput | NoneExecuteInput;

export class ExecutionCoordinator {
  private readonly localInvoker: Pick<LocalInvoker, 'invoke'>;
  private readonly cheapCloudInvoker: Pick<CheapCloudInvoker, 'invoke'>;

  public constructor(deps: {
    readonly localInvoker: Pick<LocalInvoker, 'invoke'>;
    readonly cheapCloudInvoker: Pick<CheapCloudInvoker, 'invoke'>;
  }) {
    this.localInvoker = deps.localInvoker;
    this.cheapCloudInvoker = deps.cheapCloudInvoker;
  }

  public async execute(input: ExecuteInput): Promise<ExecutionCoordinatorResult> {
    const { route, decision } = input;

    if (
      route === 'local' &&
      decision.decision === 'LOCAL' &&
      decision.route === 'local' &&
      decision.provider_candidate === 'local-ai'
    ) {
      return this.localInvoker.invoke(
        input.decision,
        input.adapter,
        input.params,
      );
    }

    if (
      route === 'cheap-cloud' &&
      decision.decision === 'CHEAP_CLOUD' &&
      decision.route === 'cheap-cloud' &&
      decision.provider_candidate === 'deepseek'
    ) {
      return this.cheapCloudInvoker.invoke(
        input.decision,
        input.adapter,
        input.params,
      );
    }

    if (
      decision.decision === 'STOP' ||
      decision.decision === 'STRONG' ||
      route === 'none'
    ) {
      return Object.freeze({
        status: 'unsupported' as const,
        reason: `No executor for route '${route}' / decision '${decision.decision}'`,
      });
    }

    return Object.freeze({
      status: 'denied' as const,
      reason: `Cannot execute: route ${route} / decision ${decision.decision} / provider ${decision.provider_candidate ?? 'none'}`,
    });
  }
}
