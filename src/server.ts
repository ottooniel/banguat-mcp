import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createBanguatClient,
  fechaInicialError,
  type BanguatClient,
  type Cotizacion,
  type CotizacionMoneda,
} from "./banguat.js";
import { formatoQuetzales, redondear, redondearDatos } from "./formato.js";
import { nombrePlural, nombreSingular } from "./nombres.js";
import { acotarLineas, prepararSerie, type SerieLista } from "./serie.js";

function fechaSchema(descripcion: string) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const message = fechaInicialError(value);
      if (message) ctx.addIssue({ code: "custom", message });
    })
    .describe(descripcion);
}

const fechaInicial = fechaSchema("Fecha inicial inclusive, en formato YYYY-MM-DD. No puede ser futura (hora de Guatemala).");
const fechaFinal = fechaSchema(
  "Fecha final inclusive, YYYY-MM-DD, igual o posterior a fecha_inicial. Si se omite en la serie del dólar, llega hasta el día corriente.",
).optional();
const agrupacion = z
  .enum(["auto", "diaria", "semanal", "mensual"])
  .optional()
  .describe("auto usa diaria hasta 62 puntos, semanal hasta cerca de un año y mensual en tramos más largos.");

const monto = z
  .number({ error: "El monto debe ser un número mayor que cero." })
  .positive("El monto debe ser mayor que cero.")
  .describe("Cantidad a convertir, mayor que cero.");
const direccion = z
  .enum(["a_quetzales", "desde_quetzales"])
  .describe("a_quetzales pasa de esa moneda a quetzales. desde_quetzales pasa de quetzales a esa moneda.");

const codigoMoneda = z.coerce
  .number()
  .int("El código de moneda debe ser un entero. Obténlo con monedas_disponibles.")
  .positive("El código de moneda debe ser un entero positivo. Obténlo con monedas_disponibles.")
  .describe("Código numérico de la moneda, el campo moneda de monedas_disponibles. Ejemplo: 2 dólar, 24 euro.");

const resumenSchema = z.object({
  inicio: z.string(),
  fin: z.string(),
  valor_inicial: z.number(),
  valor_final: z.number(),
  variacion_pct: z.number(),
  minimo: z.object({ fecha: z.string(), valor: z.number() }),
  maximo: z.object({ fecha: z.string(), valor: z.number() }),
  registros_originales: z.number(),
});

const puntoAgregado = z.object({
  fecha: z.string(),
  cierre: z.number(),
  min: z.number(),
  max: z.number(),
  publicado_anticipado: z.boolean().describe("true si el Banguat ya publicó una fecha posterior a hoy"),
});

const monedaSchema = {
  fecha: z.string().describe("Fecha de la cotización, YYYY-MM-DD"),
  codigo: z.number().describe("Código de monedas_disponibles"),
  nombre: z.string().describe("Nombre de la moneda en el catálogo del Banguat"),
  nombre_singular: z.string().describe("Nombre en singular para el texto"),
  quetzales_por_unidad: z.number().describe("Quetzales por 1 unidad de esa moneda"),
  cotizacion_usd: z.number().describe("Cifra publicada por el Banguat, cotizada contra el dólar"),
  convencion: z.enum(["usd_por_unidad", "unidades_por_usd"]),
  compra: z.number(),
  venta: z.number(),
  descontinuada: z.boolean(),
  referencia: z.enum(["misma_fecha", "fecha_anterior"]),
  fecha_referencia: z.string().describe("Fecha de la referencia USD usada para convertir a quetzales"),
};

const cotizacionSchema = {
  fecha: z.string().describe("Fecha de la cotización, YYYY-MM-DD"),
  valor: z.number().describe("Tipo de cambio publicado. En el dólar es la referencia; en otras monedas es la venta."),
  moneda: z.string().describe("USD para el dólar de referencia, o el código numérico de la moneda"),
  compra: z.number().optional().describe("Tipo de compra, cuando el servicio lo envía"),
  venta: z.number().optional().describe("Tipo de venta, cuando el servicio lo envía"),
};

export function versionServidor(): string {
  const ruta = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const paquete = JSON.parse(readFileSync(ruta, "utf8")) as { version: string };
  return paquete.version;
}

function anotaciones(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

export function createServer(client: BanguatClient = createBanguatClient()): McpServer {
  const server = new McpServer(
    { name: "banguat", version: versionServidor() },
    {
      instructions:
        "Los datos vienen del web service del Banguat y no constituyen información oficial; la fuente oficial es banguat.gob.gt. No digas que el dato es oficial. Indica siempre la fecha del dato. Para cualquier monto usa convertir_monto en vez de calcular a mano.",
    },
  );

  server.registerTool(
    "tipo_cambio_hoy",
    {
      title: "Tipo de cambio de hoy",
      annotations: anotaciones("Tipo de cambio de hoy"),
      inputSchema: {},
      description:
        "Devuelve el tipo de cambio de referencia del dólar de Estados Unidos frente al quetzal (USD/GTQ) publicado hoy por el Banco de Guatemala. Úsala para el dólar del día, cuántos quetzales vale un dólar ahora, o el tipo de cambio de referencia. No recibe parámetros. Para otra moneda usa tipo_cambio_moneda; para una serie histórica usa tipo_cambio_desde.",
      outputSchema: cotizacionSchema,
    },
    async () =>
      run(async () => {
        const cotizacion = await client.tipoCambioHoy();
        const data = datosCotizacion(cotizacion);
        return ok(
          `Tipo de cambio de referencia USD/GTQ del ${mostrarFecha(cotizacion.fecha)}: ${redondear(cotizacion.valor)} quetzales por 1 dólar.`,
          data,
        );
      }),
  );

  server.registerTool(
    "tipo_cambio_desde",
    {
      title: "Serie del dólar desde una fecha",
      annotations: anotaciones("Serie del dólar desde una fecha"),
      description:
        "Devuelve la serie del dólar (USD/GTQ), agregada, desde fecha_inicial. Sin fecha_final usa TipoCambioFechaInicial (hasta el día corriente). Con fecha_final usa TipoCambioRango. Sirve para historial y tendencia del dólar, no para otras monedas. La respuesta trae resumen y solo los puntos ya agrupados.",
      inputSchema: { fecha_inicial: fechaInicial, fecha_final: fechaFinal, agrupacion },
      outputSchema: {
        agrupacion: z.enum(["diaria", "semanal", "mensual"]),
        resumen: resumenSchema,
        serie: z.array(puntoAgregado),
      },
    },
    async ({ fecha_inicial, fecha_final, agrupacion: modo }) =>
      run(async () => {
        const puntos = await client.tipoCambioDesde(fecha_inicial, fecha_final);
        const lista = prepararSerie(puntos, modo ?? "auto");
        return ok(textoSerie("Serie USD/GTQ", lista), {
          agrupacion: lista.agrupacion,
          resumen: lista.resumen,
          serie: lista.serie,
        });
      }),
  );

  server.registerTool(
    "tipo_cambio_moneda_rango",
    {
      title: "Serie de una moneda en quetzales",
      annotations: anotaciones("Serie de una moneda en quetzales"),
      description:
        "Devuelve la serie de una moneda entre fecha_inicial y fecha_final, convertida a quetzales con la misma regla que tipo_cambio_moneda (TipoCambioRangoMoneda más la referencia USD de cada fecha). El código sale de monedas_disponibles. El código 1 no aplica. Incluye resumen y puntos agrupados, no la serie diaria completa cuando la agrupación la reduce.",
      inputSchema: { codigo: codigoMoneda, fecha_inicial: fechaInicial, fecha_final: fechaSchema("Fecha final inclusive, YYYY-MM-DD, igual o posterior a fecha_inicial."), agrupacion },
      outputSchema: {
        codigo: z.number(),
        nombre: z.string(),
        nombre_singular: z.string(),
        convencion: z.enum(["usd_por_unidad", "unidades_por_usd"]),
        agrupacion: z.enum(["diaria", "semanal", "mensual"]),
        resumen: resumenSchema,
        serie: z.array(
          puntoAgregado.extend({
            referencia: z.enum(["misma_fecha", "fecha_anterior"]),
            fecha_referencia: z.string(),
          }),
        ),
      },
    },
    async ({ codigo, fecha_inicial, fecha_final, agrupacion: modo }) =>
      run(async () => {
        const puntos = await client.tipoCambioMonedaRango(codigo, fecha_inicial, fecha_final);
        const lista = prepararSerie(
          puntos.map((punto) => ({
            fecha: punto.fecha,
            valor: punto.valor,
            publicado_anticipado: punto.publicado_anticipado,
            referencia: punto.referencia,
            fecha_referencia: punto.fecha_referencia,
          })),
          modo ?? "auto",
        );
        const primero = puntos[0];
        const aviso = puntos.some((punto) => punto.referencia === "fecha_anterior")
          ? "Algunas fechas usan la referencia USD del día hábil anterior, no la de hoy."
          : undefined;
        const nombre = primero?.nombre ?? String(codigo);
        return ok(textoSerie(`Serie de ${nombreSingular(codigo, nombre)} en quetzales`, lista, aviso), {
          codigo,
          nombre,
          nombre_singular: nombreSingular(codigo, nombre),
          convencion: primero?.convencion ?? "unidades_por_usd",
          agrupacion: lista.agrupacion,
          resumen: lista.resumen,
          serie: lista.serie,
        });
      }),
  );

  server.registerTool(
    "monedas_disponibles",
    {
      title: "Monedas disponibles",
      annotations: anotaciones("Monedas disponibles"),
      inputSchema: {},
      description:
        "Lista las monedas y variables que el web service del Banco de Guatemala permite consultar, con su código numérico (moneda) y su descripción. Úsala antes de tipo_cambio_moneda para elegir el código correcto. No recibe parámetros y no consulta el tipo de cambio de cada moneda. Algunas siguen en el catálogo aunque ya no se publican: tipo_cambio_moneda marca descontinuada=true cuando el último dato tiene más de 30 días.",
      outputSchema: {
        monedas: z.array(
          z.object({
            codigo: z.number(),
            descripcion: z.string(),
          }),
        ),
      },
    },
    async () =>
      run(async () => {
        const monedas = await client.monedasDisponibles();
        const lineas = monedas.map((moneda) => `${moneda.codigo}\t${moneda.descripcion}`);
        return ok(`Monedas consultables (${monedas.length}). El código se usa en tipo_cambio_moneda.\n${lineas.join("\n")}`, {
          monedas,
        });
      }),
  );

  server.registerTool(
    "tipo_cambio_moneda",
    {
      title: "Tipo de cambio de una moneda",
      annotations: anotaciones("Tipo de cambio de una moneda"),
      description:
        "Convierte a quetzales el tipo de cambio de una moneda del catálogo del Banguat (operación Variables, cotizada contra el dólar). Códigos 9, 24 y 26 (libra, euro, DEG) vienen en USD por 1 unidad; el resto, en unidades por 1 USD. El código 2 usa la referencia del dólar del día. El código 1 (quetzal) no aplica. Para el dólar de hoy también puedes usar tipo_cambio_hoy.",
      inputSchema: { codigo: codigoMoneda },
      outputSchema: monedaSchema,
    },
    async ({ codigo }) =>
      run(async () => {
        const cotizacion = await client.tipoCambioMoneda(codigo);
        return ok(textoMoneda(cotizacion), datosMoneda(cotizacion));
      }),
  );

  server.registerTool(
    "convertir_monto",
    {
      title: "Convertir un monto",
      annotations: anotaciones("Convertir un monto"),
      description:
        "Convierte un monto entre una moneda del catálogo y quetzales con el tipo de cambio vigente de tipo_cambio_moneda. direccion a_quetzales pasa de esa moneda a quetzales; desde_quetzales hace el camino inverso. El código 2 es el dólar de referencia. Si la moneda está descontinuada, no convierte.",
      inputSchema: { monto, codigo: codigoMoneda, direccion },
      outputSchema: {
        monto: z.number(),
        codigo: z.number(),
        nombre: z.string(),
        resultado: z.number(),
        quetzales_por_unidad: z.number(),
        fecha: z.string(),
        descontinuada: z.boolean(),
      },
    },
    async ({ monto: cantidad, codigo, direccion: sentido }) =>
      run(async () => {
        const cotizacion = await client.tipoCambioMoneda(codigo);
        if (cotizacion.descontinuada) {
          throw new Error(
            `${cotizacion.nombre} está descontinuada: el último dato es del ${mostrarFecha(cotizacion.fecha)}. No se convierte con un tipo de cambio viejo.`,
          );
        }
        const bruto = montoConvertido(cantidad, cotizacion.quetzales_por_unidad, sentido);
        const resultado = Math.round(bruto * 100) / 100;
        return ok(textoConversion(cantidad, resultado, cotizacion, sentido), datosConversion(cantidad, codigo, resultado, cotizacion), false);
      }),
  );

  return server;
}

function montoConvertido(cantidad: number, quetzalesPorUnidad: number, sentido: "a_quetzales" | "desde_quetzales"): number {
  switch (sentido) {
    case "a_quetzales":
      return cantidad * quetzalesPorUnidad;
    case "desde_quetzales":
      return cantidad / quetzalesPorUnidad;
    default: {
      const nunca: never = sentido;
      return nunca;
    }
  }
}

function datosCotizacion(cotizacion: Cotizacion): {
  fecha: string;
  valor: number;
  moneda: string;
  compra?: number;
  venta?: number;
} {
  return {
    fecha: cotizacion.fecha,
    valor: cotizacion.valor,
    moneda: cotizacion.moneda,
    ...(cotizacion.compra === undefined || cotizacion.venta === undefined
      ? {}
      : { compra: cotizacion.compra, venta: cotizacion.venta }),
  };
}

function textoSerie(titulo: string, lista: SerieLista, aviso?: string): string {
  const { resumen, serie, agrupacion: modo } = redondearDatos(lista);
  const lineas = [
    `${titulo} del ${mostrarFecha(resumen.inicio)} al ${mostrarFecha(resumen.fin)}. Agrupación ${modo}. ${resumen.registros_originales} registros. Variación ${resumen.variacion_pct.toFixed(2)}%.`,
    `Mínimo ${resumen.minimo.valor} el ${mostrarFecha(resumen.minimo.fecha)}. Máximo ${resumen.maximo.valor} el ${mostrarFecha(resumen.maximo.fecha)}.`,
  ];
  if (aviso) lineas.push(aviso);
  if (serie.some((punto) => punto.publicado_anticipado)) {
    lineas.push("Incluye tipo de cambio publicado por adelantado (fecha posterior a hoy, hora de Guatemala).");
  }
  for (const punto of serie) {
    const marca = punto.publicado_anticipado ? "  publicado por adelantado" : "";
    lineas.push(`${punto.fecha}  cierre ${punto.cierre}  min ${punto.min}  max ${punto.max}${marca}`);
  }
  return acotarLineas(lineas);
}

function datosMoneda(cotizacion: CotizacionMoneda): Record<string, unknown> {
  return {
    fecha: cotizacion.fecha,
    codigo: cotizacion.codigo,
    nombre: cotizacion.nombre,
    nombre_singular: nombreSingular(cotizacion.codigo, cotizacion.nombre),
    quetzales_por_unidad: cotizacion.quetzales_por_unidad,
    cotizacion_usd: cotizacion.cotizacion_usd,
    convencion: cotizacion.convencion,
    compra: cotizacion.compra,
    venta: cotizacion.venta,
    descontinuada: cotizacion.descontinuada,
    referencia: cotizacion.referencia,
    fecha_referencia: cotizacion.fecha_referencia,
  };
}

function textoMoneda(cotizacion: CotizacionMoneda): string {
  const frase = fraseCotizacion(cotizacion);
  const singular = nombreSingular(cotizacion.codigo, cotizacion.nombre);
  let base = `${etiquetaQuetzales(cotizacion.quetzales_por_unidad, cotizacion.codigo, cotizacion.nombre, singular)} al ${mostrarFecha(cotizacion.fecha)} (${frase}).`;
  if (cotizacion.referencia === "fecha_anterior") {
    base += ` Referencia USD del ${mostrarFecha(cotizacion.fecha_referencia)}.`;
  }
  if (cotizacion.descontinuada) {
    base += ` Último dato: ${mostrarFecha(cotizacion.fecha)}, moneda reemplazada.`;
  }
  return base;
}

function etiquetaQuetzales(q: number, codigo: number, nombre: string, singular: string): string {
  const texto = formatoQuetzales(q, codigo, nombre);
  if (redondear(q) < 0.1) return texto;
  return `1 ${singular} = ${texto}`;
}

function fraseCotizacion(cotizacion: CotizacionMoneda): string {
  if (cotizacion.codigo === 2) return "tipo de cambio de referencia";
  const cotizacionUsd = redondear(cotizacion.cotizacion_usd);
  const singular = nombreSingular(cotizacion.codigo, cotizacion.nombre);
  const plural = nombrePlural(cotizacion.codigo, cotizacion.nombre);
  const cantidad = formatoMonto(cotizacionUsd);
  switch (cotizacion.convencion) {
    case "usd_por_unidad":
      return `${cantidad} USD por ${singular}`;
    case "unidades_por_usd":
      return `${cantidad} ${cotizacionUsd === 1 ? singular : plural} por 1 USD`;
    default: {
      const nunca: never = cotizacion.convencion;
      return nunca;
    }
  }
}

function datosConversion(
  cantidad: number,
  codigo: number,
  resultado: number,
  cotizacion: CotizacionMoneda,
): Record<string, unknown> {
  const resto = redondearDatos({
    codigo,
    nombre: cotizacion.nombre,
    quetzales_por_unidad: cotizacion.quetzales_por_unidad,
    fecha: cotizacion.fecha,
    descontinuada: cotizacion.descontinuada,
  });
  return {
    monto: cantidad,
    codigo: resto.codigo,
    nombre: resto.nombre,
    resultado,
    quetzales_por_unidad: resto.quetzales_por_unidad,
    fecha: resto.fecha,
    descontinuada: resto.descontinuada,
  };
}

function textoConversion(
  cantidad: number,
  resultado: number,
  cotizacion: CotizacionMoneda,
  sentido: "a_quetzales" | "desde_quetzales",
): string {
  const fecha = `tipo de cambio del ${mostrarFecha(cotizacion.fecha)}`;
  const singular = nombreSingular(cotizacion.codigo, cotizacion.nombre);
  const plural = nombrePlural(cotizacion.codigo, cotizacion.nombre);
  switch (sentido) {
    case "a_quetzales":
      return `${formatoMonto(cantidad)} ${cantidad === 1 ? singular : plural} = Q${formatoCentavos(resultado)} (${fecha})`;
    case "desde_quetzales":
      return `Q${formatoMonto(cantidad)} = ${formatoCentavos(resultado)} ${resultado === 1 ? singular : plural} (${fecha})`;
    default: {
      const nunca: never = sentido;
      return nunca;
    }
  }
}

function formatoMonto(n: number): string {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 20 }).format(n);
}

function formatoCentavos(n: number): string {
  return new Intl.NumberFormat("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function mostrarFecha(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

const AVISO_FUENTE = "Fuente: web service del Banguat (no oficial).";

function conFuente(text: string): string {
  return `${text}\n${AVISO_FUENTE}`;
}

function ok(text: string, data: Record<string, unknown>, aplicarRedondeo = true): CallToolResult {
  return {
    content: [{ type: "text", text: conFuente(text) }],
    structuredContent: aplicarRedondeo ? redondearDatos(data) : data,
  };
}

async function run(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al consultar el Banguat.";
    return { isError: true, content: [{ type: "text", text: conFuente(message) }] };
  }
}
