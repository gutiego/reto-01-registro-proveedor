// Utilidades compartidas por las herramientas. No exporta herramientas.
import { readFile, mkdir, writeFile, access } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

export interface CtxHerramienta {
  /** Raíz del proyecto. Todas las rutas se resuelven desde aquí. */
  directory: string
  sessionId: string
  /**
   * Lo fija el servidor: true solo si el turno anterior del agente pidió confirmación
   * y el mensaje actual del usuario la da. Sin servidor (demo) queda undefined.
   */
  confirmacionHumana?: boolean
}

export interface Herramienta<S extends z.ZodRawShape> {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: CtxHerramienta): Promise<string>
}

/** Identidad tipada: deja que TypeScript infiera los argumentos desde el esquema zod. */
export function definir<S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta<S> {
  return h
}

export const ok = (data: object): string => JSON.stringify({ ok: true, data })
export const fallo = (error: string, extra: object = {}): string =>
  JSON.stringify({ ok: false, error, ...extra })

export const esquemaCaso = z
  .string()
  .regex(/^[a-z0-9-]+$/, "solo minúsculas, números y guiones")
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, ej. 'ec-corp-andina'")

export interface Rutas {
  fixtures: string
  caso: string
  maestro: string
  glosario: string
  soportes: string
  reglas: string
  out: string
  outCaso: string
}

export function rutas(ctx: CtxHerramienta, caso = ""): Rutas {
  const fixtures = path.join(ctx.directory, "fixtures", "reto-01")
  const outEnv = process.env.OUT_DIR ?? "out"
  const out = path.isAbsolute(outEnv) ? outEnv : path.join(ctx.directory, outEnv)
  return {
    fixtures,
    caso: path.join(fixtures, "casos", caso),
    maestro: path.join(fixtures, "repositorio", "maestro.json"),
    glosario: path.join(fixtures, "glosario-campos.json"),
    soportes: path.join(fixtures, "repositorio", "soportes"),
    reglas: path.join(ctx.directory, "src", "knowledge", "reglas-negocio.json"),
    out,
    outCaso: path.join(out, caso),
  }
}

export type Lectura<T> = { ok: true; valor: T } | { ok: false; error: string }

/** Lee y parsea JSON sin lanzar. Distingue archivo ausente de archivo corrupto. */
export async function leerJson<T>(archivo: string, esquema: z.ZodType<T>): Promise<Lectura<T>> {
  let texto: string
  try {
    texto = await readFile(archivo, "utf8")
  } catch {
    return { ok: false, error: `no existe ${path.basename(archivo)}` }
  }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, error: `${path.basename(archivo)} está corrupto (JSON inválido)` }
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    return { ok: false, error: `${path.basename(archivo)} no tiene la estructura esperada: ${r.error.issues[0]?.message ?? ""}` }
  }
  return { ok: true, valor: r.data }
}

export async function existe(archivo: string): Promise<boolean> {
  try {
    await access(archivo)
    return true
  } catch {
    return false
  }
}

export async function escribir(archivo: string, contenido: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(archivo), { recursive: true })
  await writeFile(archivo, contenido)
}

/** Ruta relativa a la raíz del proyecto, con "/" para que sea legible en el chat. */
export function relativa(ctx: CtxHerramienta, archivo: string): string {
  return path.relative(ctx.directory, archivo).split(path.sep).join("/")
}

export function mensajeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------- Esquemas de los fixtures ----------

export const esquemaSolicitud = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string(),
  formato: z.string(),
  adjuntos: z.array(z.string()).default([]),
})
export type Solicitud = z.infer<typeof esquemaSolicitud>

export const esquemaPlantillaCeldas = z.array(
  z.object({ hoja: z.string(), celda_etiqueta: z.string(), etiqueta: z.string(), celda_valor: z.string() }),
)
export const esquemaPlantillaCampos = z.array(z.object({ etiqueta: z.string(), obligatorio: z.boolean() }))

export const esquemaSoportes = z.array(
  z.object({
    tipo: z.string(),
    archivo: z.string(),
    vigencia_hasta: z.string().nullable(),
    pais_emisor: z.string(),
    descripcion: z.string().optional(),
  }),
)

export const esquemaReglas = z.object({
  umbral_confianza: z.number(),
  umbral_similitud_minima: z.number(),
  fecha_referencia_por_defecto: z.string(),
  pais_maestro: z.string(),
  id_tributario_por_pais: z.record(z.string(), z.string()),
  clave_id_tributario: z.string(),
  etiquetas_tributarias_genericas: z.array(z.string()),
  prefijo_datos_bancarios: z.string(),
  palabras_vacias: z.array(z.string()),
})
export type Reglas = z.infer<typeof esquemaReglas>

export const esquemaMaestro = z.record(z.string(), z.unknown())
export const esquemaGlosario = z.record(z.string(), z.string())
