import {
  createCodexProvider,
  type LocalAgentProviderAdapter,
  type LocalAgentProviderPlugin,
  type ProviderLaunchPlan,
} from '@tutti-os/agent-acp-kit';

const DISABLED_CODEX_TOOL_FEATURES = [
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
] as const;

const CODEX_USER_CONFIG_ISOLATION_ARGS = [
  ...DISABLED_CODEX_TOOL_FEATURES.flatMap((feature) => ['--disable', feature]),
] as const;

export function createVibeCodexProvider(): LocalAgentProviderPlugin<'local-agent', 'codex'> {
  const provider = createCodexProvider();

  return {
    ...provider,
    createAdapter() {
      const adapter = provider.createAdapter?.();
      if (!adapter) {
        throw new Error('Codex provider adapter is unavailable.');
      }

      return {
        ...adapter,
        async buildLaunchPlan(params) {
          return isolateCodexLaunchPlan(await adapter.buildLaunchPlan(params));
        },
      } satisfies LocalAgentProviderAdapter<'local-agent', 'codex'>;
    },
    async buildLaunchPlan(params) {
      return isolateCodexLaunchPlan(await provider.buildLaunchPlan(params));
    },
  };
}

function isolateCodexLaunchPlan(plan: ProviderLaunchPlan): ProviderLaunchPlan {
  return {
    ...plan,
    args: insertCodexIsolationArgs(plan.args),
  };
}

function insertCodexIsolationArgs(args: string[]): string[] {
  const insertionIndex = args[0] === 'exec' && args[1] === 'resume' ? 3 : 2;
  const filteredArgs = args.filter((arg, index) => {
    if (arg === '--ignore-user-config') return false;
    if (arg === '--disable' && isDisabledCodexToolFeature(args[index + 1])) return false;
    if (isDisabledCodexToolFeature(arg) && args[index - 1] === '--disable') return false;
    return true;
  });

  return [
    ...filteredArgs.slice(0, insertionIndex),
    ...CODEX_USER_CONFIG_ISOLATION_ARGS,
    ...filteredArgs.slice(insertionIndex),
  ];
}

function isDisabledCodexToolFeature(value: string | undefined): boolean {
  return DISABLED_CODEX_TOOL_FEATURES.includes(value as (typeof DISABLED_CODEX_TOOL_FEATURES)[number]);
}
