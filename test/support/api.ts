/** Respuesta JSON mockeada para el `fetch` inyectado en tests. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Fila de klines de Binance (formato completo de `/api/v3/klines`). */
export function kline(
  openTime: number,
  open = '100',
  high = '110',
  low = '90',
  close = '105',
  volume = '42',
) {
  return [openTime, open, high, low, close, volume, openTime + 3_599_999, '0', 1, '0', '0', '0']
}
