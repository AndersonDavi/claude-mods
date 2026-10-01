// usage-weather: a weather forecast for your Claude Code usage, above the prompt.
//
// Inspired by "token-weather" from the Claude Code mods examples
// (Copyright 2026 Anthropic PBC, Apache-2.0). See NOTICE.
//
// session.start: loads settings (language, time zone, view; English by default) and this session's
//   totals from $.store, registers /usage-weather and starts a 1-minute clock so
//   the reset countdowns keep moving.
// tool.call: times how long tools run in the main thread, to approximate API time.
// turn.complete: accumulates API time and cache use, takes a reading, raises alerts.
// session.measure: refreshes the plan limits live.
// ui.render (AbovePrompt): 3 rows (full), 1 row (mini) or nothing (off).
// command.run: /usage-weather [time zone] [language] [full|mini|off] | zones | languages

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Acumulado, Ajustes, Idioma, Lectura, Limite, Modo, Muestra, Tema } from '../types'

const HISTORIAL = 12
const ANCHO_BARRA = 10
const SESIONES_GUARDADAS = 30
// Minimum data (ms) in a limit window before the pace is estimated.
const RITMO_MIN_MS = 5 * 60_000

const CERO: Acumulado = { duracionApiMs: 0, entrada: 0, cacheLeida: 0, cacheEscrita: 0, turnos: 0 }
const AJUSTES_INICIALES: Ajustes = { modo: 'completo', idioma: 'en', zona: 'UTC', tema: 'default' }

const lecturas = atom({ plugin: 'usage-weather', key: 'lecturas' } as const, [] as Lectura[])
const limites = atom({ plugin: 'usage-weather', key: 'limites' } as const, [] as Limite[])
const acumulado = atom({ plugin: 'usage-weather', key: 'acumulado' } as const, CERO)
const avisados = atom({ plugin: 'usage-weather', key: 'avisados' } as const, [] as string[])
// Preview of the theme: -1 = off, otherwise the step being shown.
const demo = atom({ plugin: 'usage-weather', key: 'demo' } as const, -1)
const ritmo = atom({ plugin: 'usage-weather', key: 'ritmo' } as const, {} as Record<string, Muestra>)
const ajustes = atom({ plugin: 'usage-weather', key: 'ajustes' } as const, AJUSTES_INICIALES)

// ───────────────────────────── Languages ─────────────────────────────

interface Textos {
  nombre: string
  clima: readonly [string, string, string, string, string]
  cache: string
  sesion: string
  semana: string
  semanaCorta: string
  dias: readonly string[]
  ampm: readonly [string, string] | null
  cuenta: (dur: string, hora: string) => string
  reinicia: string
  ritmoOk: string
  llena: (dur: string) => string
  ctx75: (n: number) => string
  ctx90: (n: number) => string
  lblIdioma: string
  lblZona: string
  lblVista: string
  lblTema: string
  vistas: Record<Modo, string>
  zonasNota: (iana: boolean) => string
  invalido: (t: string) => string
  uso: string
  sugerir: string
}

const IDIOMAS: Record<Idioma, Textos> = {
  es: {
    nombre: 'Español',
    clima: ['Despejado', 'Nublado', 'Lluvia', 'Tormenta', 'Compacta ya'],
    cache: 'caché',
    sesion: 'Sesión 5h',
    semana: 'Semana',
    semanaCorta: 'sem',
    dias: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    ampm: ['am', 'pm'],
    cuenta: (d, h) => `en ${d} (${h})`,
    reinicia: 'reinicia',
    ritmoOk: 'ritmo ok',
    llena: d => `→100% en ${d}`,
    ctx75: n => `Contexto al ${n}%: considera /compact`,
    ctx90: n => `Contexto al ${n}%: compacta ya (/compact)`,
    lblIdioma: 'Idioma',
    lblZona: 'Zona horaria',
    lblVista: 'Vista',
    lblTema: 'Tema',
    vistas: { completo: 'completo', mini: 'mini', oculto: 'oculto' },
    zonasNota: iana => `También: UTC-5, +5:30${iana ? ' o cualquier nombre IANA (ej. Europe/Zurich)' : ''}`,
    invalido: t => `No reconozco "${t}". Prueba /usage-weather zonas o /usage-weather idiomas.`,
    uso: 'Uso: /usage-weather [zona] [idioma] [completo|mini|oculto] [theme] · zonas · idiomas',
    sugerir: 'Para español:',
  },
  en: {
    nombre: 'English',
    clima: ['Clear', 'Cloudy', 'Showers', 'Storm', 'Compact soon'],
    cache: 'cache',
    sesion: 'Session 5h',
    semana: 'Week',
    semanaCorta: 'wk',
    dias: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    ampm: ['AM', 'PM'],
    cuenta: (d, h) => `in ${d} (${h})`,
    reinicia: 'resets',
    ritmoOk: 'pace ok',
    llena: d => `→100% in ${d}`,
    ctx75: n => `Context at ${n}%: consider /compact`,
    ctx90: n => `Context at ${n}%: compact now (/compact)`,
    lblIdioma: 'Language',
    lblZona: 'Time zone',
    lblVista: 'View',
    lblTema: 'Theme',
    vistas: { completo: 'full', mini: 'mini', oculto: 'off' },
    zonasNota: iana => `Also: UTC-5, +5:30${iana ? ', or any IANA name (e.g. Europe/Zurich)' : ''}`,
    invalido: t => `Unrecognized "${t}". Try /usage-weather zones or /usage-weather languages.`,
    uso: 'Usage: /usage-weather [timezone] [language] [full|mini|off] [theme] · zones · languages',
    sugerir: 'For English:',
  },
  pt: {
    nombre: 'Português',
    clima: ['Limpo', 'Nublado', 'Chuva', 'Tempestade', 'Compacte já'],
    cache: 'cache',
    sesion: 'Sessão 5h',
    semana: 'Semana',
    semanaCorta: 'sem',
    dias: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    ampm: null,
    cuenta: (d, h) => `em ${d} (${h})`,
    reinicia: 'reinicia',
    ritmoOk: 'ritmo ok',
    llena: d => `→100% em ${d}`,
    ctx75: n => `Contexto em ${n}%: considere /compact`,
    ctx90: n => `Contexto em ${n}%: compacte agora (/compact)`,
    lblIdioma: 'Idioma',
    lblZona: 'Fuso horário',
    lblVista: 'Vista',
    lblTema: 'Tema',
    vistas: { completo: 'completo', mini: 'mini', oculto: 'oculto' },
    zonasNota: iana => `Também: UTC-5, +5:30${iana ? ' ou qualquer nome IANA (ex.: Europe/Zurich)' : ''}`,
    invalido: t => `Não reconheço "${t}". Tente /usage-weather zonas ou /usage-weather idiomas.`,
    uso: 'Uso: /usage-weather [fuso] [idioma] [completo|mini|oculto] [theme] · zonas · idiomas',
    sugerir: 'Para português:',
  },
  fr: {
    nombre: 'Français',
    clima: ['Dégagé', 'Nuageux', 'Averses', 'Orage', 'Compactez'],
    cache: 'cache',
    sesion: 'Session 5h',
    semana: 'Semaine',
    semanaCorta: 'sem',
    dias: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
    ampm: null,
    cuenta: (d, h) => `dans ${d} (${h})`,
    reinicia: 'réinit.',
    ritmoOk: 'rythme ok',
    llena: d => `→100% dans ${d}`,
    ctx75: n => `Contexte à ${n}% : pensez à /compact`,
    ctx90: n => `Contexte à ${n}% : compactez maintenant (/compact)`,
    lblIdioma: 'Langue',
    lblZona: 'Fuseau horaire',
    lblVista: 'Affichage',
    lblTema: 'Thème',
    vistas: { completo: 'complet', mini: 'mini', oculto: 'masqué' },
    zonasNota: iana => `Aussi : UTC-5, +5:30${iana ? ', ou tout nom IANA (ex. Europe/Zurich)' : ''}`,
    invalido: t => `"${t}" non reconnu. Essayez /usage-weather zones ou /usage-weather languages.`,
    uso: 'Usage : /usage-weather [fuseau] [langue] [complet|mini|masqué] [theme] · zones · languages',
    sugerir: 'En français :',
  },
  de: {
    nombre: 'Deutsch',
    clima: ['Klar', 'Wolkig', 'Schauer', 'Sturm', 'Bald voll'],
    cache: 'Cache',
    sesion: 'Sitzung 5h',
    semana: 'Woche',
    semanaCorta: 'Wo',
    dias: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
    ampm: null,
    cuenta: (d, h) => `in ${d} (${h})`,
    reinicia: 'Reset',
    ritmoOk: 'Tempo ok',
    llena: d => `→100% in ${d}`,
    ctx75: n => `Kontext bei ${n}%: /compact erwägen`,
    ctx90: n => `Kontext bei ${n}%: jetzt /compact`,
    lblIdioma: 'Sprache',
    lblZona: 'Zeitzone',
    lblVista: 'Ansicht',
    lblTema: 'Design',
    vistas: { completo: 'voll', mini: 'mini', oculto: 'aus' },
    zonasNota: iana => `Auch: UTC-5, +5:30${iana ? ' oder jeder IANA-Name (z. B. Europe/Zurich)' : ''}`,
    invalido: t => `"${t}" nicht erkannt. Versuche /usage-weather zones oder /usage-weather languages.`,
    uso: 'Nutzung: /usage-weather [zeitzone] [sprache] [voll|mini|aus] [theme] · zones · languages',
    sugerir: 'Auf Deutsch:',
  },
  zh: {
    nombre: '中文',
    clima: ['晴', '多云', '阵雨', '暴风雨', '该压缩了'],
    cache: '缓存',
    sesion: '会话 5h',
    semana: '本周',
    semanaCorta: '周',
    dias: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    ampm: null,
    cuenta: (d, h) => `${d}后 (${h})`,
    reinicia: '重置',
    ritmoOk: '节奏正常',
    llena: d => `→100% 还需 ${d}`,
    ctx75: n => `上下文已达 ${n}%：建议 /compact`,
    ctx90: n => `上下文已达 ${n}%：请立即 /compact`,
    lblIdioma: '语言',
    lblZona: '时区',
    lblVista: '视图',
    lblTema: '主题',
    vistas: { completo: '完整', mini: '迷你', oculto: '隐藏' },
    zonasNota: iana => `也可用：UTC-5、+5:30${iana ? '，或任意 IANA 名称（如 Europe/Zurich）' : ''}`,
    invalido: t => `无法识别 "${t}"。试试 /usage-weather zones 或 /usage-weather languages。`,
    uso: '用法：/usage-weather [时区] [语言] [完整|mini|隐藏] [theme] · zones · languages',
    sugerir: '中文：',
  },
  ja: {
    nombre: '日本語',
    clima: ['快晴', '曇り', '雨', '嵐', '要圧縮'],
    cache: 'キャッシュ',
    sesion: 'セッション 5h',
    semana: '週間',
    semanaCorta: '週',
    dias: ['日', '月', '火', '水', '木', '金', '土'],
    ampm: null,
    cuenta: (d, h) => `あと${d} (${h})`,
    reinicia: 'リセット',
    ritmoOk: 'ペース良好',
    llena: d => `→100%まで ${d}`,
    ctx75: n => `コンテキスト ${n}%：/compact を検討`,
    ctx90: n => `コンテキスト ${n}%：今すぐ /compact`,
    lblIdioma: '言語',
    lblZona: 'タイムゾーン',
    lblVista: '表示',
    lblTema: 'テーマ',
    vistas: { completo: 'フル', mini: 'ミニ', oculto: '非表示' },
    zonasNota: iana => `他に：UTC-5、+5:30${iana ? '、または任意の IANA 名 (例 Europe/Zurich)' : ''}`,
    invalido: t => `"${t}" を認識できません。/usage-weather zones か /usage-weather languages を試してください。`,
    uso: '使い方：/usage-weather [タイムゾーン] [言語] [フル|mini|非表示] [theme] · zones · languages',
    sugerir: '日本語は：',
  },
  ko: {
    nombre: '한국어',
    clima: ['맑음', '흐림', '소나기', '폭풍', '압축 필요'],
    cache: '캐시',
    sesion: '세션 5h',
    semana: '주간',
    semanaCorta: '주',
    dias: ['일', '월', '화', '수', '목', '금', '토'],
    ampm: null,
    cuenta: (d, h) => `${d} 후 (${h})`,
    reinicia: '초기화',
    ritmoOk: '페이스 양호',
    llena: d => `→100%까지 ${d}`,
    ctx75: n => `컨텍스트 ${n}%: /compact 권장`,
    ctx90: n => `컨텍스트 ${n}%: 지금 /compact`,
    lblIdioma: '언어',
    lblZona: '시간대',
    lblVista: '보기',
    lblTema: '테마',
    vistas: { completo: '전체', mini: '미니', oculto: '숨김' },
    zonasNota: iana => `또는: UTC-5, +5:30${iana ? ', 또는 모든 IANA 이름 (예: Europe/Zurich)' : ''}`,
    invalido: t => `"${t}"을(를) 인식하지 못했습니다. /usage-weather zones 또는 /usage-weather languages 를 시도해 보세요.`,
    uso: '사용법: /usage-weather [시간대] [언어] [전체|mini|숨김] [theme] · zones · languages',
    sugerir: '한국어:',
  },
}

const CODIGOS = Object.keys(IDIOMAS) as Idioma[]
const ALIAS_IDIOMA: Record<string, Idioma> = {
  spanish: 'es', espanol: 'es', english: 'en', portuguese: 'pt', portugues: 'pt', french: 'fr',
  francais: 'fr', german: 'de', chinese: 'zh', japanese: 'ja', korean: 'ko',
  jp: 'ja', cn: 'zh', kr: 'ko', br: 'pt',
}

// Words that pick a view; the localized names of every language are added below.
const MODOS: Record<string, Modo> = {
  full: 'completo', completo: 'completo', on: 'completo', show: 'completo',
  mini: 'mini',
  off: 'oculto', oculto: 'oculto', hidden: 'oculto', hide: 'oculto',
}
for (const idioma of CODIGOS) {
  for (const [modo, nombre] of Object.entries(IDIOMAS[idioma].vistas)) {
    MODOS[nombre.toLowerCase()] = modo as Modo
  }
}
const PALABRAS_TEMAS = ['themes', 'theme', 'temas', 'tema', 'colors', 'colours', 'colores']
const PALABRAS_DEMO = ['test', 'demo', 'preview', 'probar', 'prueba']
const PALABRAS_AYUDA = ['help', 'ayuda', 'ajuda', 'aide', 'hilfe', '?', '-h', '--help']
const PALABRAS_ZONAS = ['zones', 'zone', 'zonas', 'zona', 'tz', 'timezones', 'timezone']
const PALABRAS_IDIOMAS = ['languages', 'language', 'idiomas', 'idioma', 'lang', 'langs']

function resolverIdioma(texto: string): Idioma | undefined {
  const p = texto.toLowerCase()
  if ((CODIGOS as string[]).includes(p)) return p as Idioma
  const alias = ALIAS_IDIOMA[p]
  if (alias) return alias
  for (const c of CODIGOS) {
    if (IDIOMAS[c].nombre.toLowerCase() === p) return c
  }
  const base = p.split(/[-_]/)[0] ?? ''
  if (/^[a-z]{2}[-_][a-z]{2}$/.test(p) && (CODIGOS as string[]).includes(base)) return base as Idioma
  return undefined
}

// ───────────────────────────── Time zones ─────────────────────────────

// Standard (non-DST) offsets in minutes: the picker list, and the fallback when
// the runtime has no Intl.
const ZONAS: readonly { id: string; min: number }[] = [
  { id: 'America/Bogota', min: -300 }, { id: 'America/Lima', min: -300 }, { id: 'America/Panama', min: -300 },
  { id: 'America/Mexico_City', min: -360 }, { id: 'America/Caracas', min: -240 }, { id: 'America/La_Paz', min: -240 },
  { id: 'America/Santiago', min: -240 }, { id: 'America/Argentina/Buenos_Aires', min: -180 },
  { id: 'America/Sao_Paulo', min: -180 }, { id: 'America/Montevideo', min: -180 },
  { id: 'America/New_York', min: -300 }, { id: 'America/Toronto', min: -300 }, { id: 'America/Chicago', min: -360 },
  { id: 'America/Denver', min: -420 }, { id: 'America/Los_Angeles', min: -480 },
  { id: 'Europe/London', min: 0 }, { id: 'Europe/Lisbon', min: 0 }, { id: 'Europe/Madrid', min: 60 },
  { id: 'Europe/Paris', min: 60 }, { id: 'Europe/Berlin', min: 60 }, { id: 'Europe/Rome', min: 60 },
  { id: 'Europe/Athens', min: 120 }, { id: 'Europe/Istanbul', min: 180 }, { id: 'Europe/Moscow', min: 180 },
  { id: 'Africa/Lagos', min: 60 }, { id: 'Africa/Cairo', min: 120 }, { id: 'Africa/Johannesburg', min: 120 },
  { id: 'Africa/Nairobi', min: 180 },
  { id: 'Asia/Dubai', min: 240 }, { id: 'Asia/Karachi', min: 300 }, { id: 'Asia/Kolkata', min: 330 },
  { id: 'Asia/Dhaka', min: 360 }, { id: 'Asia/Bangkok', min: 420 }, { id: 'Asia/Jakarta', min: 420 },
  { id: 'Asia/Shanghai', min: 480 }, { id: 'Asia/Hong_Kong', min: 480 }, { id: 'Asia/Singapore', min: 480 },
  { id: 'Asia/Manila', min: 480 }, { id: 'Asia/Taipei', min: 480 }, { id: 'Asia/Seoul', min: 540 },
  { id: 'Asia/Tokyo', min: 540 },
  { id: 'Australia/Perth', min: 480 }, { id: 'Australia/Sydney', min: 600 }, { id: 'Pacific/Auckland', min: 720 },
  { id: 'Pacific/Honolulu', min: -600 },
]

// "UTC-5", "-5", "+5:30", "gmt+0530" → milliseconds; undefined if it is not an offset.
function parseOffset(texto: string): number | undefined {
  const m = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(texto.trim())
  if (!m) return undefined
  const horas = Number(m[2])
  const minutos = Number(m[3] ?? 0)
  if (horas > 14 || minutos > 59) return undefined
  return (m[1] === '-' ? -1 : 1) * (horas * 60 + minutos) * 60_000
}

function etiquetaOffset(ms: number) {
  const min = Math.abs(ms) / 60_000
  const horas = Math.floor(min / 60)
  const resto = min % 60
  return `UTC${ms < 0 ? '-' : '+'}${horas}${resto ? `:${String(resto).padStart(2, '0')}` : ''}`
}

// The IANA name as the runtime spells it, or undefined (no such zone, or no Intl).
function canonica(id: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: id }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function offsetIana(zona: string, tMs: number): number | undefined {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(tMs))
    const v: Record<string, number> = {}
    for (const p of partes) {
      if (p.type !== 'literal') v[p.type] = Number(p.value)
    }
    const local = Date.UTC(v.year ?? 0, (v.month ?? 1) - 1, v.day ?? 1, v.hour ?? 0, v.minute ?? 0, v.second ?? 0)
    return local - Math.floor(tMs / 1000) * 1000
  } catch {
    return undefined
  }
}

// Offset of `zona` from UTC at the instant `tMs`, in ms (DST included when Intl is there).
function offsetMs(zona: string, tMs: number): number {
  const fijo = parseOffset(zona)
  if (fijo !== undefined) return fijo
  if (zona === 'UTC') return 0
  return offsetIana(zona, tMs) ?? (ZONAS.find(z => z.id === zona)?.min ?? 0) * 60_000
}

// What the person typed → the zone as stored: 'UTC', 'UTC-5', an IANA name, or undefined.
function resolverZona(texto: string): string | undefined {
  const crudo = texto.trim()
  if (/^(utc|gmt|z)$/i.test(crudo)) return 'UTC'
  const fijo = parseOffset(crudo)
  if (fijo !== undefined) return etiquetaOffset(fijo)
  const canon = canonica(crudo)
  if (canon) return canon
  const ciudad = crudo.toLowerCase().replace(/_/g, ' ')
  return ZONAS.find(z => z.id.toLowerCase().replace(/_/g, ' ').endsWith(`/${ciudad}`))?.id
}

function zonaSistema(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// The system language, only to suggest it on a first run; never used to pick the display language.
function idiomaDelSistema(): Idioma | undefined {
  try {
    const base = (new Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase().split(/[-_.]/)[0] ?? ''
    return (CODIGOS as string[]).includes(base) ? (base as Idioma) : undefined
  } catch {
    return undefined
  }
}

function textoZonas(t: Textos) {
  const grupos = new Map<string, string[]>()
  for (const z of ZONAS) {
    const i = z.id.indexOf('/')
    const region = z.id.slice(0, i)
    const lista = grupos.get(region) ?? []
    lista.push(z.id.slice(i + 1))
    grupos.set(region, lista)
  }
  const filas = [...grupos].map(([region, lugares]) => `${region}: ${lugares.join(', ')}`)
  return `${t.lblZona}:\n${filas.join('\n')}\nUTC\n${t.zonasNota(canonica('America/Bogota') !== undefined)}`
}

function textoIdiomas() {
  return CODIGOS.map(c => `${c}  ${IDIOMAS[c].nombre}`).join('\n')
}

// Fake readings the preview steps through, from calm to nearly full.
const PASOS_DEMO = [
  { pct: 8, usd: 0.4, cinco: 5, semana: 12, cache: 95 },
  { pct: 30, usd: 1.73, cinco: 35, semana: 34, cache: 92 },
  { pct: 55, usd: 3.9, cinco: 60, semana: 58, cache: 70 },
  { pct: 78, usd: 7.8, cinco: 82, semana: 79, cache: 45 },
  { pct: 94, usd: 12.9, cinco: 96, semana: 93, cache: 8 },
]
const DEMO_PASO_MS = 2500

// ───────────────────────────── Themes ─────────────────────────────

// How one role is drawn. `color` is a raw color (hex) or an ANSI name; mono
// themes use weight and inversion instead of color.
type Estilo = { color?: string; bold?: boolean; inverse?: boolean }
type Paleta = { ok: Estilo; warn: Estilo; bad: Estilo; costo: Estilo; api: Estilo; neutro: Estilo }

const paleta = (ok: string, warn: string, bad: string, costo: string, api: string, neutro = 'gray'): Paleta => ({
  ok: { color: ok }, warn: { color: warn }, bad: { color: bad }, costo: { color: costo }, api: { color: api }, neutro: { color: neutro },
})

// The first theme uses the terminal's own ANSI colors, so it follows its palette.
const TEMAS: Record<Tema, Paleta> = {
  default: paleta('green', 'yellow', 'red', 'cyan', 'magenta'),
  light: paleta('#0a7d2c', '#9a5b00', '#c4001a', '#0b6a8a', '#8a2a9e', '#666666'),
  mono: {
    ok: {}, warn: { bold: true }, bad: { bold: true, inverse: true }, costo: { bold: true }, api: {}, neutro: {},
  },
  // Okabe-Ito colors: told apart with every common kind of color blindness.
  contrast: paleta('#56b4e9', '#f0e442', '#d55e00', '#ffffff', '#cc79a7', '#aaaaaa'),
  synthwave: paleta('#72f1b8', '#fede5d', '#ff3a8c', '#36f9f6', '#ff7edb', '#8f7fb8'),
  neon: paleta('#39ff14', '#fff200', '#ff073a', '#00e5ff', '#ff00ff', '#7a7a9a'),
  violet: paleta('#b794f6', '#f0abfc', '#ff5c8a', '#a78bfa', '#e879f9', '#8b7fb0'),
  ocean: paleta('#5eead4', '#fde68a', '#fb7185', '#38bdf8', '#818cf8', '#7b8fa6'),
  sunset: paleta('#ffd166', '#ff9a3c', '#ef476f', '#ffb4a2', '#c77dff', '#a8878a'),
  forest: paleta('#8bd450', '#e6c94a', '#e5603f', '#5fc9a0', '#b6a06a', '#7e8f7a'),
  candy: paleta('#a8e6cf', '#ffd3b6', '#ff8b94', '#a0d8ef', '#d4a5ff', '#b0a8b9'),
  dracula: paleta('#50fa7b', '#f1fa8c', '#ff5555', '#8be9fd', '#bd93f9', '#6272a4'),
}
const NOMBRES_TEMAS = Object.keys(TEMAS) as Tema[]

function resolverTema(texto: string): Tema | undefined {
  const p = texto.toLowerCase()
  return (NOMBRES_TEMAS as string[]).includes(p) ? (p as Tema) : undefined
}

function textoTemas() {
  return NOMBRES_TEMAS.join(', ')
}

function ajustesValidos(x: unknown): Ajustes | undefined {
  if (!x || typeof x !== 'object') return undefined
  const a = x as Partial<Ajustes>
  const zona = typeof a.zona === 'string' ? resolverZona(a.zona) : undefined
  if (!a.idioma || !(a.idioma in IDIOMAS) || !zona) return undefined
  const modo: Modo = a.modo === 'mini' || a.modo === 'oculto' ? a.modo : 'completo'
  const tema = typeof a.tema === 'string' ? resolverTema(a.tema) ?? 'default' : 'default'
  return { modo, idioma: a.idioma, zona, tema }
}

// ───────────────────────────── Hooks ─────────────────────────────

const BANDAS = [
  { hasta: 25, icono: '☀', nivel: 'ok' as const },
  { hasta: 50, icono: '☁', nivel: 'ok' as const },
  { hasta: 75, icono: '☂', nivel: 'warn' as const },
  { hasta: 90, icono: '☇', nivel: 'bad' as const },
  { hasta: Infinity, icono: '↯', nivel: 'bad' as const },
]

export const register: Register = on => {
  // Time with tools running in the main thread during the current turn.
  let herramientasMs = 0
  let activas = 0
  let desde = 0
  let reloj: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'usage-weather',
      description: 'Usage weather bar: /usage-weather [timezone] [language] [theme] [full|mini|off]',
    })
    const guardado = ajustesValidos(await $.store.get('ajustes'))
    const inicial: Ajustes = guardado ?? {
      modo: 'completo',
      idioma: 'en',
      zona: resolverZona(zonaSistema()) ?? 'UTC',
      tema: 'default',
    }
    await update($, ajustes, () => inicial)
    if (!guardado) {
      await $.store.set('ajustes', inicial)
      const sugerido = idiomaDelSistema()
      const pista = sugerido && sugerido !== inicial.idioma ? ` · ${IDIOMAS[sugerido].sugerir} /usage-weather ${sugerido}` : ''
      $.ui.toast(
        `usage-weather: ${IDIOMAS[inicial.idioma].nombre}, ${inicial.zona}. Settings: /usage-weather help${pista}`,
        { timeoutMs: 20_000 },
      )
    }
    const sesion = await $.store.get(`sesion:${await $.session.id()}`)
    if (sesion && typeof sesion === 'object') {
      await update($, acumulado, a => (a.turnos > 0 ? a : { ...CERO, ...(sesion as Acumulado) }))
    }
    reloj?.cancel()
    reloj = $.clock.every(60_000, () => void $.ui.invalidate('ui.render'))
    await tomarLectura($)
    return result
  })

  on('command.run', { command: 'usage-weather' }, async ($, e) => {
    const actual = await read($, ajustes)
    const t = IDIOMAS[actual.idioma]
    const todos = e.args.trim().split(/\s+/).filter(Boolean)
    const pideDemo = todos.some(p => PALABRAS_DEMO.includes(p.toLowerCase()))
    const tokens = todos.filter(p => !PALABRAS_DEMO.includes(p.toLowerCase()))
    const palabras = tokens.map(p => p.toLowerCase())

    if (pideDemo && tokens.length === 0) {
      await empezarDemo($)
      return { text: `${t.lblTema}: ${actual.tema} · demo ${PASOS_DEMO.length} × ${DEMO_PASO_MS / 1000}s` }
    }

    if (tokens.length === 0 || palabras.some(p => PALABRAS_AYUDA.includes(p))) {
      const ejemplos = '/usage-weather bogota es  ·  /usage-weather ja Asia/Tokyo  ·  /usage-weather mini  ·  /usage-weather synthwave'
      return { text: `${await resumen($, actual)}\n${t.uso}\n${ejemplos}` }
    }
    if (palabras.some(p => PALABRAS_ZONAS.includes(p))) {
      return { text: textoZonas(t) }
    }
    if (palabras.some(p => PALABRAS_TEMAS.includes(p))) {
      return { text: textoTemas() }
    }
    if (palabras.some(p => PALABRAS_IDIOMAS.includes(p))) {
      return { text: textoIdiomas() }
    }

    // Each word is a view, a language or a time zone, in any order; one bad word
    // changes nothing.
    const siguiente: Ajustes = { ...actual }
    for (const token of tokens) {
      const modo = MODOS[token.toLowerCase()]
      const tema = modo ? undefined : resolverTema(token)
      const idioma = modo || tema ? undefined : resolverIdioma(token)
      const zona = modo || tema || idioma ? undefined : resolverZona(token)
      if (modo) siguiente.modo = modo
      else if (tema) siguiente.tema = tema
      else if (idioma) siguiente.idioma = idioma
      else if (zona) siguiente.zona = zona
      else return { text: t.invalido(token) }
    }
    await update($, ajustes, () => siguiente)
    await $.store.set('ajustes', siguiente)
    if (pideDemo) await empezarDemo($)
    return { text: `✔ ${await resumen($, siguiente)}` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      return next(e)
    }
    if (activas === 0) {
      desde = await $.clock.now()
    }
    activas += 1
    try {
      return await next(e)
    } finally {
      activas -= 1
      if (activas === 0) {
        herramientasMs += (await $.clock.now()) - desde
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = e.usage
    const apiMs = e.agentId ? 0 : Math.max(0, e.durationMs - herramientasMs)
    if (!e.agentId) {
      herramientasMs = 0
    }
    const nuevo = await update($, acumulado, a => ({
      duracionApiMs: a.duracionApiMs + apiMs,
      entrada: a.entrada + (u?.input_tokens ?? 0),
      cacheLeida: a.cacheLeida + (u?.cache_read_input_tokens ?? 0),
      cacheEscrita: a.cacheEscrita + (u?.cache_creation_input_tokens ?? 0),
      turnos: a.turnos + (e.agentId ? 0 : 1),
      ultimoCache: e.agentId ? a.ultimoCache : porcentajeCache(u),
    }))
    await guardarSesion($, nuevo)
    if (!e.agentId) {
      await tomarLectura($)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await registrarLimites($, e.rateLimits)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const todas = await read($, lecturas)
    const aj = await read($, ajustes)
    const paso = await read($, demo)
    const enDemo = paso >= 0 && paso < PASOS_DEMO.length
    if (e.props.hasSurvey || (todas.length === 0 && !enDemo) || (aj.modo === 'oculto' && !enDemo)) {
      return next(e)
    }
    const t = IDIOMAS[aj.idioma]
    const { Box, Text } = $.ui.resolve(e)
    const ahoraMs = await $.clock.now()
    const columnas = e.props.bodyColumns ?? 80
    const falso = enDemo ? PASOS_DEMO[paso]! : undefined
    const lims: readonly Limite[] = falso
      ? [
          { kind: 'five_hour', percentUsed: falso.cinco, resetsAt: new Date(ahoraMs + 200 * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: falso.semana, resetsAt: new Date(ahoraMs + 2 * 86_400_000).toISOString() },
        ]
      : await read($, limites)
    const acc = falso ? { ...(await read($, acumulado)), ultimoCache: falso.cache } : await read($, acumulado)
    const muestras = falso ? {} : await read($, ritmo)

    const ahora: Lectura = falso
      ? { tokens: falso.pct * 10_000, ventana: 1_000_000, porcentaje: falso.pct, usd: falso.usd }
      : todas[todas.length - 1]!
    const antes = !falso && todas.length > 1 ? todas[todas.length - 2] : undefined
    const pal = TEMAS[aj.tema] ?? TEMAS.default
    const nivel = (n: 'ok' | 'warn' | 'bad') => pal[n]
    const colorUso = (pct: number) => nivel(pct < 50 ? 'ok' : pct < 80 ? 'warn' : 'bad')
    const banda = bandaPara(ahora.porcentaje)
    const estiloBanda = nivel(banda.nivel)
    const totalEntrada = acc.entrada + acc.cacheLeida + acc.cacheEscrita
    const cachePct = falso ? 99 : totalEntrada > 0 ? Math.round((acc.cacheLeida / totalEntrada) * 100) : null
    // Main number = last turn (drops after /compact or a long pause); Σ = whole session.
    const ultimo = acc.ultimoCache ?? null
    const cachePrincipal = ultimo ?? cachePct
    const estiloCache = cachePrincipal === null ? pal.neutro : nivel(cachePrincipal >= 80 ? 'ok' : cachePrincipal >= 50 ? 'warn' : 'bad')
    const delta = antes ? ahora.usd - antes.usd : 0
    const cinco = lims.find(l => l.kind === 'five_hour')
    const semana = lims.find(l => l.kind === 'seven_day')

    if (aj.modo === 'mini') {
      return (
        <Box flexDirection="row" paddingX={1}>
          <Text {...estiloBanda} bold>{`${banda.icono} ${ahora.porcentaje}%`}</Text>
          <Text dimColor>{' · '}</Text>
          <Text {...pal.costo}>{`$${ahora.usd.toFixed(2)}`}</Text>
          {cinco ? <Text dimColor>{' · 5h '}</Text> : null}
          {cinco ? <Text {...colorUso(cinco.percentUsed)}>{`${Math.round(cinco.percentUsed)}%`}</Text> : null}
          {semana ? <Text dimColor>{` · ${t.semanaCorta} `}</Text> : null}
          {semana ? <Text {...colorUso(semana.percentUsed)}>{`${Math.round(semana.percentUsed)}%`}</Text> : null}
        </Box>
      )
    }

    const llenosCtx = llenos(ahora.porcentaje)
    const anchoEtiqueta = Math.max(ancho(t.sesion), ancho(t.semana))
    const filaLimite = (l: Limite) => {
      const color = colorUso(l.percentUsed)
      const n = llenos(l.percentUsed)
      const r = textoRitmo(l, muestras[l.kind], ahoraMs, t)
      const cuando = l.resetsAt ? textoReinicio(l, ahoraMs, t, aj.zona) : ''
      return (
        <Box flexDirection="row">
          <Text bold>{etiqueta(nombreLimite(l.kind, t), anchoEtiqueta)}</Text>
          <Text {...color}>{'█'.repeat(n)}</Text>
          <Text dimColor>{'░'.repeat(ANCHO_BARRA - n)}</Text>
          <Text {...color} bold>{` ${Math.round(l.percentUsed)}%`}</Text>
          <Text dimColor>{cuando ? `  ↻ ${cuando}` : ''}</Text>
          {r && columnas >= 70 ? <Text {...nivel(r.nivel)}>{`  ${r.texto}`}</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text {...estiloBanda} bold>{`${banda.icono} ${t.clima[banda.indice]} ${ahora.porcentaje}%`}</Text>
          <Text dimColor>{` ${corto(ahora.tokens)}/${corto(ahora.ventana)}`}</Text>
          {columnas >= 72 ? <Text {...estiloBanda}>{` ${'█'.repeat(llenosCtx)}`}</Text> : null}
          {columnas >= 72 ? <Text dimColor>{'░'.repeat(ANCHO_BARRA - llenosCtx)}</Text> : null}
          <Text dimColor>{' · '}</Text>
          <Text {...pal.costo} bold>{`$${ahora.usd.toFixed(2)}`}</Text>
          {delta >= 0.005 ? <Text {...pal.costo}>{` (+$${delta.toFixed(2)})`}</Text> : null}
          <Text dimColor>{' · ⏱API '}</Text>
          <Text {...pal.api}>{duracion(acc.duracionApiMs)}</Text>
          <Text dimColor>{` · ${t.cache} `}</Text>
          <Text {...estiloCache}>{cachePrincipal === null ? '—' : `${cachePrincipal}%`}</Text>
          {ultimo !== null && cachePct !== null && ultimo !== cachePct ? <Text dimColor>{` Σ${cachePct}%`}</Text> : null}
        </Box>
        {cinco ? filaLimite(cinco) : null}
        {semana ? filaLimite(semana) : null}
      </Box>
    )
  })
}

// ───────────────────────────── Readings and alerts ─────────────────────────────

async function resumen($: EngineInterface, aj: Ajustes) {
  const t = IDIOMAS[aj.idioma]
  const ahora = await $.clock.now()
  const off = offsetMs(aj.zona, ahora)
  const local = new Date(ahora + off)
  const hora = formatoHora(local.getUTCHours(), local.getUTCMinutes(), t)
  return `${t.lblIdioma}: ${t.nombre} · ${t.lblZona}: ${aj.zona} (${etiquetaOffset(off)}, ${hora}) · ${t.lblVista}: ${t.vistas[aj.modo]} · ${t.lblTema}: ${aj.tema}`
}

function porcentajeCache(u: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): number | null {
  const total = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0)
  return total > 0 ? Math.round(((u?.cache_read_input_tokens ?? 0) / total) * 100) : null
}

// Steps the preview every few seconds, then goes back to the real readings.
let relojDemo: { cancel: () => void } | undefined

async function empezarDemo($: EngineInterface) {
  relojDemo?.cancel()
  await update($, demo, () => 0)
  void $.ui.invalidate('ui.render')
  relojDemo = $.clock.every(DEMO_PASO_MS, () => {
    void (async () => {
      const paso = (await read($, demo)) + 1
      await update($, demo, () => (paso >= PASOS_DEMO.length ? -1 : paso))
      if (paso >= PASOS_DEMO.length) relojDemo?.cancel()
      void $.ui.invalidate('ui.render')
    })()
  })
}

async function tomarLectura($: EngineInterface) {
  try {
    const { context, cost, rateLimits } = await $.session.usage()
    await registrarLimites($, rateLimits)
    if (!context || !context.window) {
      return
    }
    const tokens = context.tokens ?? 0
    const lectura: Lectura = {
      tokens,
      ventana: context.window,
      porcentaje: Math.round(context.percent ?? (tokens / context.window) * 100),
      usd: cost?.usd ?? 0,
    }
    await update($, lecturas, prev => [...prev.filter(r => r.tokens > 0), lectura].slice(-HISTORIAL))
    if (tokens > 0) {
      const t = IDIOMAS[(await read($, ajustes)).idioma]
      await avisar($, 'ctx:75', lectura.porcentaje >= 75, lectura.porcentaje < 65, t.ctx75(lectura.porcentaje))
      await avisar($, 'ctx:90', lectura.porcentaje >= 90, lectura.porcentaje < 80, t.ctx90(lectura.porcentaje))
    }
  } catch {
    // No reading this turn; the band keeps the last one.
  }
}

async function registrarLimites($: EngineInterface, rateLimits: readonly Limite[]) {
  const lims = rateLimits.map(r => ({ ...r }))
  await update($, limites, () => lims)
  const ahoraMs = await $.clock.now()
  const aj = await read($, ajustes)
  const t = IDIOMAS[aj.idioma]
  for (const l of lims) {
    if (l.resetsAt) {
      const resetsAt = l.resetsAt
      await update($, ritmo, m => {
        const previa = m[l.kind]
        if (previa && previa.resetsAt === resetsAt && previa.pct <= l.percentUsed) return m
        return { ...m, [l.kind]: { resetsAt, t: ahoraMs, pct: l.percentUsed } }
      })
    }
    const cuando = l.resetsAt ? textoReinicio(l, ahoraMs, t, aj.zona) : ''
    const texto = `${nombreLimite(l.kind, t)} ${Math.round(l.percentUsed)}%${cuando ? ` · ${t.reinicia} ${cuando}` : ''}`
    const ventana = l.resetsAt ?? ''
    await avisar($, `${l.kind}:80:${ventana}`, l.percentUsed >= 80, false, texto)
    await avisar($, `${l.kind}:90:${ventana}`, l.percentUsed >= 90, false, texto)
  }
}

// One alert per key: raised on crossing the threshold, re-armed when `rearmar`.
async function avisar($: EngineInterface, clave: string, cruzo: boolean, rearmar: boolean, texto: string) {
  const ya = (await read($, avisados)).includes(clave)
  if (cruzo && !ya) {
    $.ui.toast(texto)
    await update($, avisados, a => [...a, clave].slice(-50))
  } else if (rearmar && ya) {
    await update($, avisados, a => a.filter(k => k !== clave))
  }
}

async function guardarSesion($: EngineInterface, acc: Acumulado) {
  try {
    const id = await $.session.id()
    await $.store.set(`sesion:${id}`, acc)
    const claves = (await $.store.keys()).filter(k => k.startsWith('sesion:'))
    for (const vieja of claves.slice(0, Math.max(0, claves.length - SESIONES_GUARDADAS))) {
      await $.store.delete(vieja)
    }
  } catch {
    // Not saved this time; retried next turn.
  }
}

// ───────────────────────────── Text helpers ─────────────────────────────

function nombreLimite(kind: string, t: Textos) {
  return kind === 'five_hour' ? t.sesion : kind === 'seven_day' ? t.semana : kind
}

// "in 4h 40m (8:10 PM)" for the 5-hour window; "Mon 10:00 AM" for the weekly one.
function textoReinicio(l: Limite, ahoraMs: number, t: Textos, zona: string) {
  const ms = Date.parse(l.resetsAt!)
  if (Number.isNaN(ms)) return ''
  const local = new Date(ms + offsetMs(zona, ms))
  const hora = formatoHora(local.getUTCHours(), local.getUTCMinutes(), t)
  if (l.kind === 'five_hour') {
    return t.cuenta(cuentaRegresiva(Math.max(0, ms - ahoraMs)), hora)
  }
  return `${t.dias[local.getUTCDay()] ?? ''} ${hora}`
}

function formatoHora(h: number, m: number, t: Textos) {
  const mm = String(m).padStart(2, '0')
  if (!t.ampm) return `${String(h).padStart(2, '0')}:${mm}`
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? t.ampm[0] : t.ampm[1]}`
}

// "→100% in 2h 10m" if at this pace the window fills before it resets; "pace ok" if not.
function textoRitmo(l: Limite, m: Muestra | undefined, ahoraMs: number, t: Textos) {
  if (!m || !l.resetsAt || m.resetsAt !== l.resetsAt) return null
  const transcurrido = ahoraMs - m.t
  const subio = l.percentUsed - m.pct
  if (transcurrido < RITMO_MIN_MS || subio <= 0) return null
  const faltaReinicio = Date.parse(l.resetsAt) - ahoraMs
  const llenaEn = ((100 - l.percentUsed) / subio) * transcurrido
  if (llenaEn >= faltaReinicio) return { texto: t.ritmoOk, nivel: 'ok' as const }
  return { texto: t.llena(duracion(llenaEn)), nivel: llenaEn < faltaReinicio / 2 ? ('bad' as const) : ('warn' as const) }
}

// Terminal cells a string takes: CJK and fullwidth characters take two.
function ancho(s: string) {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const ancha =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || c >= 0x20000
    w += ancha ? 2 : 1
  }
  return w
}

function etiqueta(s: string, anchoTotal: number) {
  return `${s}${' '.repeat(Math.max(0, anchoTotal - ancho(s)))} `
}

function bandaPara(porcentaje: number) {
  const indice = Math.max(0, BANDAS.findIndex(b => porcentaje < b.hasta))
  const banda = BANDAS[indice === -1 ? BANDAS.length - 1 : indice]!
  return { ...banda, indice: porcentaje >= 90 ? 4 : indice }
}

function llenos(pct: number) {
  return Math.round((Math.min(Math.max(pct, 0), 100) / 100) * ANCHO_BARRA)
}

// Countdown: minutes rounded up, as the desktop app shows them.
function cuentaRegresiva(ms: number) {
  const min = Math.ceil(ms / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

function duracion(ms: number) {
  const min = Math.floor(ms / 60_000)
  if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`
  if (min >= 1) return `${min}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.round(ms / 1000)}s`
}

function corto(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
