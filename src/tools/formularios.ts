// Generadores de salida por formato: xlsx (P0), pdf (P1), portal (P2: solo valores copiables).
import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import { escribir } from "./comun.js"

export interface FilaFormulario {
  etiqueta: string
  valor: string // vacío si el campo es faltante
  estado: "lleno" | "faltante" | "requiere_confirmacion"
  obligatorio?: boolean
}

export interface CeldaPlantilla {
  hoja: string
  celda_etiqueta: string
  etiqueta: string
  celda_valor: string
}

/** Escribe etiqueta y valor exactamente en la hoja y celda que indica la plantilla. */
export async function generarXlsx(archivo: string, celdas: CeldaPlantilla[], valores: Map<string, string>): Promise<void> {
  const libro = new ExcelJS.Workbook()
  for (const c of celdas) {
    const hoja = libro.getWorksheet(c.hoja) ?? libro.addWorksheet(c.hoja)
    const celdaEtiqueta = hoja.getCell(c.celda_etiqueta)
    celdaEtiqueta.value = c.etiqueta
    celdaEtiqueta.font = { bold: true }
    hoja.getCell(c.celda_valor).value = valores.get(c.etiqueta) ?? ""
  }
  libro.eachSheet((hoja) => {
    hoja.columns.forEach((col) => (col.width = 38))
  })
  const buffer = await libro.xlsx.writeBuffer()
  await escribir(archivo, new Uint8Array(buffer))
}

// Helvetica estándar usa WinAnsi: cubre tildes y ñ, no emojis ni símbolos raros.
const latin1 = (s: string) => s.replace(/[^\x20-\xFF]/g, "?")

function partirLinea(texto: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of latin1(texto).split(" ")) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tam) > ancho && actual) {
      lineas.push(actual)
      actual = palabra
    } else actual = prueba
  }
  return [...lineas, actual]
}

/** PDF generado (no AcroForm): todos los campos con etiqueta y valor, en el orden de la plantilla. */
export async function generarPdf(archivo: string, titulo: string, subtitulo: string, filas: FilaFormulario[]): Promise<void> {
  const doc = await PDFDocument.create()
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  const [anchoPag, altoPag, margen] = [595, 842, 50]
  let pagina = doc.addPage([anchoPag, altoPag])
  let y = altoPag - margen

  const linea = (texto: string, fuente: PDFFont, tam: number, x = margen) => {
    if (y < margen + tam) {
      pagina = doc.addPage([anchoPag, altoPag])
      y = altoPag - margen
    }
    pagina.drawText(texto, { x, y, size: tam, font: fuente, color: rgb(0.1, 0.1, 0.1) })
    y -= tam + 6
  }

  linea(latin1(titulo), negrita, 16)
  linea(latin1(subtitulo), normal, 10)
  y -= 10
  for (const f of filas) {
    linea(latin1(`${f.etiqueta}${f.obligatorio ? " *" : ""}`), negrita, 10)
    for (const l of partirLinea(f.valor || " ", normal, 11, anchoPag - 2 * margen - 15)) linea(l, normal, 11, margen + 15)
    y -= 4
  }
  y -= 10
  linea("* Campo obligatorio. Firma del representante legal: ______________________", normal, 9)
  await escribir(archivo, await doc.save())
}

/** P2: el portal no se automatiza; se dejan los valores listos para copiar. */
export async function generarValoresPortal(archivo: string, cliente: string, cuerpoCorreo: string, filas: FilaFormulario[]): Promise<void> {
  const url = cuerpoCorreo.match(/https?:\/\/\S+?(?=[\s.,)]*(\s|$))/)?.[0] ?? "(no indicada en el correo)"
  const tabla = filas
    .map((f) => `| ${f.etiqueta}${f.obligatorio ? " *" : ""} | ${f.valor || "—"} | ${f.estado} |`)
    .join("\n")
  const md = `# Valores para el portal de ${cliente}

> **Formato no soportado para llenado automático.** Este archivo contiene los valores listos para copiar.
> El ingreso de credenciales, la carga de soportes y el clic en "Enviar" los hace una persona.

- Portal: ${url}
- Credenciales: las tiene el representante legal (nunca se guardan aquí).

| Campo | Valor | Estado |
|---|---|---|
${tabla}

\\* Campo obligatorio.
`
  await escribir(archivo, md)
}
