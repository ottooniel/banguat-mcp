# banguat-mcp

Servidor [MCP](https://modelcontextprotocol.io) que consulta el tipo de cambio publicado por el web service SOAP del Banco de Guatemala.

Expone cuatro herramientas para un modelo de lenguaje:

| Herramienta | Qué responde |
| --- | --- |
| `tipo_cambio_hoy` | Tipo de cambio de referencia USD/GTQ del día |
| `tipo_cambio_desde` | Serie del dólar desde una fecha (`YYYY-MM-DD`) hasta hoy |
| `monedas_disponibles` | Códigos y nombres de las monedas consultables |
| `tipo_cambio_moneda` | Tipo de cambio de una moneda, por el código de la lista anterior |

Las operaciones SOAP que usa son las del WSDL de `TipoCambio.asmx`: `TipoCambioDia`, `TipoCambioFechaInicial`, `VariablesDisponibles` y `Variables`.

## Requisitos

- Node.js 20 o superior

## Instalación

No hace falta clonar el repositorio. Un cliente MCP puede arrancarlo con npx:

```bash
npx -y banguat-mcp
```

Para desarrollar en este repositorio:

```bash
npm install
npm test
npm run build
```

El ejecutable queda en `dist/index.js`.

## Claude Desktop

Edita `%APPDATA%\Claude\claude_desktop_config.json` (en Windows) o `~/Library/Application Support/Claude/claude_desktop_config.json` (en macOS):

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

En el `mcp.json` del proyecto (`.cursor/mcp.json`) o en el del usuario:

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

Si estás probando esta copia local, antes de publicarla en npm, apunta al build:

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
- ¿Qué monedas puedo consultar en el Banguat?
- ¿Cuál es el tipo de cambio del euro? (el modelo debe tomar el código de `monedas_disponibles`, por ejemplo 24)

## Cómo se comporta

- La fecha de entrada es `YYYY-MM-DD`. El servidor la convierte a `dd/mm/aaaa`, que es el formato del servicio, y rechaza fechas imposibles o futuras según el calendario de Guatemala.
- El tipo de cambio del día se guarda en memoria 1 hora. Una serie histórica, 24 horas. Un error de red no se cachea.
- Cada llamada espera como máximo 10 segundos. Si el Banguat no responde, la herramienta devuelve un mensaje para reintentar más tarde.
- Cada respuesta trae un texto legible y datos estructurados (`fecha`, `valor`, `moneda`; en la serie también compra y venta).

## Disclaimer

Los datos salen del web service del Banco de Guatemala (`https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx`). Esta herramienta no constituye información oficial. La fuente oficial es [banguat.gob.gt](https://banguat.gob.gt).
