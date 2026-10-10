interface ParamSpec {
  key: string;
  default: number;
  min?: number;
}

export function normalizeParams(
  specs: ParamSpec[],
  params: Record<string, number>
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const spec of specs) {
    const value = params?.[spec.key];
    const numeric =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : spec.default;
    normalized[spec.key] =
      spec.min !== undefined ? Math.max(spec.min, numeric) : numeric;
  }
  return normalized;
}
