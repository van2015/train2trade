import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { Indicator, IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext } from '@/domain/strategies/marketContext'
import { resolveRef, Rule, SeriesRef } from '@/domain/strategies/rules'

export enum StrategyAction {
  /** Sin señal: no hacer nada (solo resultado de evaluate). */
  None = 'none',
  /** Solicita orden de entrada (solo sin posición abierta). */
  RequestEntry = 'request_entry',
  /** Solicita aumentar la posición (solo con posición abierta). */
  RequestAdd = 'request_add',
  /** Solicita reducir la posición (solo con posición abierta). */
  RequestReduce = 'request_reduce',
  /** Solicita orden de salida (solo con posición abierta). */
  RequestExit = 'request_exit',
  /** Resultado: veto de `invalidationRule`. */
  Invalidate = 'invalidate',
}

export type SignalAction = Exclude<StrategyAction, StrategyAction.None | StrategyAction.Invalidate>

export interface SignalConfig {
  /** Obligatoria en RequestAdd/RequestReduce (0 < f <= 1), prohibida en el resto. */
  fraction?: number
  /** Precio objetivo declarativo: alias de indicador o constante. */
  limitPrice?: SeriesRef
}

export interface StrategyDecision {
  action: StrategyAction
  /** Fracción (0, 1] para RequestAdd/RequestReduce; null en el resto. */
  fraction: number | null
  /** Precio resuelto en la vela actual; null → market. */
  price: number | null
  /** Señal o regla de invalidación que lo provocó; null en `None`. */
  reason: string | null
}

export interface StrategyDefinition {
  /** Nombre estable (no vacío). */
  name: string
  /** Versión (entero >= 1); subirla al cambiar reglas o indicadores. */
  version?: number
  /** Alias → indicador: series a calcular antes de evaluar. */
  indicators?: Readonly<Record<string, Indicator>>
  /** En orden de prioridad: gana la primera aplicable. No vacío. */
  signals: readonly Signal[]
  /** Si dispara → `Invalidate`. */
  invalidationRule?: Rule
}

export class InvalidStrategyDefinitionError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super(
      'InvalidStrategyDefinitionError',
      invalidMessage('Definición de estrategia inválida', reason, raw),
    )
  }
}

/** Condición + acción. Su `name` (`"request_entry: rsi > 30"`) sirve de observabilidad. */
export class Signal {
  readonly name: string

  constructor(
    readonly action: SignalAction,
    readonly rule: Rule,
    readonly config: SignalConfig = {},
  ) {
    const { fraction, limitPrice } = config
    const needsFraction =
      action === StrategyAction.RequestAdd || action === StrategyAction.RequestReduce

    if (needsFraction) {
      if (
        typeof fraction !== 'number' ||
        !Number.isFinite(fraction) ||
        fraction <= 0 ||
        fraction > 1
      ) {
        throw new InvalidStrategyDefinitionError(
          `la señal "${action}" requiere una fraction en (0, 1]`,
          fraction,
        )
      }
    } else if (fraction !== undefined) {
      throw new InvalidStrategyDefinitionError(`la señal "${action}" no admite fraction`, fraction)
    }

    if (limitPrice !== undefined) {
      if (typeof limitPrice !== 'number' && typeof limitPrice !== 'string') {
        throw new InvalidStrategyDefinitionError(
          'limitPrice debe ser un alias de serie o un número',
          limitPrice,
        )
      }
      if (typeof limitPrice === 'number' && !Number.isFinite(limitPrice)) {
        throw new InvalidStrategyDefinitionError('limitPrice numérico debe ser finito', limitPrice)
      }
    }

    this.name = `${action}: ${rule.name}${limitPrice !== undefined ? ` @ ${limitPrice}` : ''}`
  }
}

/** Definición sin estado ni ejecución: no conoce órdenes ni brokers (§14). */
export class Strategy {
  readonly name: string
  readonly version: number
  readonly indicators: Readonly<Record<string, Indicator>>
  readonly signals: readonly Signal[]
  readonly invalidationRule: Rule | null

  constructor(definition: StrategyDefinition) {
    const { name, version = 1, indicators, signals, invalidationRule } = definition

    if (typeof name !== 'string' || name.trim() === '') {
      throw new InvalidStrategyDefinitionError('el name no puede estar vacío', name)
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new InvalidStrategyDefinitionError('la version debe ser un entero >= 1', version)
    }
    if (signals.length === 0) {
      throw new InvalidStrategyDefinitionError('se requiere al menos una señal', signals.length)
    }

    this.name = name
    this.version = version
    this.indicators = Object.freeze({ ...indicators })
    this.signals = Object.freeze([...signals])
    this.invalidationRule = invalidationRule ?? null
  }

  /** Calcula los indicadores declarados y construye el `MarketContext` alineado. */
  buildContext(candles: readonly Candle[]): MarketContext {
    const series: Record<string, IndicatorValue[]> = {}
    for (const [alias, indicator] of Object.entries(this.indicators)) {
      series[alias] = indicator.calculate(candles)
    }
    return MarketContext.from({ candles, indicators: series })
  }

  /**
   * Evaluación pura. `open` = posición abierta. Sin veto devuelve la primera
   * señal aplicable que dispare; con veto, `Invalidate`.
   */
  evaluate(context: MarketContext, open: boolean): StrategyDecision {
    const vetoReason =
      this.invalidationRule !== null && this.invalidationRule.evaluate(context)
        ? this.invalidationRule.name
        : null

    if (vetoReason !== null && !open) {
      return { action: StrategyAction.Invalidate, fraction: null, price: null, reason: vetoReason }
    }

    const vetoed = vetoReason !== null
    for (const signal of this.signals) {
      if (!isApplicable(signal.action, open, vetoed)) continue
      if (!signal.rule.evaluate(context)) continue

      let price: number | null = null
      if (signal.config.limitPrice !== undefined) {
        const resolved = resolveRef(context, signal.config.limitPrice)
        // Sin precio resuelto no dispara: nunca caemos a market en silencio.
        if (resolved === null) continue
        price = resolved
      }

      return {
        action: signal.action,
        fraction: signal.config.fraction ?? null,
        price,
        reason: signal.name,
      }
    }

    if (vetoReason !== null) {
      return { action: StrategyAction.Invalidate, fraction: null, price: null, reason: vetoReason }
    }
    return { action: StrategyAction.None, fraction: null, price: null, reason: null }
  }

  /** Identidad reproducible (`name@version`) para registrar resultados. */
  toString(): string {
    return `${this.name}@${this.version}`
  }
}

function isApplicable(action: SignalAction, open: boolean, vetoed: boolean): boolean {
  if (action === StrategyAction.RequestEntry) return !open
  if (action === StrategyAction.RequestAdd) return open && !vetoed // el veto nunca bloquea cerrar
  return open
}
