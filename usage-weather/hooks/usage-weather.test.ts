import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionUsage } from 'claude-code'

// 1 Oct 2026, 15:00 in Bogotá (20:00 UTC).
const AHORA = Date.parse('2026-10-01T20:00:00Z')

const USO: SessionUsage = {
  startedAt: AHORA,
  context: { tokens: 126_000, window: 1_000_000, percent: 13 },
  rateLimits: [
    // Resets Oct 2, 01:10 UTC = 8:10 pm in Bogotá.
    { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-02T01:10:00Z' },
    // Monday Oct 5, 15:00 UTC = 10:00 am in Bogotá.
    { kind: 'seven_day', percentUsed: 34, resetsAt: '2026-10-05T15:00:00Z' },
  ],
  cost: { usd: 1.73 },
}

const AJUSTES = { modo: 'completo', idioma: 'es', zona: 'America/Bogota', tema: 'default' }

const PROPS = (columnas: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columnas }) as unknown as RenderPropsOf['AbovePrompt']

// What the engine answers beneath the mod: usage, session id, commands, alerts.
function motor(on: On, uso: { actual: SessionUsage }, avisos: string[], ajustes: object | null = AJUSTES) {
  const clock = mock.clock(on, { now: AHORA })
  if (ajustes) mock.store(on, { ajustes })
  else mock.store(on)
  on('session.usage', () => ({ value: uso.actual }))
  on('session.id', () => ({ value: 'sesion-de-prueba' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.run', () => ({}))
  return clock
}

const INICIO = { cwd: '.', surface: 'terminal', isInteractive: true } as const

describe('usage-weather', () => {
  const dibujar = ($: Engine, columnas = 100) =>
    $.ui.mount({ plugin: 'usage-weather', surface: 'terminal', component: 'AbovePrompt', props: PROPS(columnas) })

  const comando = ($: Engine, args: string) =>
    $.command.run({ command: 'usage-weather', args, origin: { kind: 'user' }, presentation: {} } as unknown as Parameters<Engine['command']['run']>[0])

  test('draws context, cost and both limits (es, Bogotá)', async ($, on) => {
    const avisos: string[] = []
    motor(on, { actual: USO }, avisos)
    await $.session.start(INICIO)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-weather', surface, component: 'AbovePrompt', props: PROPS(100) })
      expect(await ui.find({ type: 'Text', text: 'Despejado 13%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '126.0k/1.0M' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '$1.73' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'en 5h 10m (8:10 pm)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'lun 10:00 am' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '34%' })).toBeDefined()
    }
    expect(avisos).toEqual([])
  })

  test('the context bar shows the real percentage', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)
    const ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: /^ █$/ })).toBeDefined()
  })

  test('the view rotates by word: mini, off, full', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)

    expect((await comando($, 'mini')).text).toContain('Vista: mini')
    const mini = await dibujar($)
    expect(await mini.find({ type: 'Text', text: 'Despejado' })).toBeUndefined()
    expect(await mini.find({ type: 'Text', text: '$1.73' })).toBeDefined()

    expect((await comando($, 'oculto')).text).toContain('Vista: oculto')
    expect((await comando($, 'full')).text).toContain('Vista: completo')
  })

  test('alerts once at 75% context and at 80% of the 5h limit', async ($, on) => {
    const avisos: string[] = []
    const uso = { actual: USO }
    motor(on, uso, avisos)
    await $.session.start(INICIO)

    uso.actual = {
      ...USO,
      context: { tokens: 780_000, window: 1_000_000, percent: 78 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: '2026-10-02T01:10:00Z' }],
    }
    await $.session.start(INICIO)
    await $.session.start(INICIO)

    expect(avisos.filter(a => a.includes('considera /compact'))).toHaveLength(1)
    expect(avisos.filter(a => a.startsWith('Sesión 5h 82%'))).toHaveLength(1)
  })

  test('estimates when the 5h window fills at the current pace', async ($, on) => {
    const uso = { actual: USO }
    const clock = motor(on, uso, [])
    await $.session.start(INICIO)

    await clock.advance(30 * 60_000)
    uso.actual = { ...USO, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-02T01:10:00Z' }] }
    await $.session.start(INICIO)

    const ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: '→100% en 1h 31m' })).toBeDefined()
  })

  test('shows whole-number limits and rounds the countdown up', async ($, on) => {
    const uso = { actual: { ...USO, rateLimits: [{ kind: 'five_hour', percentUsed: 6.4, resetsAt: '2026-10-02T01:10:00Z' }] } }
    const clock = motor(on, uso, [])
    await $.session.start(INICIO)
    await clock.advance(30_000)

    const ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: ' 6%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '6.4%' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'en 5h 10m (8:10 pm)' })).toBeDefined()
  })

  test('switches language: English uses AM/PM, Japanese uses 24h and wide labels', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)

    expect((await comando($, 'en')).text).toContain('Language: English')
    let ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: 'Clear 13%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Session 5h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'in 5h 10m (8:10 PM)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Mon 10:00 AM' })).toBeDefined()

    expect((await comando($, 'japanese')).text).toContain('言語: 日本語')
    ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: '快晴 13%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'あと5h 10m (20:10)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '月 10:00' })).toBeDefined()

    for (const codigo of ['pt', 'fr', 'de', 'zh', 'ko']) {
      expect((await comando($, codigo)).text).toContain('✔')
      expect(await (await dibujar($)).find({ type: 'Text', text: '(20:10)' })).toBeDefined()
    }
  })

  test('switches time zone: IANA name, DST, fixed offsets and city shortcuts', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)

    // Tokyo is UTC+9: 01:10 UTC = 10:10 am; weekly reset becomes Tuesday 12:00 am.
    expect((await comando($, 'Asia/Tokyo')).text).toContain('Asia/Tokyo (UTC+9')
    let ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: 'en 5h 10m (10:10 am)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'mar 12:00 am' })).toBeDefined()

    // New York is on daylight time in October (UTC-4): 9:10 pm.
    await comando($, 'America/New_York')
    ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: '(9:10 pm)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'lun 11:00 am' })).toBeDefined()

    await comando($, 'UTC-5')
    expect(await (await dibujar($)).find({ type: 'Text', text: '(8:10 pm)' })).toBeDefined()

    await comando($, '+5:30')
    expect(await (await dibujar($)).find({ type: 'Text', text: '(6:40 am)' })).toBeDefined()

    // A bare city name finds the zone.
    expect((await comando($, 'madrid')).text).toContain('Europe/Madrid')
    // Language, zone and view in one go, in any order.
    const todo = (await comando($, 'tokyo ko mini')).text
    expect(todo).toContain('한국어')
    expect(todo).toContain('Asia/Tokyo')
  })

  test('rejects an unknown word without changing anything', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)

    expect((await comando($, 'ko foo')).text).toBe('No reconozco "foo". Prueba /usage-weather zonas o /usage-weather idiomas.')
    expect((await comando($, '')).text).toContain('Idioma: Español')
  })

  test('lists zones and languages', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)

    const zonas = (await comando($, 'zonas')).text
    expect(zonas).toContain('America: Bogota')
    expect(zonas).toContain('Asia: ')
    expect(zonas).toContain('IANA')
    expect((await comando($, 'zone')).text).toBe(zonas)
    expect((await comando($, 'language')).text).toContain('ja  日本語')
    const idiomas = (await comando($, 'languages')).text
    for (const c of ['es', 'en', 'pt', 'fr', 'de', 'zh', 'ja', 'ko']) {
      expect(idiomas).toContain(c)
    }
  })

  test('defaults to English on a first run, whatever the system language', async ($, on) => {
    motor(on, { actual: USO }, [], null)
    await $.session.start(INICIO)

    const ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: 'Clear 13%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Session 5h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Despejado' })).toBeUndefined()
    expect((await comando($, '')).text).toContain('Language: English')
  })

  test('a first run shows a welcome toast with the settings command, once', async ($, on) => {
    const avisos: string[] = []
    motor(on, { actual: USO }, avisos, null)
    await $.session.start(INICIO)
    const bienvenidas = avisos.filter(a => a.startsWith('usage-weather: English'))
    expect(bienvenidas).toHaveLength(1)
    expect(bienvenidas[0]).toContain('/usage-weather help')

    await $.session.start(INICIO)
    expect(avisos.filter(a => a.startsWith('usage-weather: English'))).toHaveLength(1)
  })

  test('help shows the settings and examples', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)
    const texto = (await comando($, 'help')).text
    expect(texto).toContain('Idioma: Español')
    expect(texto).toContain('/usage-weather bogota es')
  })

  test('switches theme by word, lists themes, and keeps drawing', async ($, on) => {
    const avisos: string[] = []
    motor(on, { actual: USO }, avisos)
    await $.session.start(INICIO)

    expect((await comando($, '')).text).toContain('Tema: default')
    expect((await comando($, 'synthwave')).text).toContain('Tema: synthwave')
    expect((await comando($, 'themes')).text).toContain('dracula')
    // Language and theme in the same command, any order.
    const doble = (await comando($, 'neon en')).text
    expect(doble).toContain('Theme: neon')
    expect(doble).toContain('Language: English')
    expect((await comando($, 'rainbow')).text).toContain('rainbow')

    for (const tema of ['light', 'mono', 'contrast', 'violet', 'ocean', 'sunset', 'forest', 'candy', 'dracula']) {
      await comando($, tema)
      const ui = await dibujar($)
      expect(await ui.find({ type: 'Text', text: '$1.73' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '34%' })).toBeDefined()
    }
  })

  test('the test word previews the theme with fake readings', async ($, on) => {
    motor(on, { actual: USO }, [])
    await $.session.start(INICIO)
    const salida = (await comando($, 'neon test')).text
    expect(salida).toContain('Tema: neon')
    const ui = await dibujar($)
    expect(await ui.find({ type: 'Text', text: 'Despejado 8%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$0.40' })).toBeDefined()
  })
})
