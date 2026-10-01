// Herramientas del agente "Registro como Proveedor".
// Cada export es una herramienta; el modelo la ve como proveedor_<export>.
// Contrato: execute nunca lanza y devuelve JSON con { ok, data } o { ok: false, error }.
import { readdir, copyFile, rm, readFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  definir, ok, fallo, esquemaCaso, rutas, leerJson, existe, escribir, relativa, mensajeError,
  esquemaSolicitud, esquemaPlantillaCeldas, esquemaPlantillaCampos, esquemaSoportes, esquemaReglas,
  esquemaMaestro, esquemaGlosario, type CtxHerramienta, type Solicitud, type Reglas,
} from "./comun.js"
import { mapearCampos, camposAmbiguos, leerRuta, formatearValor, type ResultadoMapeo } from "./mapeo.js"
import { generarXlsx, generarPdf, generarValoresPortal, type FilaFormulario, type CeldaPlantilla } from "./formularios.js"

// ---------- Carga de datos (privado) ----------

interface Base {
  maestro: Record<string, unknown>
  glosario: Record<string, string>
  reglas: Reglas
}

async function cargarBase(ctx: CtxHerramienta): Promise<Base | string> {
  const r = rutas(ctx)
  const [maestro, glosario, reglas] = await Promise.all([
    leerJson(r.maestro, esquemaMaestro),
    leerJson(r.glosario, esquemaGlosario),
    leerJson(r.reglas, esquemaReglas),
  ])
  if (!maestro.ok) return `repositorio maestro: ${maestro.error}`
  if (!glosario.ok) return `glosario: ${glosario.error}`
  if (!reglas.ok) return `reglas de negocio: ${reglas.error}`
  return { maestro: maestro.valor, glosario: glosario.valor, reglas: reglas.valor }
}

interface CampoPlantilla {
  etiqueta: string
  obligatorio?: boolean
  hoja?: string
  celda_etiqueta?: string
  celda_valor?: string
}

interface Caso {
  solicitud: Solicitud
  formato: "xlsx" | "pdf" | "portal" | "desconocido"
  campos: CampoPlantilla[]
  errorPlantilla: string | null
  soportes: string[]
}

async function casosDisponibles(ctx: CtxHerramienta): Promise<string[]> {
  try {
    return (await readdir(path.join(rutas(ctx).fixtures, "casos"))).sort()
  } catch {
    return []
  }
}

/** Carga un caso. La plantilla o los soportes rotos no impiden devolver lo demás (HU-5). */
async function cargarCaso(ctx: CtxHerramienta, caso: string): Promise<Caso | string> {
  const r = rutas(ctx, caso)
  if (!(await existe(r.caso))) {
    return `el caso "${caso}" no existe. Casos disponibles: ${(await casosDisponibles(ctx)).join(", ")}`
  }
  const sol = await leerJson(path.join(r.caso, "solicitud.json"), esquemaSolicitud)
  if (!sol.ok) return `solicitud del caso "${caso}": ${sol.error}`
  const solicitud = sol.valor
  const formato = (["xlsx", "pdf", "portal"] as const).find((f) => f === solicitud.formato) ?? "desconocido"

  let campos: CampoPlantilla[] = []
  let errorPlantilla: string | null = null
  if (formato === "xlsx") {
    const p = await leerJson(path.join(r.caso, "plantilla-celdas.json"), esquemaPlantillaCeldas)
    if (p.ok) campos = p.valor
    else errorPlantilla = p.error
  } else {
    const p = await leerJson(path.join(r.caso, "plantilla-campos.json"), esquemaPlantillaCampos)
    if (p.ok) campos = p.valor
    else errorPlantilla = p.error
  }
  const sop = await leerJson(path.join(r.caso, "soportes-exigidos.json"), z.array(z.string()))
  return { solicitud, formato, campos, errorPlantilla, soportes: sop.ok ? sop.valor : [] }
}

async function registrarMapeo(ctx: CtxHerramienta, caso: string, mapeo: ResultadoMapeo): Promise<void> {
  await escribir(path.join(rutas(ctx, caso).outCaso, "mapeo.json"), JSON.stringify(mapeo, null, 2))
}

// ---------- Herramientas ----------

export const leer_solicitud = definir({
  description:
    "Lee el correo y la plantilla de un caso y devuelve país, cliente, formato de salida, campos pedidos, campos ambiguos y soportes exigidos.",
  args: { caso: esquemaCaso },
  async execute(args, ctx) {
    try {
      const base = await cargarBase(ctx)
      if (typeof base === "string") return fallo(base)
      const c = await cargarCaso(ctx, args.caso)
      if (typeof c === "string") return fallo(c)
      const etiquetas = c.campos.map((x) => x.etiqueta)
      const advertencias = [
        ...(c.errorPlantilla ? [`plantilla ilegible (${c.errorPlantilla}); se puede seguir con el paquete de soportes`] : []),
        ...(c.formato === "portal" ? ["formato portal web: no se llena automáticamente; se generan valores para copiar"] : []),
        ...(c.formato === "desconocido" ? [`formato "${c.solicitud.formato}" no soportado`] : []),
      ]
      return ok({
        caso: args.caso,
        pais: c.solicitud.pais,
        cliente: c.solicitud.cliente,
        remitente: c.solicitud.de,
        asunto: c.solicitud.asunto,
        fecha: c.solicitud.fecha,
        formato: c.formato,
        campos: etiquetas,
        campos_detalle: c.campos,
        campos_ambiguos: camposAmbiguos(etiquetas, c.solicitud.pais, base.reglas, base.glosario),
        soportes: c.soportes,
        advertencias,
        resumen: `${c.solicitud.cliente} (${c.solicitud.pais}), formato ${c.formato}, ${etiquetas.length} campos, ${c.soportes.length} soportes`,
      })
    } catch (e) {
      return fallo(`no se pudo leer la solicitud: ${mensajeError(e)}`)
    }
  },
})

export const mapear_campos = definir({
  description:
    "Cruza cada campo pedido con el repositorio maestro y lo clasifica en llenos (con ruta del dato), faltantes o requiere_confirmacion; nunca inventa valores.",
  args: {
    caso: esquemaCaso,
    campos: z.array(z.string()).describe("Etiquetas de los campos tal como las devolvió proveedor_leer_solicitud"),
  },
  async execute(args, ctx) {
    try {
      const base = await cargarBase(ctx)
      if (typeof base === "string") return fallo(base)
      const c = await cargarCaso(ctx, args.caso)
      if (typeof c === "string") return fallo(c)
      const mapeo = mapearCampos(args.campos, c.solicitud.pais, base.glosario, base.maestro, base.reglas)
      await registrarMapeo(ctx, args.caso, mapeo)
      return ok({
        ...mapeo,
        resumen: `${mapeo.llenos.length} llenos, ${mapeo.faltantes.length} faltantes, ${mapeo.requiere_confirmacion.length} por confirmar`,
      })
    } catch (e) {
      return fallo(`no se pudo mapear: ${mensajeError(e)}`)
    }
  },
})

const esquemaCampoMapeado = z.object({
  etiqueta: z.string().describe("Etiqueta del campo"),
  clave: z.string().describe("Clave del maestro de donde sale el valor"),
  valor: z.string().describe("Valor tal como lo devolvió proveedor_mapear_campos"),
})

export const generar_formulario = definir({
  description:
    "Genera el formulario lleno en el formato del cliente (xlsx o pdf) o, si es portal web, un archivo con los valores listos para copiar.",
  args: {
    caso: esquemaCaso,
    mapeo: z
      .object({
        llenos: z.array(esquemaCampoMapeado).describe("Campos llenos de proveedor_mapear_campos"),
        requiere_confirmacion: z.array(esquemaCampoMapeado).describe("Campos por confirmar de proveedor_mapear_campos"),
        faltantes: z.array(z.object({ etiqueta: z.string() })).describe("Campos faltantes de proveedor_mapear_campos"),
      })
      .describe("Resultado de proveedor_mapear_campos, sin modificar los valores"),
  },
  async execute(args, ctx) {
    try {
      const base = await cargarBase(ctx)
      if (typeof base === "string") return fallo(base)
      const c = await cargarCaso(ctx, args.caso)
      if (typeof c === "string") return fallo(c)
      if (c.errorPlantilla) return fallo(`no se puede generar el formulario: plantilla ilegible (${c.errorPlantilla})`)

      // CA2: todo valor debe coincidir con el maestro. Si el modelo alteró algo, se rechaza.
      const alterados = [...args.mapeo.llenos, ...args.mapeo.requiere_confirmacion].filter(
        (m) => formatearValor(leerRuta(base.maestro, m.clave)) !== m.valor,
      )
      if (alterados.length > 0) {
        return fallo(`valores que no coinciden con el maestro: ${alterados.map((a) => a.etiqueta).join(", ")}. Usa el mapeo sin modificar.`)
      }
      const valores = new Map<string, string>()
      const estado = new Map<string, FilaFormulario["estado"]>()
      for (const m of args.mapeo.llenos) {
        valores.set(m.etiqueta, m.valor)
        estado.set(m.etiqueta, "lleno")
      }
      for (const m of args.mapeo.requiere_confirmacion) {
        valores.set(m.etiqueta, m.valor)
        estado.set(m.etiqueta, "requiere_confirmacion")
      }
      const filas: FilaFormulario[] = c.campos.map((p) => ({
        etiqueta: p.etiqueta,
        valor: valores.get(p.etiqueta) ?? "",
        estado: estado.get(p.etiqueta) ?? "faltante",
        obligatorio: p.obligatorio,
      }))
      const dir = rutas(ctx, args.caso).outCaso
      const titulo = `Formulario de registro de proveedor - ${c.solicitud.cliente}`
      const sub = `Proveedor: ${String(base.maestro.razon_social ?? "")} | Solicitud ${c.solicitud.id} del ${c.solicitud.fecha}`

      if (c.formato === "xlsx") {
        const archivo = path.join(dir, "formulario.xlsx")
        await generarXlsx(archivo, c.campos as CeldaPlantilla[], valores)
        return ok({ ruta: relativa(ctx, archivo), formato: "xlsx", resumen: `formulario.xlsx con ${filas.length} campos` })
      }
      if (c.formato === "pdf") {
        const archivo = path.join(dir, "formulario.pdf")
        await generarPdf(archivo, titulo, sub, filas)
        return ok({ ruta: relativa(ctx, archivo), formato: "pdf", resumen: `formulario.pdf con ${filas.length} campos` })
      }
      if (c.formato === "portal") {
        const archivo = path.join(dir, "valores-portal.md")
        await generarValoresPortal(archivo, c.solicitud.cliente, c.solicitud.cuerpo, filas)
        return ok({
          ruta: relativa(ctx, archivo),
          formato: "portal",
          soportado: false,
          aviso: "formato no soportado: portal web. Se generó valores-portal.md para copiar; credenciales y envío los hace una persona.",
          resumen: "formato no soportado (portal); valores-portal.md generado",
        })
      }
      return fallo(`formato no soportado: "${c.solicitud.formato}"`)
    } catch (e) {
      return fallo(`no se pudo generar el formulario: ${mensajeError(e)}`)
    }
  },
})

// ---------- Paquete para firma ----------

interface EstadoSoporte {
  tipo: string
  estado: "presente" | "ausente" | "vencido"
  detalle: string
  archivo?: string
}

async function evaluarSoportes(ctx: CtxHerramienta, exigidos: string[], hoy: string): Promise<EstadoSoporte[] | string> {
  const r = rutas(ctx)
  const indice = await leerJson(path.join(r.soportes, "index.json"), esquemaSoportes)
  if (!indice.ok) return `índice de soportes: ${indice.error}`
  const resultado: EstadoSoporte[] = []
  for (const tipo of exigidos) {
    const s = indice.valor.find((x) => x.tipo === tipo)
    if (!s || !(await existe(path.join(r.soportes, s.archivo)))) {
      resultado.push({ tipo, estado: "ausente", detalle: "no existe en el repositorio de soportes" })
    } else if (s.vigencia_hasta && s.vigencia_hasta < hoy) {
      resultado.push({ tipo, estado: "vencido", detalle: `venció el ${s.vigencia_hasta}`, archivo: s.archivo })
    } else {
      resultado.push({ tipo, estado: "presente", detalle: s.vigencia_hasta ? `vigente hasta ${s.vigencia_hasta}` : "sin vencimiento", archivo: s.archivo })
    }
  }
  return resultado
}

function nombreFormulario(formato: Caso["formato"]): string | null {
  return formato === "xlsx" ? "formulario.xlsx" : formato === "pdf" ? "formulario.pdf" : formato === "portal" ? "valores-portal.md" : null
}

function checklistMd(c: Caso, hoy: string, listo: boolean, soportes: EstadoSoporte[], mapeo: ResultadoMapeo | null, bloqueos: string[]): string {
  const icono = { presente: "✅", ausente: "❌", vencido: "⛔" }
  const filasSoportes = soportes.map((s) => `| ${icono[s.estado]} | ${s.tipo} | ${s.estado} | ${s.detalle} |`).join("\n")
  const faltantes = mapeo?.faltantes.map((f) => `- ${f.etiqueta}: ${f.motivo}`).join("\n") || "- Ninguno"
  const porConfirmar = mapeo?.requiere_confirmacion.map((f) => `- ${f.etiqueta} = ${f.valor} → ${f.nota}`).join("\n") || "- Ninguno"
  return `# Checklist · ${c.solicitud.cliente} (${c.solicitud.pais})

- Caso: ${c.solicitud.id}
- Vigencias evaluadas al: **${hoy}**
- Estado: ${listo ? "✅ **LISTO PARA FIRMA**" : "❌ **NO LISTO PARA FIRMA**"}

## Soportes exigidos

| | Soporte | Estado | Detalle |
|---|---|---|---|
${filasSoportes}

## Campos faltantes (no bloquean, el cliente debe recibirlos o justificarse)
${mapeo ? faltantes : "- No se ha ejecutado el mapeo de campos"}

## Campos que requieren confirmación humana
${mapeo ? porConfirmar : "- No se ha ejecutado el mapeo de campos"}

## Bloqueos
${bloqueos.map((b) => `- ${b}`).join("\n") || "- Ninguno"}

## Pendiente de una persona
- Revisar campos por confirmar.
- Firma del representante legal.
- Envío al cliente (el agente no envía).
`
}

function borradorCorreoMd(c: Caso, base: Base, adjuntos: string[]): string {
  const rep = String(leerRuta(base.maestro, "representante_legal.nombre") ?? "el representante legal")
  const contacto = leerRuta(base.maestro, "contacto_comercial.email")
  // RN2: el borrador nunca incluye datos bancarios; solo nombra adjuntos.
  return `**Para:** ${c.solicitud.de}
**Asunto:** RE: ${c.solicitud.asunto}

Buen día,

En atención a su solicitud, remitimos el formulario de registro de ${String(base.maestro.razon_social ?? "Periferia IT Group S.A.S.")} como proveedor de ${c.solicitud.cliente}, firmado por ${rep}, junto con los siguientes soportes:

${adjuntos.map((a) => `- ${a}`).join("\n")}

Quedamos atentos a cualquier información adicional.

Cordialmente,
${String(base.maestro.razon_social ?? "")}
${typeof contacto === "string" ? contacto : ""}
`
}

function contieneDatoBancario(texto: string, base: Base): boolean {
  const banco = base.maestro.banco
  if (!banco || typeof banco !== "object") return false
  return Object.entries(banco).some(([k, v]) => ["numero_cuenta", "swift"].includes(k) && typeof v === "string" && texto.includes(v))
}

export const armar_paquete = definir({
  description:
    "Arma la carpeta del paquete para firma (formulario, soportes vigentes, checklist y borrador de correo) y dice si está listo para firma.",
  args: {
    caso: esquemaCaso,
    hoy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Fecha de referencia YYYY-MM-DD para evaluar vencimientos; si se omite se usa FECHA_REFERENCIA"),
  },
  async execute(args, ctx) {
    try {
      const base = await cargarBase(ctx)
      if (typeof base === "string") return fallo(base)
      const c = await cargarCaso(ctx, args.caso)
      if (typeof c === "string") return fallo(c)
      const hoy = args.hoy ?? process.env.FECHA_REFERENCIA ?? base.reglas.fecha_referencia_por_defecto
      const r = rutas(ctx, args.caso)
      const dirPaquete = path.join(r.outCaso, "paquete")
      await rm(dirPaquete, { recursive: true, force: true })

      const soportes = await evaluarSoportes(ctx, c.soportes, hoy)
      if (typeof soportes === "string") return fallo(soportes)
      const mapeoLeido = await leerJson(path.join(r.outCaso, "mapeo.json"), z.custom<ResultadoMapeo>((v) => typeof v === "object" && v !== null))
      const mapeo = mapeoLeido.ok ? mapeoLeido.valor : null

      const adjuntos: string[] = []
      const bloqueos: string[] = []
      const nombreForm = nombreFormulario(c.formato)
      if (nombreForm && (await existe(path.join(r.outCaso, nombreForm)))) {
        await mkdir(dirPaquete, { recursive: true })
        await copyFile(path.join(r.outCaso, nombreForm), path.join(dirPaquete, nombreForm))
        adjuntos.push(nombreForm)
      } else {
        bloqueos.push("falta el formulario: ejecuta proveedor_generar_formulario")
      }
      for (const s of soportes) {
        if (s.estado === "presente" && s.archivo) {
          const destino = path.join(dirPaquete, "soportes", s.archivo)
          await mkdir(path.dirname(destino), { recursive: true })
          await copyFile(path.join(rutas(ctx).soportes, s.archivo), destino)
          adjuntos.push(`soportes/${s.archivo}`)
        }
        if (s.estado === "vencido") bloqueos.push(`soporte vencido: ${s.tipo} (${s.detalle}); actualizarlo`)
        if (s.estado === "ausente") bloqueos.push(`soporte exigido ausente: ${s.tipo}; conseguirlo`)
      }
      const listo = bloqueos.length === 0

      const borrador = borradorCorreoMd(c, base, adjuntos)
      if (contieneDatoBancario(borrador, base)) return fallo("el borrador de correo incluiría datos bancarios; se detuvo (RN2)")
      await escribir(path.join(dirPaquete, "checklist.md"), checklistMd(c, hoy, listo, soportes, mapeo, bloqueos))
      await escribir(path.join(dirPaquete, "borrador-correo.md"), borrador)
      const estado = { caso: args.caso, listo_para_firma: listo, fecha_referencia: hoy, bloqueos, adjuntos }
      await escribir(path.join(dirPaquete, "estado.json"), JSON.stringify(estado, null, 2))

      return ok({
        ruta: relativa(ctx, dirPaquete),
        listo_para_firma: listo,
        fecha_referencia: hoy,
        checklist: {
          soportes,
          campos_faltantes: mapeo?.faltantes.map((f) => f.etiqueta) ?? [],
          campos_por_confirmar: mapeo?.requiere_confirmacion.map((f) => ({ etiqueta: f.etiqueta, nota: f.nota })) ?? [],
          bloqueos,
        },
        archivos: [...adjuntos, "checklist.md", "borrador-correo.md"],
        siguiente_paso: "Pedir confirmación explícita al usuario antes de proveedor_simular_envio.",
        pide_confirmacion: true,
        resumen: `${listo ? "listo para firma" : `NO listo (${bloqueos.length} bloqueos)`}, vigencias al ${hoy}`,
      })
    } catch (e) {
      return fallo(`no se pudo armar el paquete: ${mensajeError(e)}`)
    }
  },
})

export const simular_envio = definir({
  description:
    "Simula el envío del paquete escribiendo ENVIO-SIMULADO.md; solo se ejecuta si el usuario confirmó explícitamente en su último mensaje.",
  args: {
    caso: esquemaCaso,
    confirmado: z.boolean().describe("true solo si el último mensaje del usuario confirma explícitamente el envío"),
  },
  async execute(args, ctx) {
    try {
      // RN4/CA3: hace falta el flag del modelo Y, si hay servidor, la confirmación real del usuario.
      if (!args.confirmado || ctx.confirmacionHumana === false) {
        return fallo("requiere confirmación explícita", { pide_confirmacion: true })
      }
      const r = rutas(ctx, args.caso)
      const estado = await leerJson(
        path.join(r.outCaso, "paquete", "estado.json"),
        z.object({ listo_para_firma: z.boolean(), fecha_referencia: z.string(), bloqueos: z.array(z.string()), adjuntos: z.array(z.string()) }),
      )
      if (!estado.ok) return fallo("no hay paquete armado para este caso: ejecuta proveedor_armar_paquete primero")
      const sol = JSON.parse(await readFile(path.join(r.caso, "solicitud.json"), "utf8")) as { de?: string; asunto?: string }
      const e = estado.valor
      const md = `# ENVÍO SIMULADO · ${args.caso}

> Simulación: no se envió ningún correo. En producción, este paso lo ejecuta una persona tras la firma.

- Fecha y hora: ${new Date().toISOString()}
- Destinatario: ${sol.de ?? "(desconocido)"}
- Asunto: RE: ${sol.asunto ?? ""}
- Confirmado por el usuario en la sesión: ${ctx.sessionId}
- Estado del paquete: ${e.listo_para_firma ? "listo para firma" : "NO listo para firma"} (vigencias al ${e.fecha_referencia})

## Adjuntos
${e.adjuntos.map((a) => `- ${a}`).join("\n")}

## Advertencias
${e.bloqueos.map((b) => `- ${b}`).join("\n") || "- Ninguna"}
`
      const archivo = path.join(r.outCaso, "ENVIO-SIMULADO.md")
      await escribir(archivo, md)
      return ok({
        ruta: relativa(ctx, archivo),
        listo_para_firma: e.listo_para_firma,
        advertencias: e.bloqueos,
        resumen: `envío simulado${e.listo_para_firma ? "" : " con advertencias"}`,
      })
    } catch (e) {
      return fallo(`no se pudo simular el envío: ${mensajeError(e)}`)
    }
  },
})
