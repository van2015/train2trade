import { DomainError, invalidMessage } from '@/domain/errors'
import { Portfolio } from '@/domain/portfolio/portfolio'

export interface RiskConfig {
  /** Fracción máxima del equity que puede representar la exposición; en (0, 1]. Por defecto 1. */
  maxPositionFraction?: number
  /** Fracción del equity que debe conservarse en efectivo; en [0, 1). Por defecto 0. */
  minCashReserve?: number
  /** Comisión estimada en bps (debe coincidir con el `ExecutionModel`). Por defecto 0. */
  feeBps?: number
}

export class InvalidRiskError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidRiskError', invalidMessage('Gestión de riesgo inválida', reason, raw))
  }
}

const BPS = 10_000
/** Tolerancia para el comparador de exposición (evita fallos por punto flotante). */
const EXPOSURE_EPSILON = 1e-9

/**
 * Gestión de riesgo (§8): decide el **tamaño** de las entradas y aprueba los
 * aumentos, con independencia de las reglas de la estrategia. La estrategia
 * decide *qué* operación quiere; aquí se determina si es admisible dada la
 * cuenta. Reduce/Exit nunca se bloquean (cerrar siempre es admisible).
 *
 * El `feeBps` solo estima la comisión para no aprobar operaciones que el
 * `Portfolio` rechazaría después por efectivo; el rechazo real lo hace el broker.
 */
export class RiskManager {
  readonly maxPositionFraction: number
  readonly minCashReserve: number
  readonly feeBps: number

  constructor(config: RiskConfig = {}) {
    const { maxPositionFraction = 1, minCashReserve = 0, feeBps = 0 } = config

    if (
      typeof maxPositionFraction !== 'number' ||
      !Number.isFinite(maxPositionFraction) ||
      maxPositionFraction <= 0 ||
      maxPositionFraction > 1
    ) {
      throw new InvalidRiskError(
        'maxPositionFraction debe ser un número en (0, 1]',
        maxPositionFraction,
      )
    }
    if (
      typeof minCashReserve !== 'number' ||
      !Number.isFinite(minCashReserve) ||
      minCashReserve < 0 ||
      minCashReserve >= 1
    ) {
      throw new InvalidRiskError('minCashReserve debe ser un número en [0, 1)', minCashReserve)
    }
    if (typeof feeBps !== 'number' || !Number.isFinite(feeBps) || feeBps < 0) {
      throw new InvalidRiskError('feeBps debe ser un número finito >= 0', feeBps)
    }

    this.maxPositionFraction = maxPositionFraction
    this.minCashReserve = minCashReserve
    this.feeBps = feeBps
  }

  /**
   * Cantidad admisible para una entrada nueva: el menor entre
   * `maxPositionFraction * equity` y `cash - minCashReserve * equity`, ajustado
   * por la comisión estimada. `null` si no hay fondos (la entrada no es
   * admisible).
   */
  entryQty(portfolio: Portfolio, price: number): number | null {
    assertPositive(price, 'price')

    const equity = portfolio.equity(price)
    const funds = Math.min(
      equity * this.maxPositionFraction,
      portfolio.cash - equity * this.minCashReserve,
    )
    if (funds <= 0) return null

    return funds / (price * (1 + this.feeBps / BPS))
  }

  /**
   * ¿Es admisible comprar `qty` al precio dado (coste con comisión) sin
   * romper la reserva de efectivo ni el máximo de exposición?
   */
  canAdd(portfolio: Portfolio, price: number, qty: number): boolean {
    assertPositive(price, 'price')
    assertPositive(qty, 'qty')

    const equity = portfolio.equity(price)
    const cost = price * qty * (1 + this.feeBps / BPS)
    if (cost > portfolio.cash - equity * this.minCashReserve) return false

    const exposureAfter = portfolio.exposure(price) + price * qty
    return exposureAfter <= equity * this.maxPositionFraction + EXPOSURE_EPSILON
  }
}

function assertPositive(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new InvalidRiskError(`${label} debe ser un número finito > 0`, value)
  }
}
