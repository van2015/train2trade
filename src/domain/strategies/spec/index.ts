/**
 * Superficie pública de la spec de estrategia (§1.4) — re-exporta los cuatro
 * módulos internos para que los consumidores (editor, persistencia, UI)
 * sigan importando desde `@/domain/strategies/spec` sin conocer el reparto:
 *
 * - `types`:   formas serializables (`StrategySpec`, `RuleSpec`, …);
 * - `validate`: forma (parse) → `InvalidStrategyDefinitionError`;
 * - `build`:   semántica + construcción → `Strategy`;
 * - `aliases`: catálogo de series/alias y política del editor (enmienda 16).
 */

export {
  BUILTIN_CLASSES,
  classOfKind,
  compatibleClasses,
  OPERATION_ALIASES,
  operationAliases,
  priceOperandAliases,
  RESERVED_ALIASES,
  ruleOperandAliases,
  seriesClasses,
  TRIGGER_ACTIONS,
} from '@/domain/strategies/spec/aliases'

export {
  assertRuleSpec,
  assertStrategySpec,
  parseStrategySpec,
} from '@/domain/strategies/spec/validate'

export { buildIndicator, buildRule, buildStrategy } from '@/domain/strategies/spec/build'

export type {
  ConditionOp,
  EntrySpec,
  IndicatorSpec,
  OperationContext,
  RuleSpec,
  SeriesClass,
  SeriesClasses,
  StrategySpec,
  TriggerAction,
  TriggerSpec,
} from '@/domain/strategies/spec/types'

export { InvalidStrategyDefinitionError } from '@/domain/strategies/strategy'
