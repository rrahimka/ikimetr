import type { RoutingDecision } from './routing-contracts.js';
import type { CostRouter } from './cost-router.js';
import type { CheapCloudInvoker } from './providers/cheap-cloud-invoker.js';
import type { ExecutionCoordinator } from './providers/execution-coordinator.js';
import type { LocalInvoker } from './providers/local-invoker.js';

type AiExecutorResult =
  | RoutingDecision
  | Awaited<ReturnType<ExecutionCoordinator['execute']>>;

export class AiExecutor {
  private readonly router: Pick<CostRouter, 'evaluate'>;
  private readonly coordinator: Pick<ExecutionCoordinator, 'execute'>;
  private readonly localAdapter: Parameters<LocalInvoker['invoke']>[1];
  private readonly cheapCloudAdapter: Parameters<CheapCloudInvoker['invoke']>[1];

  public constructor(deps: {
    readonly router: Pick<CostRouter, 'evaluate'>;
    readonly coordinator: Pick<ExecutionCoordinator, 'execute'>;
    readonly localAdapter: Parameters<LocalInvoker['invoke']>[1];
    readonly cheapCloudAdapter: Parameters<CheapCloudInvoker['invoke']>[1];
  }) {
    this.router = deps.router;
    this.coordinator = deps.coordinator;
    this.localAdapter = deps.localAdapter;
    this.cheapCloudAdapter = deps.cheapCloudAdapter;
  }

  public async execute(
    routingRequest: unknown,
    routingContext: unknown,
    invokeParams: Parameters<LocalInvoker['invoke']>[2],
  ): Promise<AiExecutorResult> {
    const decision = await this.router.evaluate(routingRequest, routingContext);

    if (decision.decision === 'LOCAL') {
      return this.coordinator.execute({
        route: 'local',
        decision,
        adapter: this.localAdapter,
        params: invokeParams,
      });
    }

    if (decision.decision === 'CHEAP_CLOUD') {
      return this.coordinator.execute({
        route: 'cheap-cloud',
        decision,
        adapter: this.cheapCloudAdapter,
        params: invokeParams,
      });
    }

    return decision;
  }
}
