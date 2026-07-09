import type { TuttiAgentProviderCatalogModel } from "./tutti-daemon-client.js";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function flattenRawSettingOptions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const flattened: unknown[] = [];
  for (const item of value) {
    const record = toRecord(item);
    if (Array.isArray(record?.options)) {
      flattened.push(...flattenRawSettingOptions(record.options));
    } else {
      flattened.push(item);
    }
  }
  return flattened;
}

function settingOptionsFromRawOptions(
  value: unknown,
  keys: { labelKeys: readonly string[]; valueKeys: readonly string[] },
): TuttiAgentProviderCatalogModel[] {
  const options: TuttiAgentProviderCatalogModel[] = [];
  const seen = new Set<string>();
  for (const item of flattenRawSettingOptions(value)) {
    const record = toRecord(item);
    if (!record) continue;
    const id =
      keys.valueKeys.map((key) => readString(record[key])).find(Boolean)
      ?? readString(record.value)
      ?? readString(record.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      keys.labelKeys.map((key) => readString(record[key])).find(Boolean)
      ?? id;
    const description = readString(record.description);
    options.push({
      id,
      label,
      ...(description ? { description } : {}),
    });
  }
  return options;
}

function settingOptionsFromComposerConfig(config: Record<string, unknown>): TuttiAgentProviderCatalogModel[] {
  const options = settingOptionsFromRawOptions(config.options, {
    labelKeys: ["label", "name", "displayName"],
    valueKeys: ["value", "id"],
  });
  const currentValue = readString(config.currentValue ?? config.current_value ?? config.defaultValue);
  if (!currentValue || options.some((option) => option.id === currentValue)) {
    return options;
  }
  return [...options, { id: currentValue, label: currentValue }];
}

function settingOptionsFromConfigOption(
  rawConfigOptions: unknown[],
  ids: readonly string[],
): TuttiAgentProviderCatalogModel[] {
  const idSet = new Set(ids);
  const configOption =
    rawConfigOptions
      .map((item) => toRecord(item))
      .find((option) => {
        const id = readString(option?.id);
        return id ? idSet.has(id) : false;
      }) ?? null;
  if (!configOption) return [];
  const options = settingOptionsFromRawOptions(configOption.options, {
    labelKeys: ["name", "label", "displayName"],
    valueKeys: ["value", "id"],
  });
  const currentValue = readString(configOption.currentValue ?? configOption.current_value);
  if (!currentValue || options.some((option) => option.id === currentValue)) {
    return options;
  }
  return [...options, { id: currentValue, label: currentValue }];
}

export function modelsFromTuttiComposerOptions(value: unknown): {
  models: TuttiAgentProviderCatalogModel[];
  defaultModelId?: string;
} {
  const result = toRecord(value) ?? {};
  const runtimeContext = toRecord(result.runtimeContext) ?? {};
  const rawConfigOptions = Array.isArray(runtimeContext.configOptions)
    ? runtimeContext.configOptions
    : [];
  const modelConfig = toRecord(result.modelConfig) ?? {};
  const modelsFromConfig = settingOptionsFromComposerConfig(modelConfig);
  const modelsFromLiveConfig = settingOptionsFromConfigOption(rawConfigOptions, ["model"]);
  const models = modelsFromLiveConfig.length > 0 ? modelsFromLiveConfig : modelsFromConfig;
  const defaultModelId =
    readString(modelConfig.currentValue)
    ?? readString(modelConfig.current_value)
    ?? readString(modelConfig.defaultValue)
    ?? models[0]?.id;
  return {
    models,
    ...(defaultModelId ? { defaultModelId } : {}),
  };
}
