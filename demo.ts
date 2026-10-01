// Ejecuta todas las herramientas sobre todos los casos, sin modelo de lenguaje.
// Uso: npm run demo   (o: npx tsx demo.ts)
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ejecutarHerramienta } from "./src/tools/registro.js"
import type { CtxHerramienta } from "./src/tools/comun.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const ctx: CtxHerramienta = { directory, sessionId: "demo" }

type Salida = { ok: boolean; error?: string; data?: Record<string, unknown> }
const parse = (s: string) => JSON.parse(s) as Salida

async function llamar(nombre: string, args: unknown): Promise<Salida> {
  const e = await ejecutarHerramienta(nombre, args, ctx)
  console.log(`  ${e.ok ? "✔" : "✖"} ${nombre.padEnd(30)} ${e.resumen}`)
  return parse(e.salida)
}

async function procesarCaso(caso: string): Promise<void> {
  console.log(`\n━━━ ${caso} ━━━`)
  const sol = await llamar("proveedor_leer_solicitud", { caso })
  if (!sol.ok || !sol.data) return
  const mapeo = await llamar("proveedor_mapear_campos", { caso, campos: sol.data.campos })
  if (mapeo.ok && mapeo.data) await llamar("proveedor_generar_formulario", { caso, mapeo: mapeo.data })
  const paquete = await llamar("proveedor_armar_paquete", { caso })
  await llamar("proveedor_simular_envio", { caso, confirmado: false })

  const d = mapeo.data as { faltantes?: { etiqueta: string }[]; requiere_confirmacion?: { etiqueta: string; nota: string }[] } | undefined
  const p = paquete.data as { listo_para_firma?: boolean; checklist?: { bloqueos: string[] } } | undefined
  console.log(`  · faltantes: ${d?.faltantes?.map((f) => f.etiqueta).join(", ") || "ninguno"}`)
  console.log(`  · por confirmar: ${d?.requiere_confirmacion?.map((f) => `${f.etiqueta} (${f.nota})`).join("; ") || "ninguno"}`)
  console.log(`  · listo_para_firma: ${p?.listo_para_firma}  ${p?.checklist?.bloqueos.join(" | ") ?? ""}`)
}

async function main(): Promise<void> {
  await rm(path.join(directory, process.env.OUT_DIR ?? "out"), { recursive: true, force: true })
  const casos = (await readdir(path.join(directory, "fixtures", "reto-01", "casos"))).sort()
  console.log(`Fecha de referencia: ${process.env.FECHA_REFERENCIA ?? "2026-09-03 (por defecto)"}`)
  for (const caso of casos) await procesarCaso(caso)

  console.log("\n━━━ Confirmación explícita: envío del caso co-industrias-delta ━━━")
  await llamar("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: true })

  console.log("\n━━━ Manejo de errores ━━━")
  await llamar("proveedor_leer_solicitud", { caso: "no-existe" })
  await llamar("proveedor_leer_solicitud", { caso: "../secreto" })
  await llamar("proveedor_generar_formulario", {
    caso: "co-industrias-delta",
    mapeo: { llenos: [{ etiqueta: "NIT", clave: "nit", valor: "999999999" }], requiere_confirmacion: [], faltantes: [] },
  })
}

main().catch((e: unknown) => {
  console.error("La demo falló:", e)
  process.exit(1)
})
