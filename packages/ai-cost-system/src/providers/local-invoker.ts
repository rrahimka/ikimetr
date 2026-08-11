import type { RoutingDecision } from '../routing-contracts.js';
import type {
  InvokeParams,
  InvokeResult,
  OllamaAdapter,
} from './ollama-adapter.js';

export type LocalInvokeStatus =
  | 'success'
  | 'denied'
  | 'failed';

export interface LocalInvokeSuccess {
  readonly status: 'success';
  readonly result: InvokeResult;
}

export interface LocalInvokeDenied {
  readonly status: 'denied';
  readonly reason: string;
}

export interface LocalInvokeFailed {
  readonly status: 'failed';
  readonly reason: string;
  readonly errorCode: string | null;
}

export type LocalInvokeResult =
  | LocalInvokeSuccess
  | LocalInvokeDenied
  | LocalInvokeFailed;

export class LocalInvoker {
  public async invoke(
    decision: RoutingDecision,
    adapter: Pick<OllamaAdapter, 'invoke'>,
    params: InvokeParams,
  ): Promise<LocalInvokeResult> {
    if (
      decision.decision !== 'LOCAL' ||
      decision.provider_candidate !== 'local-ai'
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
        error instanceof Error && 'code' in error
          ? (error as { code: string }).code
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
