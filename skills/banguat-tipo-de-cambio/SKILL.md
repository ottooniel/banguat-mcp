---
name: banguat-tipo-de-cambio
description: Consulta el tipo de cambio del Banco de Guatemala con el MCP banguat-mcp. Úsala para el dólar de hoy, series, el catálogo de monedas, la cotización de una moneda en quetzales y convertir un monto.
---

# Tipo de cambio del Banguat

## Cuándo usar cada herramienta

- `tipo_cambio_hoy`: referencia USD/GTQ del día. Sirve para cuántos quetzales vale un dólar ahora. No cubre otras monedas ni un historial.
- `tipo_cambio_desde`: serie del dólar desde una fecha (y hasta otra, si se pide), con resumen y puntos agrupados. No la uses para otra moneda.
- `monedas_disponibles`: código y nombre de cada moneda. No consulta el tipo de cambio. El código que devuelve es el que piden las otras herramientas.
- `tipo_cambio_moneda`: quetzales por 1 unidad de una moneda del catálogo. El código 2 es el dólar de referencia. El código 1 es el quetzal y no cotiza contra sí mismo.
- `tipo_cambio_moneda_rango`: serie de una moneda entre dos fechas, ya convertida a quetzales.
- `convertir_monto`: cualquier monto entre esa moneda y quetzales, en cualquiera de los dos sentidos. Úsala en vez de calcular a mano con la tasa.

## Cómo responder

- Cita siempre la fecha del dato.
- La fuente oficial es [banguat.gob.gt](https://banguat.gob.gt).
- Si la moneda está descontinuada, avísalo. No conviertas con un tipo de cambio viejo.
- Si un punto trae fecha posterior a hoy (hora de Guatemala), explica que el Banguat publica el tipo de cambio por adelantado, el del siguiente día hábil. `tipo_cambio_hoy` no cambia por ese dato.
