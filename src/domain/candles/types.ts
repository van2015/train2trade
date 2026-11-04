export interface Candle {
  /** Timestamp en milisegundos (UTC) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
