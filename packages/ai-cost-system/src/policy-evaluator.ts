import { canonicalize, sha256 } from './canonical.js';
import {
  hashTaskRoutingRequest,
  parseRoutingDecision,
  parseRoutingDecisionDraft,
  routeRank,
  routingReasonSummary,
  type RoutingDecision,
  type RoutingDecisionDraft,
  type RoutingRoute,
  type TaskRoutingRequest,
} from './routing-contracts.js';
import type { ProviderId } from './schemas.js';
import type { ConfigSnapshot } from './snapshot.js';

const deterministicCapabilities = new Set([
  'exact-comparison',
  'hashing',
  'formatting',
  'schema-validation',
  'verification-result-interpretation',
  'exact-sql',
  'regex',
  'file-lookup',
  'serena-navigation',
  'deduplication',
  'config-validation',
]);

export interface PolicyResult {
  readonly allowed: boolean;
  readonly reason_code:
    | 'ROUTE_ALLOWED'
    | 'ROUTE_NOT_ALLOWED'
    | 'MAX_ROUTE_EXCEEDED'
    | 'PROVIDER_DISABLED'
    | 'DATA_CLASS_DENIED'
    | 'RISK_CLASS_DENIED'
    | 'CAPABILITY_DENIED'
    | 'LOCAL_TASK_NOT_ALLOWED'
    | 'DATA_POLICY_ALLOWED';
}

const localAiWhitelist = new Set([
  'classification',
  'short_documentation',
  'tiny_typescript',
  'simple_test_skeleton',
  'trivial_local_fix',
]);

export class PolicyEvaluator {
  public constructor(private readonly config: ConfigSnapshot) {}

  public isDeterministicCapability(request: TaskRoutingRequest): boolean {
    return deterministicCapabilities.has(request.requested_capability);
  }

  public evaluateRoutePolicy(
    request: TaskRoutingRequest,
    route: RoutingRoute,
  ): PolicyResult {
    if (!request.allowed_routes.includes(route)) {
      return Object.freeze({
        allowed: false,
        reason_code: 'ROUTE_NOT_ALLOWED' as const,
      });
    }
    if (routeRank(route) > routeRank(request.max_route)) {
      return Object.freeze({
        allowed: false,
        reason_code: 'MAX_ROUTE_EXCEEDED' as const,
      });
    }
    return Object.freeze({
      allowed: true,
      reason_code: 'ROUTE_ALLOWED' as const,
    });
  }

  public evaluateProviderPolicy(
    request: TaskRoutingRequest,
    providerId: ProviderId,
  ): PolicyResult {
    const provider =
      this.config.configuration.providers.providers[providerId];
    if (!provider.enabled) {
      return Object.freeze({
        allowed: false,
        reason_code: 'PROVIDER_DISABLED' as const,
      });
    }
    if (
      request.data_class === 'secret' ||
      !provider.allowedDataClasses.includes(request.data_class)
    ) {
      return Object.freeze({
        allowed: false,
        reason_code: 'DATA_CLASS_DENIED' as const,
      });
    }
    if (providerId === 'local-ai' && request.data_class !== 'public') {
      return Object.freeze({
        allowed: false,
        reason_code: 'DATA_CLASS_DENIED' as const,
      });
    }
    if (!provider.allowedRiskClasses.includes(request.risk_class)) {
      return Object.freeze({
        allowed: false,
        reason_code: 'RISK_CLASS_DENIED' as const,
      });
    }
    if (providerId === 'local-ai' && request.risk_class !== 'low') {
      return Object.freeze({
        allowed: false,
        reason_code: 'RISK_CLASS_DENIED' as const,
      });
    }
    if (!provider.allowedCapabilities.includes(request.requested_capability)) {
      return Object.freeze({
        allowed: false,
        reason_code: 'CAPABILITY_DENIED' as const,
      });
    }
    if (
      providerId === 'local-ai' &&
      !localAiWhitelist.has(request.purpose)
    ) {
      return Object.freeze({
        allowed: false,
        reason_code: 'LOCAL_TASK_NOT_ALLOWED' as const,
      });
    }
    return Object.freeze({
      allowed: true,
      reason_code: 'DATA_POLICY_ALLOWED' as const,
    });
  }

  public createDecision(
    request: TaskRoutingRequest,
    value: RoutingDecisionDraft,
  ): RoutingDecision {
    return createRoutingDecision(request, value, this.config.configHash);
  }
}

export function createRoutingDecision(
  request: TaskRoutingRequest,
  value: RoutingDecisionDraft,
  configHash: string,
): RoutingDecision {
    const draft = parseRoutingDecisionDraft(value);
    const withoutHash = {
      ...draft,
      reason_summary: routingReasonSummary(draft.reason_code),
      config_hash: configHash,
      request_hash: hashTaskRoutingRequest(request),
    };
    return parseRoutingDecision({
      ...withoutHash,
      decision_hash: sha256(canonicalize(withoutHash)),
    });
}
