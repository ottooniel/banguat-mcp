import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createBanguatClient,
  fechaInicialError,
  type BanguatClient,
  type Cotizacion,
  type PuntoSerie,
} from "./banguat.js";

const fechaInicial = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const message = fechaInicialError(value);
    if (message) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  })
  .describe("Fecha inicial inclusive, en formato YYYY-MM-DD. No puede ser futura (hora de Guatemala).");

const codigoMoneda = z.coerce
  .number()
  .int("El código de moneda debe ser un entero. Obténlo con monedas_disponibles.")
  .positive("El código de moneda debe ser un entero positivo. Obténlo con monedas_disponibles.")
  .describe("Código numérico de la moneda, el campo moneda de monedas_disponibles. Ejemplo: 2 dólar, 24 euro.");

const cotizacionSchema = {
  fecha: z.string().describe("Fecha de la cotización, YYYY-MM-DD"),
  valor: z.number().describe("Tipo de cambio publicado. En el dólar es la referencia; en otras monedas es la venta."),
  moneda: z.string().describe("USD para el dólar de referencia, o el código numérico de la moneda"),
  compra: z.number().optional().describe("Tipo de compra, cuando el servicio lo envía"),
  venta: z.number().optional().describe("Tipo de venta, cuando el servicio lo envía"),
};

export function createServer(client: BanguatClient = createBanguatClient()): McpServer {
  const server = new McpServer(
    { name: "banguat", version: "1.0.0" },
    {
      instructions:
        "Consulta el tipo de cambio del web service SOAP del Banco de Guatemala. Los datos no son información oficial; la fuente oficial es https://banguat.gob.gt.",
    },
  );

  server.registerTool(
    "tipo_cambio_hoy",
    {
      title: "Tipo de cambio de hoy",
      description:
        "Devuelve el tipo de cambio de referencia del dólar de Estados Unidos frente al quetzal (USD/GTQ) publicado hoy por el Banco de Guatemala. Úsala para el dólar del día, cuántos quetzales vale un dólar ahora, o el tipo de cambio de referencia. No recibe parámetros. Para otra moneda usa tipo_cambio_moneda; para una serie histórica usa tipo_cambio_desde.",
      outputSchema: cotizacionSchema,
    },
    async () =>
      run(async () => {
        const cotizacion = await client.tipoCambioHoy();
        const data = datosCotizacion(cotizacion);
        return ok(
          `Tipo de cambio de referencia USD/GTQ del ${mostrarFecha(cotizacion.fecha)}: ${cotizacion.valor} quetzales por 1 dólar.`,
          data,
        );
      }),
  );

  server.registerTool(
    "tipo_cambio_desde",
    {
      title: "Serie del dólar desde una fecha",
      description:
        "Devuelve la serie del tipo de cambio del dólar (USD/GTQ) desde fecha_inicial hasta el día corriente, con la operación TipoCambioFechaInicial del Banguat. Úsala para historial, tendencia o evolución del dólar. fecha_inicial va en YYYY-MM-DD y no puede ser futura. No sirve para monedas distintas del dólar.",
      inputSchema: { fecha_inicial: fechaInicial },
      outputSchema: {
        moneda: z.string(),
        serie: z.array(
          z.object({
            fecha: z.string(),
            valor: z.number(),
            moneda: z.literal("USD"),
            compra: z.number(),
            venta: z.number(),
          }),
        ),
      },
    },
    async ({ fecha_inicial }) =>
      run(async () => {
        const serie = await client.tipoCambioDesde(fecha_inicial);
        const data = { moneda: "USD", serie };
        return ok(textoSerie(fecha_inicial, serie), data);
      }),
  );

  server.registerTool(
    "monedas_disponibles",
    {
      title: "Monedas disponibles",
      description:
        "Lista las monedas y variables que el web service del Banco de Guatemala permite consultar, con su código numérico (moneda) y su descripción. Úsala antes de tipo_cambio_moneda para elegir el código correcto. No recibe parámetros y no devuelve el tipo de cambio.",
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
      description:
        "Devuelve el tipo de cambio vigente de una moneda del catálogo del Banguat, identificada por el código numérico de monedas_disponibles (operación Variables). Para el dólar de referencia del día prefiere tipo_cambio_hoy. El valor es la referencia si el código es el dólar (2) y el tipo de venta en las demás monedas.",
      inputSchema: { codigo: codigoMoneda },
      outputSchema: cotizacionSchema,
    },
    async ({ codigo }) =>
      run(async () => {
        const cotizacion = await client.tipoCambioMoneda(codigo);
        return ok(textoMoneda(codigo, cotizacion), datosCotizacion(cotizacion));
      }),
  );

  return server;
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

function textoSerie(desde: string, serie: PuntoSerie[]): string {
  const ultimo = serie[serie.length - 1];
  const lineas = serie.map((punto) => `${punto.fecha}  ${punto.valor}`);
  return [
    `Serie USD/GTQ desde ${desde} hasta ${ultimo?.fecha ?? desde}. ${serie.length} registros. El valor es el tipo de venta.`,
    ...lineas,
  ].join("\n");
}

function textoMoneda(codigo: number, cotizacion: Cotizacion): string {
  const fecha = mostrarFecha(cotizacion.fecha);
  if (cotizacion.moneda === "USD") {
    return `Tipo de cambio de referencia USD/GTQ del ${fecha}: ${cotizacion.valor} quetzales por 1 dólar (código ${codigo}).`;
  }
  return `Tipo de cambio de la moneda ${cotizacion.moneda} al ${fecha}: venta ${cotizacion.venta}, compra ${cotizacion.compra}. El valor es el tipo de venta publicado por el Banguat para el código ${codigo}.`;
}

function mostrarFecha(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
  };
}

async function run(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al consultar el Banguat.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
