import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { Indicator, IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext } from '@/domain/strategies/marketContext'
import { resolveRef, Rule, SeriesRef } from '@/domain/strategies/rules'

export enum StrategyAction {
  /** Sin señal: no hacer nada (resultado de evaluate, nunca acción de una señal). */
  None = 'none',
  /** Abrir posición nueva (solo aplicable sin posición abierta). */
  Enter = 'enter',
  /** Aumentar la posición existente (solo con posición abierta). */
  Add = 'add',
  /** Reducir la posición existente, cerrando su fracción (solo con posición abierta). */
  Reduce = 'reduce',
  /** Cerrar toda la posición (solo con posición abierta). */
  Exit = 'exit',
  /**
   * Veto de la `invalidationRule` (resultado de evaluate, nunca acción de una
   * señal): retira la orden de entrada pendiente si la hay; sin posición no
   * entra; con posición bloquea `Add` pero nunca impide `Reduce`/`Exit`.
   */
  Invalidate = 'invalidate',
}

/** Señales: ni resultados (`None`) ni el veto (`Invalidate`), ambos excluidos a nivel de tipos. */
export type SignalAction = Exclude<StrategyAction, StrategyAction.None | StrategyAction.Invalidate>

export interface SignalConfig {
  /** Obligatoria en Add/Reduce (0 < f <= 1), prohibida en Enter/Exit. */
  fraction?: number
  /** Precio objetivo declarativo: alias de indicador (normal) o constante. Resuelto al evaluar. */
  limitPrice?: SeriesRef
}

export interface StrategyDecision {
  action: StrategyAction
  /** Fracción para Add/Reduce; null en Enter/Exit/None. */
  fraction: number | null
  /** Precio objetivo resuelto en la vela actual; null → market. null en None. */
  price: number | null
  /** name de la señal que disparó, o el de la regla de invalidación en `Invalidate`; null en `None`. */
  reason: string | null
}

export interface StrategyDefinition {
  /** Nombre estable de la estrategia (no vacío). */
  name: string
  /** Versión de la definición (entero >= 1, por defecto 1). Cambiar reglas/indicadores exige subirla. */
  version?: number
  /** Alias → indicador: define qué series hay que calcular antes de evaluar. */
  indicators?: Readonly<Record<string, Indicator>>
  /** Señales en orden de prioridad: la primera aplicable que dispare gana. No vacío. */
  signals: readonly Signal[]
  /**
   * Regla de invalidación opcional. Si dispara → `Invalidate`: la instancia
   * retira la orden de entrada pendiente si la hay; sin posición no entra;
   * con posición bloquea `Add` pero permite `Reduce`/`Exit` (invalidar nunca
   * impide cerrar).
   */
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

/**
 * Condición + acción: la unidad de la que se compone una estrategia.
 * `name` para observabilidad: `"enter: fast crossesAbove slow"` (con precio: `"… @ sma20"`).
 */
export class Signal {
  readonly name: string

  constructor(
    readonly action: SignalAction,
    readonly rule: Rule,
    readonly config: SignalConfig = {},
  ) {
    const { fraction, limitPrice } = config
    const needsFraction = action === StrategyAction.Add || action === StrategyAction.Reduce

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

/**
 * Definición de estrategia (sin estado ni ejecución): señales priorizadas,
 * indicadores declarados y versión. No sabe si evalúa un backtest, una replay
 * ni una operación real, ni conoce órdenes ni brokers (§14).
 */
export class Strategy {
  readonly name: string
  readonly version: number
  readonly indicators: Readonly<Record<string, Indicator>>
  readonly signals: readonly Signal[]
  /** Regla de invalidación; `null` si la definición no declara ninguna. */
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

  /**
   * Calcula las series declaradas sobre `velas` y construye el `MarketContext`
   * alineado (misma longitud/`time` por construcción).
   */
  buildContext(candles: readonly Candle[]): MarketContext {
    const series: Record<string, IndicatorValue[]> = {}
    for (const [alias, indicator] of Object.entries(this.indicators)) {
      series[alias] = indicator.calculate(candles)
    }
    return MarketContext.from({ candles, indicators: series })
  }

  /**
   * Evaluación pura. `open` = posición abierta (⇔ `WaitingForExitSignal` o
   * `WaitingForExitFill` en la instancia); no conoce órdenes pendientes: qué
   * significa invalidar en cada fase lo decide la instancia.
   *
   * 1. `invalidationRule` dispara y no hay posición → `Invalidate` con
   *    `reason` = nombre de la regla (también cubre la entrada pendiente, que
   *    implica `!open`).
   * 2. Con posición: recorre `signals` en orden y devuelve la primera cuya
   *    acción sea aplicable (el veto bloquea `Add`, nunca `Reduce`/`Exit`),
   *    cuya regla sea true y cuyo `limitPrice` (si existe) resuelva a número.
   * 3. Si ninguna dispara: `Invalidate` si había veto, `None` si no.
   *
   * Invalidar nunca impide cerrar: `Reduce`/`Exit` se evalúan igual con veto.
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
        // Sin el precio objetivo la señal no dispara: nunca caemos a market en silencio.
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

  /** `"name@version"` — identidad reproducible para registrar resultados. */
  toString(): string {
    return `${this.name}@${this.version}`
  }
}

function isApplicable(action: SignalAction, open: boolean, vetoed: boolean): boolean {
  if (action === StrategyAction.Enter) return !open
  // El veto bloquea exponer más, pero nunca Reduce/Exit.
  if (action === StrategyAction.Add) return open && !vetoed
  return open
}
