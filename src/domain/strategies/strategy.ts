import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { Indicator, IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext, OperationLevels } from '@/domain/strategies/marketContext'
import {
  assertPriceExpr,
  evaluatePriceExpr,
  formatPriceExpr,
  PriceExpr,
} from '@/domain/strategies/priceExpr'
import { Rule } from '@/domain/strategies/rules'

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

/** Tipo de ejecución de una acción (decisión 6): la define la estrategia. */
export type OrderExecution = 'limit' | 'market'

export interface SignalConfig {
  /** Obligatoria en RequestAdd/RequestReduce (0 < f <= 1), prohibida en el resto. */
  fraction?: number
  /**
   * Precio de la orden como expresión (alias/operación/aritmética, sin
   * literales numéricos — decisión 9). **Presencia ⇒ orden `Limit`** en el
   * precio resuelto; ausencia ⇒ `Market`. Un precio sin resolver
   * (calentamiento) descarta la señal. Sustituye al antiguo
   * `limitPrice: SeriesRef`; el runner infiere el tipo como siempre
   * (`price === null ? Market : Limit`).
   */
  price?: PriceExpr
}

/** Nivel de take-profit/stop-loss: expresión + cómo ejecutar al tocarlo. */
export interface PriceLevel {
  price: PriceExpr
  execution: OrderExecution
}

/**
 * Disparador por toque de precio (decisión 6/8): cuando el mercado alcanza
 * la expresión se ejecuta `action` (dirección de toque como límite: venta →
 * `high >= price`, compra → `low <= price`). `execution` decide el tipo de
 * orden al disparar: `limit` lleva el precio en la decisión; `market` va sin
 * precio y el runner crea la orden `Market`.
 */
export class Trigger {
  readonly price: PriceExpr
  readonly action: SignalAction
  readonly execution: OrderExecution
  readonly fraction: number | null
  /** Observabilidad: `"request_entry @ sma_fast + two * atr14"`. */
  readonly name: string

  constructor(data: {
    price: PriceExpr
    action: SignalAction
    execution: OrderExecution
    fraction?: number
  }) {
    assertPriceExpr(data.price)
    if (!isSignalAction(data.action)) {
      throw new InvalidStrategyDefinitionError(
        'trigger.action debe ser una acción de señal (entry/add/reduce/exit)',
        data.action,
      )
    }
    if (data.execution !== 'limit' && data.execution !== 'market') {
      throw new InvalidStrategyDefinitionError(
        'execution debe ser "limit" o "market"',
        data.execution,
      )
    }
    assertFraction(data.action, data.fraction)

    this.price = data.price
    this.action = data.action
    this.execution = data.execution
    this.fraction = data.fraction ?? null
    this.name = `${data.action} @ ${formatPriceExpr(data.price)}`
  }
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
  /** Take-profit: toque `high >= tp` con posición abierta → salida. */
  takeProfit?: PriceLevel
  /** Stop-loss: toque `low <= sl` con posición abierta → salida. */
  stopLoss?: PriceLevel
  /** Disparadores por toque de precio (compra `low <=`, venta `high >=`). */
  triggers?: readonly Trigger[]
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
    assertSignalConfig(action, config)
    this.name = `${action}: ${rule.name}${config.price !== undefined ? ` @ ${formatPriceExpr(config.price)}` : ''}`
  }
}

/**
 * Valida `config` según la acción: `fraction` obligatoria en add/reduce
 * (0 < f <= 1) y prohibida en el resto; `price` debe ser una expresión de
 * precio válida (sin literales numéricos). Lanza en el primer campo inválido.
 */
function assertSignalConfig(action: SignalAction, config: SignalConfig): void {
  const { fraction, price } = config
  assertFraction(action, fraction)
  if (price !== undefined) assertPriceExpr(price)
}

/** Fracción obligatoria en add/reduce (0 < f <= 1), prohibida en el resto. */
function assertFraction(action: SignalAction, fraction: number | undefined): void {
  const needsFraction =
    action === StrategyAction.RequestAdd || action === StrategyAction.RequestReduce

  if (needsFraction && !isUnitFraction(fraction)) {
    throw new InvalidStrategyDefinitionError(
      `la señal "${action}" requiere una fraction en (0, 1]`,
      fraction,
    )
  }
  if (!needsFraction && fraction !== undefined) {
    throw new InvalidStrategyDefinitionError(`la señal "${action}" no admite fraction`, fraction)
  }
}

/** `true` si `action` es una de las cuatro acciones de señal (no None/Invalidate). */
function isSignalAction(action: unknown): action is SignalAction {
  return (
    action === StrategyAction.RequestEntry ||
    action === StrategyAction.RequestAdd ||
    action === StrategyAction.RequestReduce ||
    action === StrategyAction.RequestExit
  )
}

/** `true` si `fraction` es un número finito en (0, 1]. */
export function isUnitFraction(fraction: unknown): fraction is number {
  return typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1
}

/** Definición sin estado ni ejecución: no conoce órdenes ni brokers (§14). */
export class Strategy {
  readonly name: string
  readonly version: number
  readonly indicators: Readonly<Record<string, Indicator>>
  readonly signals: readonly Signal[]
  readonly invalidationRule: Rule | null
  readonly takeProfit: PriceLevel | null
  readonly stopLoss: PriceLevel | null
  readonly triggers: readonly Trigger[]

  constructor(definition: StrategyDefinition) {
    const {
      name,
      version = 1,
      indicators,
      signals,
      invalidationRule,
      takeProfit,
      stopLoss,
      triggers,
    } = definition

    if (typeof name !== 'string' || name.trim() === '') {
      throw new InvalidStrategyDefinitionError('el name no puede estar vacío', name)
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new InvalidStrategyDefinitionError('la version debe ser un entero >= 1', version)
    }
    if (signals.length === 0) {
      throw new InvalidStrategyDefinitionError('se requiere al menos una señal', signals.length)
    }
    if (takeProfit !== undefined) assertPriceLevel(takeProfit, 'takeProfit')
    if (stopLoss !== undefined) assertPriceLevel(stopLoss, 'stopLoss')

    this.name = name
    this.version = version
    this.indicators = Object.freeze({ ...indicators })
    this.signals = Object.freeze([...signals])
    this.invalidationRule = invalidationRule ?? null
    this.takeProfit = takeProfit ?? null
    this.stopLoss = stopLoss ?? null
    this.triggers = Object.freeze([...(triggers ?? [])])
  }

  /**
   * Calcula los indicadores declarados y construye el `MarketContext`
   * alineado; `levels` inyecta los alias de operación (entry/sl/tp) — el
   * runner aporta `entry` desde el portfolio y los overrides de sesión.
   */
  buildContext(candles: readonly Candle[], levels?: OperationLevels): MarketContext {
    const series: Record<string, IndicatorValue[]> = {}
    for (const [alias, indicator] of Object.entries(this.indicators)) {
      series[alias] = indicator.calculate(candles)
    }
    return MarketContext.from({ candles, indicators: series, levels })
  }

  /**
   * Evaluación pura. `open` = instancia en posición. Prioridad (§1.5):
   * veto → SL → TP → señales (reglas) → triggers; sin nada → `None`.
   *
   * Los niveles efectivos (`entry`/`sl`/`tp`) se materializan en el contexto
   * antes de evaluar: `sl`/`tp` = override de sesión ?? expresión de la
   * estrategia (solo con la instancia en posición y `entry` conocido; sin
   * posición → todo `null`), para que reglas y triggers los vean a través
   * de `value('sl')`.
   */
  evaluate(context: MarketContext, open: boolean): StrategyDecision {
    const levels = this.effectiveLevels(context, open)
    const ctx = context.withLevels(levels)

    const vetoReason =
      this.invalidationRule !== null && this.invalidationRule.evaluate(ctx)
        ? this.invalidationRule.name
        : null
    if (vetoReason !== null && !open) return invalidated(vetoReason)
    const vetoed = vetoReason !== null

    // 1. SL (solo con posición; el veto nunca bloquea cerrar): toque `low <= sl`.
    if (levels.sl !== null && levels.sl !== undefined && ctx.current.low <= levels.sl) {
      return levelExit('stop_loss', levels.sl, this.stopLoss?.execution ?? 'market')
    }
    // 2. TP: toque `high >= tp`. Antes que las reglas (prioridad §1.5).
    if (levels.tp !== null && levels.tp !== undefined && ctx.current.high >= levels.tp) {
      return levelExit('take_profit', levels.tp, this.takeProfit?.execution ?? 'market')
    }

    const fired = this.firstFiringSignal(ctx, open, vetoed)
    if (fired !== null) {
      return {
        action: fired.signal.action,
        fraction: fired.signal.config.fraction ?? null,
        price: fired.price,
        reason: fired.signal.name,
      }
    }

    const trigger = this.firstFiringTrigger(ctx, open, vetoed)
    if (trigger !== null) {
      return {
        action: trigger.trigger.action,
        fraction: trigger.trigger.fraction,
        price: trigger.trigger.execution === 'limit' ? trigger.price : null,
        reason: trigger.trigger.name,
      }
    }

    if (vetoReason !== null) return invalidated(vetoReason)
    return { action: StrategyAction.None, fraction: null, price: null, reason: null }
  }

  /**
   * Niveles efectivos de la operación (§1.6): `entry` desde el contexto (lo
   * inyecta el runner) solo con la instancia en posición; `sl`/`tp` solo si
   * la estrategia los declara — el override de sesión (número o `null` =
   * desactivado) sustituye a la expresión, pero no crea niveles que la
   * estrategia no define. Sin posición → todo `null`.
   */
  private effectiveLevels(context: MarketContext, open: boolean): OperationLevels {
    const entry = open ? (context.levels.entry ?? null) : null
    if (entry === null) return { entry: null, sl: null, tp: null }

    const sl =
      this.stopLoss === null
        ? null
        : context.levels.sl !== undefined
          ? context.levels.sl
          : evaluatePriceExpr(this.stopLoss.price, context)
    const tp =
      this.takeProfit === null
        ? null
        : context.levels.tp !== undefined
          ? context.levels.tp
          : evaluatePriceExpr(this.takeProfit.price, context)
    return { entry, sl, tp }
  }

  /**
   * Primera señal aplicable que dispara; `null` si ninguna. Un precio sin
   * resolver (calentamiento) descarta la señal: nunca caemos a market en
   * silencio — la presencia de precio ⇔ orden `Limit`.
   */
  private firstFiringSignal(
    context: MarketContext,
    open: boolean,
    vetoed: boolean,
  ): { signal: Signal; price: number | null } | null {
    for (const signal of this.signals) {
      if (!isApplicable(signal.action, open, vetoed)) continue
      if (!signal.rule.evaluate(context)) continue

      let price: number | null = null
      if (signal.config.price !== undefined) {
        price = evaluatePriceExpr(signal.config.price, context)
        if (price === null) continue
      }

      return { signal, price }
    }
    return null
  }

  /**
   * Primer trigger por toque direccional que dispara; `null` si ninguno.
   * Toque con semántica de orden límite: venta → `high >= price`, compra →
   * `low <= price` (misma regla que `NextOpenExecutionModel.limitPrice`).
   * Un precio sin resolver (calentamiento) no dispara.
   */
  private firstFiringTrigger(
    context: MarketContext,
    open: boolean,
    vetoed: boolean,
  ): { trigger: Trigger; price: number } | null {
    for (const trigger of this.triggers) {
      if (!isApplicable(trigger.action, open, vetoed)) continue
      const price = evaluatePriceExpr(trigger.price, context)
      if (price === null) continue

      const sells =
        trigger.action === StrategyAction.RequestExit ||
        trigger.action === StrategyAction.RequestReduce
      const touched = sells ? context.current.high >= price : context.current.low <= price
      if (touched) return { trigger, price }
    }
    return null
  }

  /** Identidad reproducible (`name@version`) para registrar resultados. */
  toString(): string {
    return `${this.name}@${this.version}`
  }
}

/** Validación de un nivel TP/SL: expresión válida + ejecución conocida. */
function assertPriceLevel(level: PriceLevel, field: string): void {
  assertPriceExpr(level.price)
  if (level.execution !== 'limit' && level.execution !== 'market') {
    throw new InvalidStrategyDefinitionError(
      `${field}.execution debe ser "limit" o "market"`,
      level.execution,
    )
  }
}

/**
 * Decisión de salida por nivel (SL/TP): `limit` lleva el precio en la
 * decisión (orden `Limit` en el nivel); `market` va sin precio (orden
 * `Market` a la apertura siguiente) — la presencia de precio ⇔ limit.
 */
function levelExit(reason: string, level: number, execution: OrderExecution): StrategyDecision {
  return {
    action: StrategyAction.RequestExit,
    fraction: null,
    price: execution === 'limit' ? level : null,
    reason,
  }
}

function isApplicable(action: SignalAction, open: boolean, vetoed: boolean): boolean {
  if (action === StrategyAction.RequestEntry) return !open
  if (action === StrategyAction.RequestAdd) return open && !vetoed // el veto nunca bloquea cerrar
  return open
}

/** Decisión de veto: la invalidación anula la señal (y retira la orden de entrada). */
function invalidated(reason: string): StrategyDecision {
  return { action: StrategyAction.Invalidate, fraction: null, price: null, reason }
}
