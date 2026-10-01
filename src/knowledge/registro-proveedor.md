# Conocimiento del proceso: registro como proveedor

## Para qué existe
Los clientes de Periferia (Colombia, Ecuador, Perú, Panamá, Honduras) piden registrar a Periferia como proveedor. Envían un correo con un formulario (Excel, PDF o portal web) y una lista de soportes. Los datos ya están en el repositorio maestro; el trabajo es trasladarlos sin errores y armar el paquete para la firma del representante legal.

## Actores
- **Recepción**: deja la solicitud en la carpeta de entrada.
- **Analista administrativa**: usa este agente, revisa faltantes y aprueba.
- **Representante legal**: firma el formulario. No usa el agente.

## Estados de un campo
| Estado | Cuándo |
|---|---|
| `lleno` | El campo existe en el maestro (por glosario o clave directa) con confianza ≥ 0.8. |
| `requiere_confirmacion` | Mapeo con confianza < 0.8, etiqueta tributaria ambigua o identificador de otro país. |
| `faltante` | No hay equivalente en el maestro o el dato está vacío. Nunca se inventa. |

## Identificador tributario por país (RN1)
| País | Nombre | Qué se hace |
|---|---|---|
| CO | NIT | Se llena con el NIT. |
| EC, PE, PA | RUC | Se llena con el NIT colombiano y queda `requiere_confirmacion` ("identificador extranjero"). |
| HN | RTN | Igual que RUC. |

Periferia solo tiene NIT colombiano. La tabla vive en `src/knowledge/reglas-negocio.json`: cambiar una regla no requiere tocar código.

## Soportes
- Se toman de `repositorio/soportes/index.json`.
- `vigencia_hasta` anterior a la fecha de referencia → **vencido**: no se adjunta y bloquea la firma.
- Exigido y no existe → **ausente**: bloquea la firma.
- Un campo faltante **no** bloquea, pero aparece en el checklist.
- La fecha de referencia por defecto es 2026-09-03 (`FECHA_REFERENCIA`), para que los resultados sean reproducibles.

## Datos bancarios (RN2)
Solo se escriben en el formulario si la plantilla los pide. Nunca van en el borrador de correo ni se muestran completos en el chat.

## Formatos de salida
- **xlsx**: cada etiqueta y valor en la hoja y celda que indica la plantilla.
- **pdf**: documento generado con todos los campos en el orden de la plantilla.
- **portal web**: no se automatiza. Se genera `valores-portal.md` para copiar. Credenciales y "Enviar" son humanos.

## Cierre
El agente arma `out/<caso>/paquete/` (formulario, soportes vigentes, `checklist.md`, `borrador-correo.md`) y pregunta antes de cualquier envío. "Enviar" en este sistema solo escribe `ENVIO-SIMULADO.md` y exige confirmación explícita del usuario en el mensaje inmediatamente anterior.
