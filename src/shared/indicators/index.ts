// Indicators - technical analysis calculations
export {
  IndicatorCalculator,
  IndicatorDefinitionRegistry,
  IndicatorEngine,
  INDICATOR_DEFINITIONS,
  getDefinition,
  normalizeParams,
  createIndicatorInstance,
  getIndicatorGroups,
  compute,
  computeSeries,
  maxLookback,
} from './IndicatorService';
