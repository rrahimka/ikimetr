import { z } from 'zod';

import { ConfigValidationError } from './errors.js';

export const configurationFileNames = [
  'router.json',
  'providers.json',
  'budgets.json',
  'pricing.json',
  'verification.json',
] as const;

const providerIds = [
  'local-ai',
  'deepseek',
  'qwen',
  'codex',
  'claude',
] as const;
type ProviderId = (typeof providerIds)[number];
export type { ProviderId };

export const riskClasses = [
  'low',
  'standard',
  'high',
  'security-critical',
] as const;
export type RiskClass = (typeof riskClasses)[number];

export const capabilityIds = [
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
  'routine-analysis',
  'routine-implementation',
  'documentation',
  'test-generation',
  'low-risk-refactor',
  'complex-implementation',
  'complex-debugging',
  'architecture-review',
  'security-review',
] as const;
export type CapabilityId = (typeof capabilityIds)[number];

const schemaVersion = z.literal(1);
const configVersion = z.string().regex(/^\d+\.\d+\.\d+$/u);
const nullablePositiveInteger = z.number().int().positive().safe().nullable();
const nullableNonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .nullable();
const envVariableName = z.string().regex(/^[A-Z][A-Z0-9_]*$/u).nullable();

const moneyLimitSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    amountMicros: z.number().int().nonnegative().safe(),
  })
  .strict();

const retryPolicySchema = z
  .object({
    maxRetries: nullableNonNegativeInteger,
    retryOn: z
      .array(z.enum(['timeout', 'rate-limit', 'server-error']))
      .max(3),
    backoff: z.enum(['none', 'fixed', 'exponential']),
  })
  .strict();

const endpointSchema = z
  .object({
    type: z.enum([
      'ollama',
      'openai-compatible',
      'managed-api',
      'agent-session',
    ]),
    baseUrlEnv: envVariableName,
    credentialEnv: envVariableName,
  })
  .strict();
type EndpointType = z.infer<typeof endpointSchema>['type'];

const allowedRiskClassesSchema = z
  .array(z.enum(riskClasses))
  .superRefine(rejectDuplicateEnumValues);
const allowedCapabilitiesSchema = z
  .array(z.enum(capabilityIds))
  .superRefine(rejectDuplicateEnumValues);

const providerSchema = z
  .object({
    enabled: z.boolean(),
    role: z.enum([
      'local-first-pass',
      'routine-implementer',
      'primary-development-coordinator',
      'specialist-reviewer',
    ]),
    model: z.string().min(1).nullable(),
    invocationMode: z.enum(['automatic', 'manual-handoff']),
    endpoint: endpointSchema,
    allowedDataClasses: z
      .array(z.enum(['public', 'internal', 'sensitive']))
      .min(1),
    allowedRiskClasses: allowedRiskClassesSchema,
    allowedCapabilities: allowedCapabilitiesSchema,
    maxInputTokens: nullablePositiveInteger,
    maxOutputTokens: nullablePositiveInteger,
    maxCallsPerTask: nullablePositiveInteger,
    maxCostPerTask: moneyLimitSchema.nullable(),
    timeoutMs: nullablePositiveInteger,
    retryPolicy: retryPolicySchema,
  })
  .strict()
  .superRefine((provider, context) => {
    if (
      provider.enabled &&
      (provider.model === null ||
        provider.maxInputTokens === null ||
        provider.maxOutputTokens === null ||
        provider.maxCallsPerTask === null ||
        provider.maxCostPerTask === null ||
        provider.timeoutMs === null ||
        provider.retryPolicy.maxRetries === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'enabled provider is not fully configured',
      });
    }
  });

const routerSchema = z
  .object({
    schemaVersion,
    configVersion,
    policyVersion: configVersion,
    routes: z
      .object({
        deterministic: z
          .object({
            providers: z.tuple([]),
            approvalRequired: z.boolean(),
          })
          .strict(),
        local: z
          .object({
            providers: z.tuple([z.literal('local-ai')]),
            approvalRequired: z.boolean(),
          })
          .strict(),
        'cheap-cloud': z
          .object({
            providers: z.tuple([
              z.literal('deepseek'),
              z.literal('qwen'),
            ]),
            approvalRequired: z.boolean(),
          })
          .strict(),
        strong: z
          .object({
            providers: z.tuple([
              z.literal('codex'),
              z.literal('claude'),
            ]),
            approvalRequired: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const providersSchema = z
  .object({
    schemaVersion,
    configVersion,
    providers: z
      .object({
        'local-ai': providerSchema,
        deepseek: providerSchema,
        qwen: providerSchema,
        codex: providerSchema,
        claude: providerSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const { providers } = configuration;
    const endpointChecks: ReadonlyArray<
      readonly [ProviderId, readonly EndpointType[]]
    > = [
      ['local-ai', ['ollama', 'openai-compatible']],
      ['deepseek', ['openai-compatible', 'managed-api']],
      ['qwen', ['openai-compatible', 'managed-api']],
      ['codex', ['agent-session', 'managed-api']],
      ['claude', ['agent-session', 'managed-api']],
    ] as const;

    for (const [providerId, endpointTypes] of endpointChecks) {
      if (!endpointTypes.includes(providers[providerId].endpoint.type)) {
        context.addIssue({
          code: 'custom',
          path: ['providers', providerId, 'endpoint', 'type'],
          message: 'endpoint type is not allowed for provider',
        });
      }
    }

    if (
      providers['local-ai'].role !== 'local-first-pass' ||
      providers.deepseek.role !== 'routine-implementer' ||
      providers.qwen.role !== 'routine-implementer' ||
      providers.codex.role !== 'primary-development-coordinator' ||
      providers.claude.role !== 'specialist-reviewer'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'provider role does not match the approved routing policy',
      });
    }

    for (const providerId of ['local-ai', 'deepseek', 'qwen'] as const) {
      const provider = providers[providerId];
      if (provider.invocationMode !== 'automatic') {
        context.addIssue({
          code: 'custom',
          path: ['providers', providerId, 'invocationMode'],
          message: 'automatic provider has invalid invocation mode',
        });
      }
      if (provider.enabled && provider.endpoint.baseUrlEnv === null) {
        context.addIssue({
          code: 'custom',
          path: ['providers', providerId, 'endpoint', 'baseUrlEnv'],
          message: 'enabled provider is not fully configured',
        });
      }
    }

    for (const providerId of ['deepseek', 'qwen'] as const) {
      if (
        providers[providerId].enabled &&
        providers[providerId].endpoint.credentialEnv === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['providers', providerId, 'endpoint', 'credentialEnv'],
          message: 'enabled provider is not fully configured',
        });
      }
    }
  });

const scopedBudgetSchema = z
  .object({
    maxInputTokens: nullablePositiveInteger,
    maxOutputTokens: nullablePositiveInteger,
    maxCalls: nullablePositiveInteger,
    maxCost: moneyLimitSchema.nullable(),
  })
  .strict();

const budgetsSchema = z
  .object({
    schemaVersion,
    configVersion,
    defaultBudgetClass: z.enum([
      'NONE',
      'LOCAL_ONLY',
      'CHEAP_ALLOWED',
      'STRONG_ALLOWED',
      'INCIDENT_OVERRIDE',
    ]),
    limits: z
      .object({
        perTask: scopedBudgetSchema,
        providerTask: scopedBudgetSchema,
        cloudCallsTask: z
          .object({ maxCalls: nullablePositiveInteger })
          .strict(),
        providerDay: scopedBudgetSchema,
        cloudDay: scopedBudgetSchema,
        providerMonth: scopedBudgetSchema,
        cloudMonth: scopedBudgetSchema,
        retryLimits: z
          .object({
            maxRetriesPerTask: nullableNonNegativeInteger,
            maxRetriesPerProviderTask: nullableNonNegativeInteger,
          })
          .strict(),
        localWallTime: z
          .object({ maxMillisecondsPerTask: nullablePositiveInteger })
          .strict(),
      })
      .strict(),
  })
  .strict();

const pricingSnapshotSchema = z
  .object({
    provider: z.enum(providerIds),
    model: z.string().min(1).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
    inputRatePerMillionTokens: nullableNonNegativeInteger,
    outputRatePerMillionTokens: nullableNonNegativeInteger,
    cacheReadRatePerMillionTokens: nullableNonNegativeInteger,
    cacheWriteRatePerMillionTokens: nullableNonNegativeInteger,
    effectiveAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime().nullable(),
    source: z.string().min(1).nullable(),
    status: z.enum(['known', 'stale', 'unknown']),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.status === 'unknown' &&
      (snapshot.model !== null ||
        snapshot.currency !== null ||
        snapshot.inputRatePerMillionTokens !== null ||
        snapshot.outputRatePerMillionTokens !== null ||
        snapshot.cacheReadRatePerMillionTokens !== null ||
        snapshot.cacheWriteRatePerMillionTokens !== null ||
        snapshot.effectiveAt !== null ||
        snapshot.retrievedAt !== null ||
        snapshot.source !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'unknown pricing must not contain fabricated values',
      });
    }

    if (
      snapshot.status !== 'unknown' &&
      (snapshot.model === null ||
        snapshot.currency === null ||
        snapshot.inputRatePerMillionTokens === null ||
        snapshot.outputRatePerMillionTokens === null ||
        snapshot.effectiveAt === null ||
        snapshot.retrievedAt === null ||
        snapshot.source === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'known or stale pricing snapshot is incomplete',
      });
    }
  });

const pricingSchema = z
  .object({
    schemaVersion,
    configVersion,
    pricingVersion: z.string().min(1),
    snapshots: z.array(pricingSnapshotSchema).length(providerIds.length),
  })
  .strict()
  .superRefine((configuration, context) => {
    const configuredProviders = new Set(
      configuration.snapshots.map(({ provider }) => provider),
    );
    if (
      configuredProviders.size !== providerIds.length ||
      providerIds.some((providerId) => !configuredProviders.has(providerId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: 'pricing must contain exactly one snapshot per provider',
      });
    }
  });

const verificationCommandSchema = z
  .object({
    enabled: z.boolean(),
    executable: z.string().min(1).nullable(),
    args: z.array(z.string()),
    optional: z.boolean(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.enabled && command.executable === null) {
      context.addIssue({
        code: 'custom',
        message: 'enabled verification command requires an executable',
      });
    }
  });

const verificationSchema = z
  .object({
    schemaVersion,
    configVersion,
    allowModelCommands: z.literal(false),
    commands: z
      .object({
        lint: verificationCommandSchema,
        typecheck: verificationCommandSchema,
        unit: verificationCommandSchema,
        integration: verificationCommandSchema,
        build: verificationCommandSchema,
        playwright: verificationCommandSchema,
      })
      .strict(),
    pipeline: z.tuple([
      z.literal('lint'),
      z.literal('typecheck'),
      z.literal('unit'),
      z.literal('integration'),
      z.literal('build'),
    ]),
    optionalStages: z.tuple([z.literal('playwright')]),
  })
  .strict()
  .superRefine((configuration, context) => {
    const commandExpectations = {
      lint: ['lint'],
      typecheck: ['typecheck'],
      unit: ['test:unit'],
      integration: ['test:integration'],
      build: ['build'],
    } as const;

    for (const [commandId, args] of Object.entries(commandExpectations)) {
      const command = configuration.commands[
        commandId as keyof typeof commandExpectations
      ];
      if (
        !command.enabled ||
        command.optional ||
        command.executable !== 'pnpm' ||
        command.args.length !== 1 ||
        command.args[0] !== args[0]
      ) {
        context.addIssue({
          code: 'custom',
          path: ['commands', commandId],
          message: 'required command does not match the project allowlist',
        });
      }
    }

    const playwright = configuration.commands.playwright;
    if (
      playwright.enabled ||
      playwright.executable !== null ||
      playwright.args.length !== 0 ||
      !playwright.optional
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commands', 'playwright'],
        message: 'Playwright must remain an unconfigured optional stage',
      });
    }
  });

const configurationSchemas = {
  'router.json': routerSchema,
  'providers.json': providersSchema,
  'budgets.json': budgetsSchema,
  'pricing.json': pricingSchema,
  'verification.json': verificationSchema,
} as const;

export interface ConfigurationBundle {
  readonly router: z.infer<typeof routerSchema>;
  readonly providers: z.infer<typeof providersSchema>;
  readonly budgets: z.infer<typeof budgetsSchema>;
  readonly pricing: z.infer<typeof pricingSchema>;
  readonly verification: z.infer<typeof verificationSchema>;
}

export function validateConfigurationFiles(
  rawFiles: Readonly<Record<(typeof configurationFileNames)[number], unknown>>,
): ConfigurationBundle {
  const parsed: ConfigurationBundle = {
    router: parseConfiguration(
      'router.json',
      configurationSchemas['router.json'],
      rawFiles['router.json'],
    ),
    providers: parseConfiguration(
      'providers.json',
      configurationSchemas['providers.json'],
      rawFiles['providers.json'],
    ),
    budgets: parseConfiguration(
      'budgets.json',
      configurationSchemas['budgets.json'],
      rawFiles['budgets.json'],
    ),
    pricing: parseConfiguration(
      'pricing.json',
      configurationSchemas['pricing.json'],
      rawFiles['pricing.json'],
    ),
    verification: parseConfiguration(
      'verification.json',
      configurationSchemas['verification.json'],
      rawFiles['verification.json'],
    ),
  };

  const versions = [
    parsed.router.configVersion,
    parsed.providers.configVersion,
    parsed.budgets.configVersion,
    parsed.pricing.configVersion,
    parsed.verification.configVersion,
  ];
  if (new Set(versions).size !== 1) {
    throw new ConfigValidationError(
      'All AI cost configuration files must use the same configVersion',
    );
  }

  return parsed;
}

function parseConfiguration<T>(
  fileName: (typeof configurationFileNames)[number],
  schema: z.ZodType<T>,
  rawValue: unknown,
): T {
  const result = schema.safeParse(rawValue);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    });
    throw new ConfigValidationError(
      `Invalid configuration in ${fileName}: ${issues.join('; ')}`,
    );
  }
  return result.data;
}

function rejectDuplicateEnumValues(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: 'custom',
      message: 'allowlist values must be unique',
    });
  }
}
