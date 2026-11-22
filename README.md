# banguat-mcp

[![CI](https://github.com/ottooniel/banguat-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ottooniel/banguat-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/banguat-mcp)](https://www.npmjs.com/package/banguat-mcp)

Servidor [MCP](https://modelcontextprotocol.io) que consulta el tipo de cambio publicado por el web service SOAP del Banco de Guatemala y lo expresa en quetzales.

## Herramientas

| Herramienta | Operación SOAP | Qué responde |
| --- | --- | --- |
| `tipo_cambio_hoy` | `TipoCambioDia` | Referencia USD/GTQ del día |
| `tipo_cambio_desde` | `TipoCambioFechaInicial` o `TipoCambioRango` si hay `fecha_final` | Serie del dólar, con resumen y puntos agrupados |
| `monedas_disponibles` | `VariablesDisponibles` | Código y nombre de cada moneda. No consulta el tipo de cambio |
| `tipo_cambio_moneda` | `Variables` y `TipoCambioRango` de esa fecha | Quetzales por 1 unidad de esa moneda |
| `tipo_cambio_moneda_rango` | `TipoCambioRangoMoneda` | Serie de esa moneda, ya convertida a quetzales |
| `convertir_monto` | la cotización de `tipo_cambio_moneda` | Un monto pasado a quetzales o desde quetzales |

Las instrucciones para un agente están en [`skills/banguat-tipo-de-cambio/SKILL.md`](skills/banguat-tipo-de-cambio/SKILL.md).

`tipo_cambio_desde` y `tipo_cambio_moneda_rango` aceptan `agrupacion`: `auto` (diaria hasta 62 puntos, semanal hasta cerca de un año, mensual si el tramo es más largo), `diaria`, `semanal` o `mensual`. Cada punto agregado trae cierre, mínimo y máximo. El resumen incluye inicio, fin, variación, mínimo, máximo y cuántos registros diarios había.

## Unidades

El servicio `Variables` no cotiza contra el quetzal: cotiza contra el dólar, con dos convenciones.

| Códigos | Convención | Quetzales por 1 unidad |
| --- | --- | --- |
| 9 libra, 24 euro, 26 DEG | `usd_por_unidad` (USD por 1 unidad) | cotización × referencia USD |
| El resto | `unidades_por_usd` (unidades por 1 USD) | referencia USD ÷ cotización |

La referencia USD es la del mismo día, leída con `TipoCambioRango(fecha, fecha)`. Si ese día no trae dato, se busca la fecha anterior más cercana en los 7 días previos. Si no hay ninguna, la herramienta devuelve un error. No se usa el tipo de cambio de hoy para una fecha histórica. `referencia` es `misma_fecha` o `fecha_anterior`, y `fecha_referencia` es el día de esa referencia.

- El código 1 es el quetzal. La herramienta responde que no tiene cotización contra sí mismo.
- El código 2 usa la referencia del día, la misma cifra que `tipo_cambio_hoy`.
- Si la fecha de la cotización tiene más de 30 días, `descontinuada` es `true`. `monedas_disponibles` solo documenta ese campo: no llama al servicio una vez por moneda.
- En las series, una fecha posterior a hoy (hora de Guatemala) llega con `publicado_anticipado: true`. El Banguat publica por adelantado el siguiente día hábil. `tipo_cambio_hoy` no cambia.

Ejemplo real del 20/11/2026, con referencia USD 7.64781: el euro venía a 1.0988 USD por euro, así que 1 euro = Q8.4034. El peso mexicano venía a 19.0201 pesos por dólar, así que 1 peso mexicano = Q0.4021.

## Precisión y redondeo

Todo número que sale en el texto o en los datos estructurados se redondea a 6 cifras significativas, salvo el monto y el resultado de `convertir_monto`. El monto se devuelve tal como lo mandó el usuario. El resultado se calcula con la tasa sin redondear y se redondea a 2 decimales (`Math.round(x * 100) / 100`). `quetzales_por_unidad` sigue con 6 cifras significativas. En el texto de una cotización, si el quetzal por unidad es 0.1 o más se muestra con 4 decimales (`Q8.4034`). Si es menor, se expresa por 100 unidades (`100 pesos colombianos = Q0.2236`) para no mostrar `Q0.00`. `convertir_monto` formatea el resultado con `Intl.NumberFormat("es-GT")`, por ejemplo `250 euros = Q2,100.85`.

## Ejemplos de respuesta

`tipo_cambio_hoy`:

```json
{ "fecha": "2026-11-22", "valor": 7.64781, "moneda": "USD" }
```

`tipo_cambio_moneda` con código 24:

```text
1 euro = Q8.4034 al 20/11/2026 (1.0988 USD por euro).
```

```json
{
  "fecha": "2026-11-20",
  "codigo": 24,
  "nombre": "Euro",
  "nombre_singular": "euro",
  "quetzales_por_unidad": 8.40341,
  "cotizacion_usd": 1.0988,
  "convencion": "usd_por_unidad",
  "compra": 1.0988,
  "venta": 1.0988,
  "descontinuada": false,
  "referencia": "misma_fecha",
  "fecha_referencia": "2026-11-20"
}
```

`tipo_cambio_moneda` con código 18:

```text
1 peso mexicano = Q0.4021 al 20/11/2026 (19.0201 pesos mexicanos por 1 USD).
```

```json
{
  "fecha": "2026-11-20",
  "codigo": 18,
  "nombre": "Pesos Mexicanos",
  "nombre_singular": "peso mexicano",
  "quetzales_por_unidad": 0.402091,
  "cotizacion_usd": 19.0201,
  "convencion": "unidades_por_usd",
  "compra": 19.0155,
  "venta": 19.0201,
  "descontinuada": false,
  "referencia": "misma_fecha",
  "fecha_referencia": "2026-11-20"
}
```

`convertir_monto` de 250 euros a quetzales:

```text
250 euros = Q2,100.85 (tipo de cambio del 20/11/2026)
```

`monedas_disponibles` (recorte):

```json
{
  "monedas": [
    { "codigo": 2, "descripcion": "Dólares de EE.UU." },
    { "codigo": 24, "descripcion": "Euro" }
  ]
}
```

`tipo_cambio_desde` desde el 18/11/2026. El 23/11/2026 ya venía publicado:

```json
{
  "agrupacion": "diaria",
  "resumen": {
    "inicio": "2026-11-18",
    "fin": "2026-11-23",
    "valor_inicial": 7.64489,
    "valor_final": 7.64059,
    "variacion_pct": -0.0562467,
    "minimo": { "fecha": "2026-11-23", "valor": 7.64059 },
    "maximo": { "fecha": "2026-11-20", "valor": 7.64781 },
    "registros_originales": 6
  },
  "serie": [
    { "fecha": "2026-11-22", "cierre": 7.64781, "min": 7.64781, "max": 7.64781, "publicado_anticipado": false },
    { "fecha": "2026-11-23", "cierre": 7.64059, "min": 7.64059, "max": 7.64059, "publicado_anticipado": true }
  ]
}
```

`tipo_cambio_moneda_rango` devuelve la misma forma de resumen y serie, más `codigo`, `nombre`, `nombre_singular` y `convencion`. Cada punto trae `referencia` y `fecha_referencia`. Los valores de la serie ya están en quetzales por unidad.

## Requisitos

- Node.js 20 o superior

## Instalación

```bash
npx -y banguat-mcp
```

Para desarrollar en este repositorio:

```bash
npm install
npm test
npm run build
node scripts/grabar-fixtures.mjs
```

El ejecutable queda en `dist/index.js`. El script vuelve a guardar en `test/fixtures/` las respuestas reales del servicio.

## Claude Desktop

Edita `%APPDATA%\Claude\claude_desktop_config.json` en Windows o `~/Library/Application Support/Claude/claude_desktop_config.json` en macOS:

```json
{
  "mcpServers": {
    "banguat": {
      "command": "npx",
      "args": ["-y", "banguat-mcp"]
    }
  }
}
```

Reinicia Claude Desktop después de guardar.

## Cursor

En `.cursor/mcp.json` o en el `mcp.json` del usuario:

```json
{
  "mcpServers": {
    "banguat": {
      "command": "npx",
      "args": ["-y", "banguat-mcp"]
    }
  }
}
```

Para esta copia local, antes de publicarla:

```json
{
  "mcpServers": {
    "banguat": {
      "command": "node",
      "args": ["C:/ruta/al/repo/banguat-mcp/dist/index.js"]
    }
  }
}
```

## Preguntas de ejemplo

- ¿Cuál es el tipo de cambio del dólar hoy?
- ¿Cómo ha estado el dólar desde el 1 de noviembre de 2026?
- ¿Cuántos quetzales vale un euro?
- ¿Cuántos quetzales son 250 euros?
- ¿Qué monedas del catálogo ya no se publican?

## Cómo se comporta

- La fecha de entrada es `YYYY-MM-DD`. El servidor la convierte a `dd/mm/aaaa` y rechaza fechas imposibles o futuras según el calendario de Guatemala.
- El tipo de cambio del día se guarda en memoria 1 hora. Una serie, 24 horas. La clave incluye la fecha de Guatemala. Hay como máximo 200 entradas y las llamadas iguales en vuelo se hacen una sola vez.
- Cada llamada espera como máximo 10 segundos. Si el Banguat no responde, la herramienta pide reintentar más tarde.
- El texto de una serie no pasa de unas 70 líneas. Los datos estructurados traen el resumen y los puntos ya agrupados.

## Disclaimer

Los datos salen del web service del Banco de Guatemala (`https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx`). Esta herramienta no constituye información oficial. La fuente oficial es [banguat.gob.gt](https://banguat.gob.gt).
