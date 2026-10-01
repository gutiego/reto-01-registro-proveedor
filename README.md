# Reto 01 · Agente "Registro como Proveedor"

Agente conversacional que lee una solicitud de registro como proveedor, llena el formulario desde el repositorio maestro (xlsx, pdf o valores para portal), arma el paquete para firma y **pide confirmación** antes de cualquier envío (simulado).

- **Link de prueba:** _pendiente de despliegue_
- **Stack:** Node 20+ con TypeScript (`tsx`), Hono, zod, exceljs, pdf-lib, Anthropic SDK. El front es HTML plano.

## Levantar en local (un comando)

```bash
cp .env.example .env      # y pon tu ANTHROPIC_API_KEY
npm install && npm start  # http://localhost:3000
```

`npm run dev` hace lo mismo con recarga automática.

## Verificación sin modelo

```bash
npm install && npm run demo
```

Limpia `out/` y ejecuta las 5 herramientas sobre los 4 casos de `fixtures/reto-01/casos/`. También muestra un envío con confirmación y tres errores controlados (caso inexistente, ruta maliciosa y valor alterado). No necesita clave.

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clave del modelo. Solo en el backend; nunca se expone. |
| `LLM_PROVIDER` | `anthropic` | Proveedor del adaptador LLM. |
| `LLM_MODEL` | `claude-opus-5-5` | Modelo. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al modelo. |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno. |
| `MAX_TOKENS_SESION` | `400000` | Tope de tokens por sesión (control de costo). |
| `FECHA_REFERENCIA` | `2026-09-03` | Fecha para evaluar la vigencia de los soportes. |
| `PORT` | `3000` | Puerto HTTP. |
| `OUT_DIR` | `out` | Carpeta de salida. |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, error? }`. Sin `sessionId` crea una sesión. |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión. |
| `GET` | `/api/health` | `{ ok, provider, model }` (sin claves). |
| `GET` | `/api/archivos/<ruta en out/>` | Descarga de archivos generados (formulario, checklist…). |

## Estructura

```
agent/prompt.md                  comportamiento (system prompt)
src/knowledge/                   conocimiento: proceso (.md) y reglas de negocio (.json)
src/tools/proveedor.ts           las 5 herramientas (proveedor_<export>)
src/tools/{mapeo,formularios,comun,registro}.ts   lógica de apoyo, validación y logs
src/llm/adapter.ts + anthropic.ts  interfaz del proveedor LLM + implementación
src/agent/ciclo.ts, sesiones.ts  ciclo del agente y sesiones
src/server.ts                    API HTTP
web/index.html                   chat
demo.ts                          herramientas sin modelo
modulo/                          bonus: agente empaquetado (npm run modulo lo regenera)
```

Prueba sugerida en el chat:

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```
