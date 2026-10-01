export type Lectura = { tokens: number; ventana: number; porcentaje: number; usd: number }
export type Limite = { kind: string; percentUsed: number; resetsAt?: string }
export type Acumulado = {
  duracionApiMs: number
  entrada: number
  cacheLeida: number
  cacheEscrita: number
  /** Cache hit % of the last main turn (null if unknown). */
  ultimoCache?: number | null
  turnos: number
}
// First reading of a limit window, to work out the pace of use.
export type Muestra = { resetsAt: string; t: number; pct: number }
export type Modo = 'completo' | 'mini' | 'oculto'
export type Idioma = 'es' | 'en' | 'pt' | 'fr' | 'de' | 'zh' | 'ja' | 'ko'
export type Tema =
  | 'default' | 'mono' | 'contrast' | 'synthwave' | 'neon'
  | 'violet' | 'ocean' | 'sunset' | 'forest' | 'candy' | 'catppuccin' | 'dracula'
export type Ajustes = { modo: Modo; idioma: Idioma; zona: string; tema: Tema }

declare module 'claude-code' {
  interface PluginState {
    'usage-weather': {
      lecturas: Lectura[]
      limites: Limite[]
      acumulado: Acumulado
      avisados: string[]
      ritmo: Record<string, Muestra>
      ajustes: Ajustes
      demo: number
    }
  }
}
