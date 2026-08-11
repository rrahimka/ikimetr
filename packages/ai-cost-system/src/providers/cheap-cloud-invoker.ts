import type { RoutingDecision } from '../routing-contracts.js';
import type { DeepSeekAdapter } from './deepseek-adapter.js';

type DeepSeekInvoker = Pick<DeepSeekAdapter, 'invoke'>;

export type CheapCloudInvokeStatus = 'success' | 'denied' | 'failed';

export interface CheapCloudInvokeSuccess {
  readonly status: 'success';
  readonly result: Awaited<ReturnType<DeepSeekAdapter['invoke']>>;
}

export interface CheapCloudInvokeDenied {
  readonly status: 'denied';
  readonly reason: string;
}

export interface CheapCloudInvokeFailed {
  readonly status: 'failed';
  readonly reason: string;
  readonly errorCode: string | null;
}

export type CheapCloudInvokeResult =
  | CheapCloudInvokeSuccess
  | CheapCloudInvokeDenied
  | CheapCloudInvokeFailed;

export class CheapCloudInvoker {
  public async invoke(
    decision: RoutingDecision,
    adapter: DeepSeekInvoker,
    params: Parameters<DeepSeekAdapter['invoke']>[0],
  ): Promise<CheapCloudInvokeResult> {
    if (
      decision.decision !== 'CHEAP_CLOUD' ||
      decision.provider_candidate !== 'deepseek'
    ) {
      return Object.freeze({
        status: 'denied' as const,
        reason: `Cannot invoke: decision ${decision.decision} / provider ${decision.provider_candidate ?? 'none'}`,
      });
    }

    try {
      const result = await adapter.invoke(params);
      return Object.freeze({
        status: 'success' as const,
        result,
      });
    } catch (error) {
      const errorCode =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : null;
      return Object.freeze({
        status: 'failed' as const,
        reason:
          error instanceof Error ? error.message : 'Unknown adapter error',
        errorCode,
      });
    }
  }
}
