import { describe, expect, it } from 'vitest'
import { CHART_COLORS } from '@/components/chartData'
import {
  buildPreviewLevels,
  buildPreviewLines,
  buildStrategyPreview,
  previewWindow,
} from '@/components/strategyPreview'
import { Candle } from '@/domain/candles/candle'
import { Rsi } from '@/domain/indicators/rsi'
import { minus, plus, series } from '@/domain/strategies/priceExpr'
import {
  buildStrategy,
  InvalidStrategyDefinitionError,
  StrategySpec,
} from '@/domain/strategies/spec'

const T0 = 1_700_000_000_000

/** Vela con cierre 100 → rango de precios [90, 110]. */
function candle(index: number, close = 100): Candle {
  return Candle.from({
    time: T0 + index * 3_600_000,
    open: close,
    high: close + 10,
    low: close - 10,
    close,
    volume: 1,
  })
}

function candles(count = 10): Candle[] {
  return Array.from({ length: count }, (_, index) => candle(index))
}

function baseSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
  return {
    name: 'demo',
    version: 1,
    indicators: [
      { alias: 'fast', kind: 'sma', period: 3 },
      { alias: 'slow', kind: 'sma', period: 3 },
    ],
    entry: {
      rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
      execution: 'market',
    },
    ...overrides,
  }
}

describe('buildPreviewLines', () => {
  it('SMA → panel de precio, color canónico, id por índice y label = alias', () => {
    const { lines, issues } = buildPreviewLines(candles(), baseSpec())

    expect(issues).toEqual([])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      id: 'indicator-0',
      label: 'fast',
      color: CHART_COLORS.sma,
      pane: 'price',
    })
    expect(lines[0]?.values).toHaveLength(10)
    // SMA(3): calentamiento en las 2 primeras velas, valor después.
    expect(lines[0]?.values[0]?.value).toBeNull()
    expect(lines[0]?.values[2]?.value).toBe(100)
  })

  it('dos indicadores del mismo kind rotan el color (distinguibles)', () => {
    const { lines } = buildPreviewLines(candles(), baseSpec())

    expect(lines[0]?.color).not.toBe(lines[1]?.color)
  })

  it('ids por índice: los alias duplicados (a medio editar) no colisionan', () => {
    const spec = baseSpec({
      indicators: [
        { alias: 'x', kind: 'sma', period: 3 },
        { alias: 'x', kind: 'ema', period: 5 },
      ],
    })

    const { lines } = buildPreviewLines(candles(), spec)

    expect(lines.map((line) => line.id)).toEqual(['indicator-0', 'indicator-1'])
  })

  it('RSI → panel inferior, rango fijo 0–100 y referenciales 30/70', () => {
    const spec = baseSpec({ indicators: [{ alias: 'r', kind: 'rsi', period: 14 }] })

    const { lines } = buildPreviewLines(candles(), spec)

    expect(lines[0]).toMatchObject({
      color: CHART_COLORS.rsi,
      pane: 'lower',
      fixedRange: { min: 0, max: 100 },
      referenceLines: [30, 70],
    })
  })

  it('constante dentro del rango de precios → panel de precio sin rango fijo', () => {
    const spec = baseSpec({ indicators: [{ alias: 'umbral', kind: 'const', value: 100 }] })

    const { lines } = buildPreviewLines(candles(), spec)

    expect(lines[0]).toMatchObject({ pane: 'price', color: CHART_COLORS.constant })
    expect(lines[0]?.fixedRange).toBeUndefined()
  })

  it('constante fuera del rango de precios → panel inferior con rango acotado que la contiene', () => {
    const spec = baseSpec({ indicators: [{ alias: 'r', kind: 'const', value: 30 }] })

    const { lines } = buildPreviewLines(candles(), spec)

    expect(lines[0]?.pane).toBe('lower')
    expect(lines[0]?.fixedRange?.min).toBeLessThan(30)
    expect(lines[0]?.fixedRange?.max).toBeGreaterThan(30)
  })

  it('indicador inválido se omite con issue y no rompe a los demás', () => {
    const spec = baseSpec({
      indicators: [
        { alias: 'malo', kind: 'sma', period: 0 },
        { alias: 'bueno', kind: 'ema', period: 3 },
      ],
    })

    const { lines, issues } = buildPreviewLines(candles(), spec)

    expect(lines).toHaveLength(1)
    // El id sigue siendo el índice de la spec: la sincronía con el editor se mantiene.
    expect(lines[0]).toMatchObject({ id: 'indicator-1', label: 'bueno' })
    expect(issues).toEqual([
      'indicador malo: Periodo inválido: se esperaba un entero >= 1 (recibido: 0)',
    ])
  })

  it('alias vacío → etiqueta descriptiva del kind', () => {
    const spec = baseSpec({ indicators: [{ alias: '', kind: 'ema', period: 9 }] })

    const { lines } = buildPreviewLines(candles(), spec)

    expect(lines[0]?.label).toBe('EMA 9')
  })

  it('sin velas → listas vacías y sin issues', () => {
    const { lines, issues } = buildPreviewLines([], baseSpec())

    expect(lines).toEqual([])
    expect(issues).toEqual([])
  })
})

describe('buildPreviewLevels', () => {
  function levelSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
    return {
      name: 'niveles',
      version: 1,
      indicators: [{ alias: 'off', kind: 'const', value: 10 }],
      entry: {
        rule: { kind: 'condition', op: '>', a: 'off', b: 'close' },
        execution: 'market',
      },
      ...overrides,
    }
  }

  it('entrada a mercado: TP/SL evaluados con entry = cierre de la última vela', () => {
    const spec = levelSpec({
      takeProfit: { price: plus('entry', 'off'), execution: 'market' },
      stopLoss: { price: minus('entry', 'off'), execution: 'market' },
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toEqual([])
    expect(levels).toEqual([
      { id: 'tp', label: 'Take profit', price: 110, color: CHART_COLORS.up },
      { id: 'sl', label: 'Stop loss', price: 90, color: CHART_COLORS.down },
    ])
  })

  it('entrada límite: dibuja la entrada y evalúa TP/SL desde el precio límite', () => {
    const spec = levelSpec({
      indicators: [
        { alias: 'anchor', kind: 'const', value: 95 },
        { alias: 'off', kind: 'const', value: 10 },
      ],
      entry: {
        rule: { kind: 'condition', op: '>', a: 'anchor', b: 'close' },
        price: series('anchor'),
        execution: 'limit',
      },
      takeProfit: { price: plus('entry', 'off'), execution: 'market' },
      stopLoss: { price: minus('entry', 'off'), execution: 'market' },
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toEqual([])
    expect(levels).toEqual([
      { id: 'entry', label: 'Entrada', price: 95, color: CHART_COLORS.sma },
      { id: 'tp', label: 'Take profit', price: 105, color: CHART_COLORS.up },
      { id: 'sl', label: 'Stop loss', price: 85, color: CHART_COLORS.down },
    ])
  })

  it('triggers: se evalúan con los niveles efectivos (tp) disponibles', () => {
    const spec = levelSpec({
      takeProfit: { price: plus('entry', 'off'), execution: 'market' },
      triggers: [{ price: series('tp'), action: 'request_exit', execution: 'market' }],
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toEqual([])
    expect(levels).toEqual([
      { id: 'tp', label: 'Take profit', price: 110, color: CHART_COLORS.up },
      { id: 'trigger-0', label: 'Trigger 1', price: 110, color: CHART_COLORS.ema },
    ])
  })

  it('alias no registrado en la expresión → issue, pero el resto de niveles se dibuja', () => {
    const spec = levelSpec({
      takeProfit: { price: series('fantasma'), execution: 'market' },
      stopLoss: { price: minus('entry', 'off'), execution: 'market' },
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('take profit')
    expect(issues[0]).toContain('fantasma')
    expect(levels.map((level) => level.id)).toEqual(['sl'])
  })

  it('indicador omitido por inválido: issue en la construcción y en su expresión, sin romper el resto', () => {
    const spec = levelSpec({
      indicators: [
        { alias: 'malo', kind: 'sma', period: 0 },
        { alias: 'off', kind: 'const', value: 10 },
      ],
      takeProfit: { price: series('malo'), execution: 'market' },
      stopLoss: { price: minus('entry', 'off'), execution: 'market' },
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toEqual([
      'indicador malo: Periodo inválido: se esperaba un entero >= 1 (recibido: 0)',
      'take profit: Contexto de mercado inválido: el indicador no está registrado (recibido: "malo")',
    ])
    expect(levels).toEqual([{ id: 'sl', label: 'Stop loss', price: 90, color: CHART_COLORS.down }])
  })

  it('expresión en calentamiento → issue de no evaluable y sin nivel', () => {
    const spec = levelSpec({
      indicators: [{ alias: 'lento', kind: 'sma', period: 30 }],
      takeProfit: { price: series('lento'), execution: 'market' },
    })

    const { levels, issues } = buildPreviewLevels(candles(), spec)

    expect(issues).toEqual(['take profit no evaluable en la última vela'])
    expect(levels).toEqual([])
  })

  it('sin velas → niveles vacíos y sin issues', () => {
    const { levels, issues } = buildPreviewLevels([], levelSpec())

    expect(levels).toEqual([])
    expect(issues).toEqual([])
  })
})

describe('buildStrategyPreview', () => {
  it('combina líneas y niveles con note null cuando todo se evalúa', () => {
    const spec: StrategySpec = {
      name: 'ok',
      version: 1,
      indicators: [{ alias: 'off', kind: 'const', value: 10 }],
      entry: {
        rule: { kind: 'condition', op: '>', a: 'off', b: 'close' },
        execution: 'market',
      },
      takeProfit: { price: plus('entry', 'off'), execution: 'market' },
    }

    const preview = buildStrategyPreview(candles(), spec)

    expect(preview.note).toBeNull()
    expect(preview.lines).toHaveLength(1)
    expect(preview.levels.map((level) => level.id)).toEqual(['tp'])
  })

  it('deduplica los issues comunes a líneas y niveles en el note', () => {
    const spec = baseSpec({
      indicators: [
        { alias: 'malo', kind: 'sma', period: 0 },
        { alias: 'fast', kind: 'sma', period: 3 },
      ],
      takeProfit: { price: series('malo'), execution: 'market' },
    })

    const preview = buildStrategyPreview(candles(), spec)

    expect(preview.note).toContain('Omitidos:')
    // El mismo indicador falla al construir líneas y niveles: solo una entrada.
    expect(preview.note?.match(/Periodo inválido/g)).toHaveLength(1)
    expect(preview.note).toContain('take profit')
  })

  it('draft con la regla de entrada rota no bloquea (no usa buildStrategy)', () => {
    const broken = baseSpec({
      entry: {
        rule: { kind: 'condition', op: '>', a: 'fantasma', b: 'fast' },
        execution: 'market',
      },
    })
    // Contraste: para el dominio este draft SÍ es inválido.
    expect(() => buildStrategy(broken)).toThrow(InvalidStrategyDefinitionError)

    const preview = buildStrategyPreview(candles(), broken)

    expect(preview.note).toBeNull()
    expect(preview.lines).toHaveLength(2)
    expect(preview.levels).toEqual([])
  })

  it('sin velas → todo vacío con note de datos y ventana vacía', () => {
    const preview = buildStrategyPreview([], baseSpec())

    expect(preview).toEqual({
      window: { from: 0, to: 0 },
      lines: [],
      levels: [],
      legend: null,
      note: 'Sin datos para previsualizar',
    })
  })

  it('es determinista: misma entrada → mismo preview', () => {
    const spec = baseSpec({
      takeProfit: { price: plus('entry', 'close'), execution: 'market' },
    })

    expect(buildStrategyPreview(candles(), spec)).toEqual(buildStrategyPreview(candles(), spec))
  })

  it('reporta un indicador inválido con alias vacío usando su posición', () => {
    const spec = baseSpec({
      indicators: [{ alias: '', kind: 'sma', period: -1 }],
    })

    const preview = buildStrategyPreview(candles(), spec)

    expect(preview.note).toContain('#1')
    expect(preview.note).toContain('Periodo inválido')
  })
})

describe('previewWindow (ventana ajustada a la estrategia)', () => {
  it('deriva N del máximo período válido: 3×período, acotado a [60, 300]', () => {
    // SMA 50 → 150 velas.
    expect(
      previewWindow(
        candles(200),
        baseSpec({ indicators: [{ alias: 'a', kind: 'sma', period: 50 }] }),
      ),
    ).toEqual({
      from: 50,
      to: 200,
    })
    // SMA 5 → 15 → sube al mínimo 60.
    expect(
      previewWindow(
        candles(200),
        baseSpec({ indicators: [{ alias: 'a', kind: 'sma', period: 5 }] }),
      ),
    ).toEqual({
      from: 140,
      to: 200,
    })
    // SMA 200 → 600 → baja al tope 300.
    expect(
      previewWindow(
        candles(400),
        baseSpec({ indicators: [{ alias: 'a', kind: 'sma', period: 200 }] }),
      ),
    ).toEqual({
      from: 100,
      to: 400,
    })
  })

  it('sin períodos válidos usa 120 por defecto', () => {
    const window = previewWindow(
      candles(300),
      baseSpec({ indicators: [{ alias: 'c', kind: 'const', value: 30 }] }),
    )

    expect(window).toEqual({ from: 180, to: 300 })
  })

  it('ignora períodos inválidos de un draft a medio escribir', () => {
    // Number('') en el editor → period 0: no cuenta (default 120).
    const onlyInvalid = previewWindow(
      candles(300),
      baseSpec({ indicators: [{ alias: 'a', kind: 'sma', period: 0 }] }),
    )
    expect(onlyInvalid).toEqual({ from: 180, to: 300 })

    // Mezcla inválido + válido: manda el válido (3×20 = 60).
    const mixed = previewWindow(
      candles(300),
      baseSpec({
        indicators: [
          { alias: 'a', kind: 'sma', period: 0 },
          { alias: 'b', kind: 'ema', period: 20 },
        ],
      }),
    )
    expect(mixed).toEqual({ from: 240, to: 300 })
  })

  it('la ventana es un sufijo y nunca mayor que las velas cargadas', () => {
    const window = previewWindow(
      candles(10),
      baseSpec({ indicators: [{ alias: 'a', kind: 'sma', period: 100 }] }),
    )

    expect(window).toEqual({ from: 0, to: 10 })
  })
})

describe('buildStrategyPreview — ventana y leyenda', () => {
  it('las líneas se calculan sobre el historial COMPLETO y se recortan después (sin falsear EMA/RSI)', () => {
    const data = candles(100)
    const spec = baseSpec({ indicators: [{ alias: 'r', kind: 'rsi', period: 14 }] })

    const preview = buildStrategyPreview(data, spec)

    // Ventana = clamp(3×14=42, 60, 300) = 60 → sufijo desde 40.
    expect(preview.window).toEqual({ from: 40, to: 100 })
    // Referencia: RSI de Wilder calculado sobre las 100 velas (con toda su
    // memoria) y luego recortado. Si el preview calculase sobre el trozo
    // cortado, el RSI re-calentaría y daría valores distintos (o null) al inicio.
    const full = new Rsi(14).calculate(data)
    expect(preview.lines[0]?.values).toEqual(full.slice(40))
    expect(preview.lines[0]?.values).toHaveLength(60)
  })

  it('leyenda con la ventana y el indicador determinante (mayor período)', () => {
    const preview = buildStrategyPreview(
      candles(200),
      baseSpec({
        indicators: [
          { alias: 'fast', kind: 'sma', period: 10 },
          { alias: 'slow', kind: 'sma', period: 30 },
        ],
      }),
    )

    // Ventana = 90 (3×30) → sufijo desde 110.
    expect(preview.legend).toBe('últimas 90 velas · SMA 30')
  })

  it('leyenda sin indicador determinante y sin velas', () => {
    const noPeriods = buildStrategyPreview(
      candles(200),
      baseSpec({ indicators: [{ alias: 'c', kind: 'const', value: 30 }] }),
    )
    expect(noPeriods.legend).toBe('últimas 120 velas')

    // Sin períodos y menos velas que la ventana por defecto → rango completo.
    const fullRange = buildStrategyPreview(
      candles(100),
      baseSpec({ indicators: [{ alias: 'c', kind: 'const', value: 30 }] }),
    )
    expect(fullRange.legend).toBe('100 velas')

    expect(buildStrategyPreview([], baseSpec()).legend).toBeNull()
  })
})
