# SOLUCIÓN · Reto 01 · Agente "Registro como Proveedor"

## 1. Problema en una frase

La analista administrativa transcribe a mano, en el formato de cada cliente, datos de Periferia que ya existen (NIT, dirección, banco…) y busca los soportes uno por uno. Eso cuesta días, provoca errores en datos sensibles y depende de una sola persona. **Le duele a la analista y, por el retraso del registro, a la facturación.**

## 2. Arquitectura

```
┌─────────────────┐  POST /api/chat   ┌──────────────────────────────────────────────┐
│ web/index.html  │ ────────────────▶ │ src/server.ts (Hono)                         │
│ historial,      │ ◀──────────────── │  └─ src/agent/ciclo.ts   ciclo + tope + conf.│
│ tool calls,     │  reply, toolCalls,│      ├─ src/llm/adapter.ts  interfaz propia  │
│ confirmación    │  needsConfirmation│      │   └─ anthropic.ts    implementación    │
└─────────────────┘                   │      └─ src/tools/registro.ts  zod + logs    │
                                      │           └─ src/tools/proveedor.ts  (5)     │
                                      └───────────────┬─────────────────┬────────────┘
                                                      │                 │
                                    fixtures/reto-01 (solo lectura)   out/ (escritura)
```

| Capa | Dónde vive |
|---|---|
| **Comportamiento** | `agent/prompt.md`: orden de herramientas, reglas que no se rompen y formato de respuesta. |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` (proceso, se inyecta en el system prompt) y `src/knowledge/reglas-negocio.json` (umbral de confianza, ID tributario por país, fecha por defecto), que las herramientas leen en cada ejecución. Cambiar una regla no toca código. |
| **Ejecución** | `src/tools/proveedor.ts` y sus helpers puros (`mapeo.ts`, `formularios.ts`). Son la única fuente de valores. |

## 3. Ciclo del agente

`src/agent/ciclo.ts`, `ejecutarTurno()`:

1. Se agrega el mensaje del usuario al historial y se comprueba el **tope de tokens por sesión**.
2. Bucle de hasta `MAX_ITERACIONES` (25): `llm.enviar(historial, herramientas, sistema)`. Si el modelo pide herramientas, cada una se valida con zod y se ejecuta con `ejecutarHerramienta()`, que nunca lanza y deja el registro en `out/log.jsonl` y `out/<caso>/log.jsonl`. Los resultados vuelven al modelo. Si no pide herramientas, el turno termina.
3. **Tope alcanzado (CA1):** se responde de forma determinista con la lista de lo hecho, sin otra llamada al modelo.
4. **Errores (CA5):** el adaptador traduce los errores del proveedor (clave inválida, timeout, *rate limit*) a lenguaje claro. Se agrega al historial un mensaje de asistente con el error y la sesión sigue viva.

**Confirmación humana (CA3/RN4), con doble cerrojo:**
- Las herramientas marcan `pide_confirmacion: true` (`armar_paquete`, y `simular_envio` cuando se llama sin confirmar). El turno termina con `needsConfirmation: true` y el front muestra un borde amarillo, una etiqueta y botones Sí/No.
- En el turno siguiente, el servidor calcula `ctx.confirmacionHumana = turno anterior pidió confirmación && el mensaje del usuario es afirmativo y no contiene negación`.
- `proveedor_simular_envio` exige **a la vez** `confirmado: true` (decisión del modelo) y `ctx.confirmacionHumana` (hecho verificado por el servidor). Aunque el modelo se equivoque, el envío no ocurre sin la confirmación en el turno inmediatamente anterior.

**El modelo no puede afirmar valores (CA2):** el prompt lo prohíbe y, además, el diseño lo impide. `generar_formulario` recibe el mapeo, pero **recalcula cada valor desde el maestro** y rechaza la llamada si alguno no coincide (la demo lo prueba con un NIT alterado).

## 4. Elección del modelo

- **Proveedor y modelo:** Anthropic, `claude-opus-5-5`, configurable con `LLM_MODEL`. Effort `medium`.
- **Fallback:** activé `fallbacks: "default"` del lado del servidor. Si el modelo declina por política, la API reintenta en otro modelo y el chat no se queda en blanco.
- **Por qué:** uso fiable de herramientas en cadenas de 4–5 llamadas y buen seguimiento de reglas negativas ("no muestres la cuenta", "no envíes sin confirmar"). El cálculo pesado es determinista, así que el modelo solo orquesta y redacta.
- **Costo medido:** el caso `ec-corp-andina` completo (4 herramientas y resumen) consumió unos **34.600 tokens**, casi todo de entrada (system prompt, esquemas y resultados). A $4/M de entrada y $20/M de salida eso son **unos 0,15–0,20 USD por caso**. El flujo con envío (3 turnos) llegó a unos 65.000 tokens, unos 0,30 USD.
- **Cómo bajarlo:** con *prompt caching* del system prompt y las herramientas (no implementado) o con `claude-sonnet-5-5` ($2/$10), sin tocar el ciclo: solo cambia `LLM_MODEL`.

## 5. Diseño del portal web (7.4)

**Hoy:** `generar_formulario` responde "formato no soportado" y genera `valores-portal.md`, con los valores en el orden del portal, su estado y la URL extraída del correo.

**Estrategia propuesta:** un **navegador controlado por el agente en modo asistido**, con Playwright sobre un perfil aislado, y no un RPA desatendido.
1. Una persona abre el portal en el navegador controlado e **ingresa usuario, contraseña, MFA y CAPTCHA**. El agente no ve ni guarda credenciales.
2. Ya con la sesión iniciada, el agente lee el DOM, mapea etiquetas de campos a valores con el mismo `mapear_campos` y **rellena sin enviar**. Marca en pantalla los campos dudosos o faltantes.
3. La persona revisa, carga los soportes si el portal lo exige y **hace clic en "Enviar"**.

**Credenciales:** nunca en el repositorio, el prompt, los logs ni el historial del chat. Las tiene el representante legal, que las recibe del cliente por un canal aparte. Si hiciera falta automatizar más, irían en un gestor de secretos (Azure Key Vault o 1Password) y solo las leería el proceso del navegador, nunca el LLM.

**Límites:**

| Límite | Tratamiento |
|---|---|
| CAPTCHA y MFA | Siempre los resuelve un humano. |
| Cambios de layout | Mapeo por etiqueta visible, no por selector fijo. Si la confianza es menor de 0.8, el campo se deja para el humano. |
| Portales con sesiones que caducan | Se reanuda el llenado sin reenviar nada. |
| Términos de uso del portal | Hay que revisarlos, porque algunos prohíben la automatización; en ese caso queda el modo "valores para copiar". |

**Reparto de tareas:** el agente prepara y llena. El humano ingresa credenciales, revisa, adjunta si aplica y envía.

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Mapeo determinista** (glosario, luego clave directa del maestro, luego similitud de Jaccard con umbral) | Pedir al LLM que mapee las etiquetas | Es trazable (cada valor lleva `fuente: maestro.json#clave`), reproducible en `demo.ts` y no alucina. Una etiqueta nueva cae en `requiere_confirmacion` o `faltante` en vez de adivinarse. |
| 2 | **Bucle manual con adaptador propio** (`ProveedorLLM.enviar`) | Tool runner del SDK o frameworks como LangChain/LangGraph | El PRD exige poder cambiar de proveedor sin tocar el ciclo. El bucle ocupa unas 60 líneas y controla tope, tokens y confirmación. |
| 3 | **Confirmación verificada en el servidor** además del flag del modelo | Confiar solo en el prompt | Un prompt se puede saltar. El servidor solo habilita el envío si el turno anterior pidió confirmación y el usuario respondió afirmativamente. |
| 4 | `generar_formulario` **revalida el mapeo contra el maestro** | Leer el mapeo guardado e ignorar el argumento | Respeta el contrato `{ caso, mapeo }` del PRD y convierte CA2 en una garantía, no en una instrucción. |
| 5 | **Fecha de referencia como parámetro** (`FECHA_REFERENCIA`, argumento `hoy`), por defecto 2026-09-03 | `new Date()` | Con la fecha real (2026-10-01) la Cámara de Comercio está vencida y ningún caso llega a "listo para firma". El parámetro hace la demo determinista y permite simular cualquier fecha. |
| 6 | **Node 20+ con tsx** | Bun | Bun no estaba instalado en la máquina y el PRD acepta Node 20+. |
| 7 | **Sesiones en memoria con copia en `out/sesiones/`** y servidor de proceso persistente (Render o Railway) | Funciones serverless (Vercel) | El ciclo dura 20–40 s y mantiene estado. En serverless se pierde la memoria entre invocaciones y solo se puede escribir en `/tmp`. |

## 7. Supuestos

- **Fecha de ejecución:** 2026-09-03, la fecha del PRD, configurable. Con la fecha real, la Cámara (vigente hasta el 2026-09-30) se marcaría vencida.
- **"País", "Correo electrónico", "Ingresos anuales":** se llenan con los datos de **Periferia** (CO, correo comercial según el glosario, ingresos en COP), porque el formulario describe al proveedor.
- **ID tributario:** en Colombia, "NIT" se llena sin confirmación. Las etiquetas genéricas ("Identificación tributaria") piden confirmación en cualquier país.
- **Soportes vencidos:** no se copian al paquete. Se listan en el checklist como bloqueo.
- **Portal:** su "formulario" es `valores-portal.md`. Puede quedar "listo para firma" si sus soportes están vigentes.
- **Envío con bloqueos:** si el paquete no está listo y el usuario pide enviar, el agente recuerda los bloqueos y pide una segunda confirmación. `ENVIO-SIMULADO.md` registra las advertencias.
- **Plantilla corrupta:** `leer_solicitud` devuelve la advertencia y los soportes, para que se pueda seguir con el paquete. `generar_formulario` informa que no puede continuar.

## 8. Cobertura

| HU | Estado | Comentario / falta para producción |
|---|---|---|
| HU-1 Leer la solicitud | ✅ Hecho | Devuelve campos ambiguos con equivalente del país. En producción: parsear el correo real y el .xlsx o .pdf adjunto. |
| HU-2 Mapear campos | ✅ Hecho | Tres estados con ruta del dato y confianza. Falta un glosario mantenido por negocio y una revisión de nuevos sinónimos. |
| HU-3 Formulario | ✅ xlsx (P0) · ✅ pdf generado (P1) · ✅ portal: valores para copiar (P2) | Falta escribir sobre la plantilla original del cliente (conservar formato) y rellenar AcroForms reales. |
| HU-4 Paquete para firma | ✅ Hecho | Checklist, borrador sin datos bancarios, bloqueos y `ENVIO-SIMULADO.md` solo con confirmación. Falta integrar firma electrónica y correo real. |
| HU-5 Manejo de errores | ✅ Hecho | Las herramientas nunca lanzan, los errores del LLM se traducen y se validan los argumentos (incluido *path traversal* en `caso`). |
| Bonus `modulo/` | ✅ Hecho | Se genera con `npm run modulo` desde `agent/prompt.md` y `src/knowledge/`, y las herramientas se re-exportan: no hay copias divergentes. |

## 9. Uso de IA

- **Asistente:** Claude Code (modelo Claude Opus 5.5) en VS Code.
- **Para qué lo usé:**
  - Leer y resumir los PRD y los fixtures.
  - Detectar casos límite (la Cámara de Comercio que vence el 2026-09-30, el soporte ausente de EC, los parafiscales vencidos).
  - Proponer la arquitectura y generar el código, los textos y las pruebas.
  - Ejecutar `demo.ts` y el chat real.
  - Construir los retos 02 y 03 en paralelo con subagentes, reutilizando este núcleo.
- **Qué descarté de lo propuesto:**
  - **Desplegar en Vercel:** el estado y la duración del turno encajan mal con serverless.
  - **Usar el LLM para mapear campos:** se pierde el determinismo y la trazabilidad.
  - **Confiar solo en el prompt para la confirmación:** se reemplazó por la verificación en el servidor.
  - **Tomar la fecha del sistema:** hacía desaparecer el caso feliz.
- **Revisión:** revisé y puedo explicar cada archivo. La lógica de negocio está en funciones puras (`mapeo.ts`) para que sea fácil de leer.

## 10. Riesgos para producción

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" datos | Los valores salen solo de herramientas. `generar_formulario` revalida contra el maestro y el prompt prohíbe valores sin fuente. |
| Maestro desactualizado (cuenta o representante legal cambiados) | Asignar un dueño del dato y versionar el maestro. Mostrar en el checklist la fecha de última actualización. |
| Plantillas reales peores que los fixtures (celdas combinadas, PDF escaneados) | Leer la plantilla original, escribir sobre ella y usar OCR. Lo que no se mapee con confianza va a revisión humana. |
| Fuga de datos sensibles | El borrador se verifica contra el número de cuenta y el SWIFT antes de escribirse, el chat no los muestra y los logs guardan solo resúmenes. En producción: autenticación, cifrado de `out/` y retención limitada. |
| Costo o abuso de la clave | Tope de iteraciones y de tokens por sesión, y tamaño máximo de mensaje. En producción, añadir autenticación y *rate limit* por usuario. |
| Confirmación ambigua ("ok pero no envíes") | La negación siempre gana y el modelo además debe pasar `confirmado`. Se podría exigir un botón explícito en lugar de texto libre. |
| Dependencia de un proveedor de LLM | El adaptador permite cambiar de proveedor y el fallback del servidor cubre los rechazos. Las herramientas funcionan sin modelo (`demo.ts`). |
