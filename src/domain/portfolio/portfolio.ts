import { DomainError, invalidMessage } from '@/domain/errors'
import { Account } from '@/domain/execution/account'
import { Fill } from '@/domain/execution/fill'
import { OrderSide } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'

export class InvalidPortfolioError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidPortfolioError', invalidMessage('Portfolio inválido', reason, raw))
  }
}

/**
 * Capital y posición (§8): efectivo, posición larga única, P&L realizado y
 * comisiones acumuladas. Invariantes:
 *
 * - `cash >= 0`: una compra que lo rompería se rechaza con
 *   `InvalidPortfolioError` **antes** de mutar (el broker la convertirá en una
 *   orden `Rejected`; aquí es la última línea de defensa).
 * - `realizedPnl` no se conta dos veces: al cerrarse una posición su realizado
 *   se acumula en el portfolio y la posición se retira (`position = null`).
 * - `equity(price) = cash + marketValue(price)` — sin doble conteo de fees,
 *   porque el coste de entrada ya salió del cash y vive en `avgEntryPrice`.
 */
export class Portfolio implements Account {
  readonly initialCapital: number

  private cashValue: number
  private positionValue: Position | null
  private closedRealized: number
  private fees: number

  constructor(initialCapital: number) {
    if (
      typeof initialCapital !== 'number' ||
      !Number.isFinite(initialCapital) ||
      initialCapital <= 0
    ) {
      throw new InvalidPortfolioError(
        'el initialCapital debe ser un número finito > 0',
        initialCapital,
      )
    }
    this.initialCapital = initialCapital
    this.cashValue = initialCapital
    this.positionValue = null
    this.closedRealized = 0
    this.fees = 0
  }

  get cash(): number {
    return this.cashValue
  }

  /** Posición larga abierta; `null` sin posición o tras el cierre total. */
  get position(): Position | null {
    return this.positionValue
  }

  /** P&L realizado total (posiciones cerradas + el de la posición abierta). */
  get realizedPnl(): number {
    return this.closedRealized + (this.positionValue?.realizedPnl ?? 0)
  }

  /** Comisiones totales pagadas (entradas y salidas). */
  get feesPaid(): number {
    return this.fees
  }

  /** Valor de mercado de la posición abierta al precio dado. */
  exposure(price: number): number {
    return this.positionValue?.marketValue(price) ?? 0
  }

  /** `cash + valor de mercado de la posición`. */
  equity(price: number): number {
    return this.cashValue + this.exposure(price)
  }

  /**
   * Aplica un relleno a efectivo y posición. Compra: exige efectivo suficiente
   * (si no, error sin cambios) y abre o aumenta la posición. Venta: exige
   * posición abierta con cantidad suficiente; al cerrarse, la posición se retira
   * y su realizado pasa al acumulado del portfolio.
   */
  applyFill(fill: Fill): void {
    if (fill.side === OrderSide.Buy) {
      this.applyBuyFill(fill)
      return
    }
    this.applySellFill(fill)
  }

  /** Compra: descuenta el coste total y abre o promedia la posición. */
  private applyBuyFill(fill: Fill): void {
    const cost = fill.cost
    if (cost > this.cashValue) {
      throw new InvalidPortfolioError(
        `efectivo insuficiente: se necesitan ${cost} y hay ${this.cashValue}`,
        cost,
      )
    }
    this.cashValue -= cost
    this.fees += fill.fee
    const position = this.positionValue
    if (position !== null && position.isOpen) {
      position.applyFill(fill)
    } else {
      this.positionValue = Position.from(fill)
    }
  }

  /** Venta: acredita el efectivo; al cerrar, retira la posición y acumula su realizado. */
  private applySellFill(fill: Fill): void {
    const position = this.positionValue
    if (position === null || position.isEmpty) {
      throw new InvalidPortfolioError('no hay posición abierta que reducir', fill.orderId)
    }

    // `position.applyFill` valida la cantidad y solo entonces se acredita el cash.
    position.applyFill(fill)
    this.cashValue += fill.price * fill.qty - fill.fee
    this.fees += fill.fee

    if (position.isEmpty) {
      this.closedRealized += position.realizedPnl
      this.positionValue = null
    }
  }
}
