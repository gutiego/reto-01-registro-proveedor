// Lógica pura de mapeo etiqueta -> clave del maestro. Sin E/S.
import type { Reglas } from "./comun.js"

export interface CampoLleno {
  etiqueta: string
  clave: string
  valor: string
  fuente: string
  confianza: number
}
export interface CampoPorConfirmar extends CampoLleno {
  nota: string
}
export interface CampoFaltante {
  etiqueta: string
  motivo: string
}
export interface ResultadoMapeo {
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoPorConfirmar[]
}

/** Minúsculas, sin tildes ni signos: "Código CIIU" -> "codigo ciiu". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokens(texto: string, vacias: Set<string>): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((t) => t && !vacias.has(t)))
}

/** Similitud de Jaccard entre conjuntos de palabras: |A∩B| / |A∪B|. */
export function similitud(a: string, b: string, vacias: Set<string>): number {
  const ta = tokens(a, vacias)
  const tb = tokens(b, vacias)
  if (ta.size === 0 || tb.size === 0) return 0
  let comun = 0
  for (const t of ta) if (tb.has(t)) comun++
  return comun / (ta.size + tb.size - comun)
}

/** Lee un valor por ruta con puntos: "representante_legal.nombre". */
export function leerRuta(obj: unknown, ruta: string): unknown {
  let actual: unknown = obj
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

/** Convierte el dato del maestro en el texto que va al formulario. null si no hay dato. */
export function formatearValor(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  if (typeof valor === "string" || typeof valor === "number") return String(valor)
  if (Array.isArray(valor)) return valor.map(String).join(", ")
  return null // objetos completos no se vuelcan a una celda
}

interface Candidato {
  clave: string
  confianza: number
  metodo: string
}

/** Busca la clave del maestro: glosario exacto -> clave directa del maestro -> similitud. */
export function buscarClave(
  etiqueta: string,
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
  reglas: Reglas,
): Candidato | null {
  const norm = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === norm) return { clave, confianza: 1, metodo: "glosario" }
  }
  const claveDirecta = norm.replace(/ /g, "_")
  if (claveDirecta in maestro) return { clave: claveDirecta, confianza: 0.9, metodo: "clave del maestro" }

  const vacias = new Set(reglas.palabras_vacias)
  let mejor: Candidato | null = null
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    const s = similitud(etiqueta, sinonimo, vacias)
    if (!mejor || s > mejor.confianza) mejor = { clave, confianza: Number(s.toFixed(2)), metodo: `similitud con "${sinonimo}"` }
  }
  return mejor && mejor.confianza >= reglas.umbral_similitud_minima ? mejor : null
}

/** RN1: el identificador tributario depende del país del cliente. */
function notaTributaria(etiqueta: string, pais: string, reglas: Reglas): string | null {
  const esperado = reglas.id_tributario_por_pais[pais] ?? "identificador tributario"
  if (pais !== reglas.pais_maestro) {
    return `identificador extranjero: el cliente (${pais}) pide ${esperado}; Periferia solo tiene NIT colombiano, se llena con el NIT`
  }
  if (reglas.etiquetas_tributarias_genericas.includes(normalizar(etiqueta))) {
    return `etiqueta ambigua; en ${pais} el equivalente es ${esperado}`
  }
  return null
}

export function mapearCampos(
  etiquetas: string[],
  pais: string,
  glosario: Record<string, string>,
  maestro: Record<string, unknown>,
  reglas: Reglas,
): ResultadoMapeo {
  const r: ResultadoMapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] }
  for (const etiqueta of etiquetas) {
    const candidato = buscarClave(etiqueta, glosario, maestro, reglas)
    if (!candidato) {
      r.faltantes.push({ etiqueta, motivo: "no hay equivalente en el maestro ni en el glosario" })
      continue
    }
    const valor = formatearValor(leerRuta(maestro, candidato.clave))
    if (valor === null) {
      r.faltantes.push({ etiqueta, motivo: `la clave ${candidato.clave} no tiene dato en el maestro` })
      continue
    }
    const campo: CampoLleno = {
      etiqueta,
      clave: candidato.clave,
      valor,
      fuente: `maestro.json#${candidato.clave} (${candidato.metodo})`,
      confianza: candidato.confianza,
    }
    const nota =
      candidato.clave === reglas.clave_id_tributario
        ? notaTributaria(etiqueta, pais, reglas)
        : candidato.confianza < reglas.umbral_confianza
          ? `mapeo por ${candidato.metodo}, confianza ${candidato.confianza} < ${reglas.umbral_confianza}`
          : null
    if (nota) r.requiere_confirmacion.push({ ...campo, nota })
    else r.llenos.push(campo)
  }
  return r
}

/** Etiquetas que el cliente pide con un nombre ambiguo o de otro país (HU-1). */
export function camposAmbiguos(etiquetas: string[], pais: string, reglas: Reglas, glosario: Record<string, string>) {
  return etiquetas.flatMap((etiqueta) => {
    const clave = Object.entries(glosario).find(([s]) => normalizar(s) === normalizar(etiqueta))?.[1]
    if (clave !== reglas.clave_id_tributario) return []
    const nota = notaTributaria(etiqueta, pais, reglas)
    return nota ? [{ etiqueta, propuesta: reglas.id_tributario_por_pais[pais] ?? "?", nota }] : []
  })
}
