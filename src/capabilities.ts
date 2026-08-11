export interface CapabilityDefinition {
  description: string;
  examples: readonly string[];
}

export type CapabilityCatalog = Record<string, CapabilityDefinition>;

export function defineCapabilityCatalog<const T extends CapabilityCatalog>(catalog: T): T {
  return catalog;
}

export function capabilityKinds<T extends CapabilityCatalog>(catalog: T): (keyof T & string)[] {
  return Object.keys(catalog) as (keyof T & string)[];
}

export function renderCapabilityPrompt<T extends CapabilityCatalog>(
  catalog: T,
  kinds: readonly (keyof T & string)[] = capabilityKinds(catalog),
): string {
  const lines = kinds.flatMap((kind) => {
    const definition = catalog[kind];
    return [
      `- ${kind}: ${definition.description}`,
      ...definition.examples.map((example) => `  ${example}`),
    ];
  });
  return `LEGAL INTENTS / AVAILABLE CAPABILITIES — use only these Intent kinds:\n${lines.join('\n')}`;
}
