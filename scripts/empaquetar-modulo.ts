// Genera modulo/ desde las mismas fuentes que usa la app (sin copias divergentes).
// Uso: npm run modulo
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const leer = (p: string) => readFile(path.join(raiz, p), "utf8")
const escribirEn = async (p: string, contenido: string) => {
  await mkdir(path.dirname(path.join(raiz, p)), { recursive: true })
  await writeFile(path.join(raiz, p), contenido)
}

const aviso = "<!-- Generado por scripts/empaquetar-modulo.ts desde agent/prompt.md. No editar a mano. -->"
await escribirEn(
  "modulo/agent.md",
  `---
description: Prepara formularios de registro como proveedor y el paquete para firma desde el repositorio maestro, sin firmar ni enviar.
mode: primary
permission:
  edit: deny
  bash: deny
---
${aviso}

${await leer("agent/prompt.md")}`,
)
await escribirEn(
  "modulo/skill/registro-proveedor/SKILL.md",
  `---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia (estados de campo, identificador tributario por país, vigencia de soportes, datos bancarios y cierre humano).
---
<!-- Generado desde src/knowledge/registro-proveedor.md. No editar a mano. -->

${await leer("src/knowledge/registro-proveedor.md")}`,
)
await escribirEn(
  "modulo/tools/proveedor.ts",
  `// Re-exporta las herramientas reales de la aplicación: es el mismo código, no una copia.
// ctx.directory debe apuntar a la raíz del proyecto (donde están fixtures/ y src/knowledge/).
export * from "../../src/tools/proveedor.js"
`,
)
console.log("modulo/ generado: agent.md, tools/proveedor.ts, skill/registro-proveedor/SKILL.md")
