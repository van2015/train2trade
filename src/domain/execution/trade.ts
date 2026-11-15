import { DomainError, invalidMessage } from '@/domain/errors'

export interface TradeData {
  /** Apertura de la posición cerrada (ms UTC). */
  entryTime: number
  /** Coste unitario de entrada con comisiones incluidas (semántica de `Position.avgEntryPrice`). */
  entryPrice: number
  /** Cierre (relleno de venta) en ms UTC; >= entryTime. */
  exitTime: number
  /** Precio efectivo de salida (con slippage), finito > 0. */
  exitPrice: number
  /** Cantidad cerrada por este relleno, finita > 0. */
  qty: number
  /** P&L neto de este cierre: (exitPrice - entryPrice) * qty - fees de salida. */
  pnl: number
  /** Comisión de salida de este cierre; finita >= 0 (la de entrada va embebida en entryPrice). */
  fees: number
}

export class InvalidTradeError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidTradeError', invalidMessage('Trade inválido', reason, raw))
  }
}

/**
 * Registro de una operación cerrada (§6 "registro de operaciones", §9): un
 * trade por cada relleno de venta (parcial o total), con el P&L realizado de
 * ese cierre. Invariante: la suma de `pnl` de todos los trades de un
 * experimento coincide con el `realizedPnl` del portfolio.
 */
export class Trade {
  readonly entryTime: number
  readonly entryPrice: number
  readonly exitTime: number
  readonly exitPrice: number
  readonly qty: number
  readonly pnl: number
  readonly fees: number

  constructor(data: TradeData) {
    validateTradeData(data)
    const { entryTime, entryPrice, exitTime, exitPrice, qty, pnl, fees } = data

    this.entryTime = entryTime
    this.entryPrice = entryPrice
    this.exitTime = exitTime
    this.exitPrice = exitPrice
    this.qty = qty
    this.pnl = pnl
    this.fees = fees
  }

  /** true ⇔ el cierre fue rentable (pnl > 0; el empate no es ganancia). */
  get win(): boolean {
    return this.pnl > 0
  }

  /** Duración de la posición en ms hasta este cierre. */
  get durationMs(): number {
    return this.exitTime - this.entryTime
  }

  /** Datos serializables (roundtrip JSON); `JSON.stringify` usa este método. */
  toJSON(): TradeData {
    return {
      entryTime: this.entryTime,
      entryPrice: this.entryPrice,
      exitTime: this.exitTime,
      exitPrice: this.exitPrice,
      qty: this.qty,
      pnl: this.pnl,
      fees: this.fees,
    }
  }

  /** Reconstruye un trade desde datos serializados (valida como el constructor). */
  static from(data: TradeData): Trade {
    if (typeof data !== 'object' || data === null) {
      throw new InvalidTradeError('los datos deben ser un objeto', data)
    }
    return new Trade(data)
  }
}

function assertTimestamp(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidTradeError(`${label} debe ser un timestamp finito >= 0 (ms)`, value)
  }
}

/** Valida el payload del trade; lanza `InvalidTradeError` en el primer campo inválido. */
function validateTradeData(data: TradeData): void {
  const { entryTime, entryPrice, exitTime, exitPrice, qty, pnl, fees } = data

  assertTimestamp(entryTime, 'entryTime')
  assertTimestamp(exitTime, 'exitTime')
  if (exitTime < entryTime) {
    throw new InvalidTradeError('exitTime no puede ser anterior a entryTime', exitTime)
  }
  if (typeof entryPrice !== 'number' || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new InvalidTradeError('entryPrice debe ser un número finito > 0', entryPrice)
  }
  if (typeof exitPrice !== 'number' || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    throw new InvalidTradeError('exitPrice debe ser un número finito > 0', exitPrice)
  }
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    throw new InvalidTradeError('qty debe ser un número finito > 0', qty)
  }
  if (typeof pnl !== 'number' || !Number.isFinite(pnl)) {
    throw new InvalidTradeError('pnl debe ser un número finito', pnl)
  }
  if (typeof fees !== 'number' || !Number.isFinite(fees) || fees < 0) {
    throw new InvalidTradeError('fees debe ser un número finito >= 0', fees)
  }
}
