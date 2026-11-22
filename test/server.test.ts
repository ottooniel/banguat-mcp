import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { BanguatClient, CotizacionMoneda } from "../src/banguat.js";
import { createServer, versionServidor } from "../src/server.js";

const XML_FECHA = "2026-11-22";

function cotizacionMoneda(codigo: number): CotizacionMoneda {
  if (codigo === 2) {
    return {
      fecha: XML_FECHA,
      codigo: 2,
      nombre: "Dólares de EE.UU.",
      quetzales_por_unidad: 7.64781,
      cotizacion_usd: 1,
      convencion: "usd_por_unidad",
      compra: 7.64781,
      venta: 7.64781,
      descontinuada: false,
      referencia: "misma_fecha",
      fecha_referencia: XML_FECHA,
    };
  }
  return {
    fecha: "2026-11-20",
    codigo,
    nombre: "Euro",
    quetzales_por_unidad: 1.0988 * 7.64781,
    cotizacion_usd: 1.0988,
    convencion: "usd_por_unidad",
    compra: 1.09,
    venta: 1.0988,
    descontinuada: false,
    referencia: "misma_fecha",
    fecha_referencia: "2026-11-20",
  };
}

function clientFalso(overrides: Partial<BanguatClient> = {}): BanguatClient {
  return {
    tipoCambioHoy: async () => ({ fecha: XML_FECHA, valor: 7.64781, moneda: "USD" }),
    tipoCambioDesde: async () => [
      { fecha: "2026-11-18", valor: 7.64489, moneda: "USD", compra: 7.64489, venta: 7.64489, publicado_anticipado: false },
      { fecha: "2026-11-23", valor: 7.64059, moneda: "USD", compra: 7.64059, venta: 7.64059, publicado_anticipado: true },
    ],
    tipoCambioMonedaRango: async () => [
      {
        fecha: "2026-11-18",
        valor: 8.4,
        codigo: 24,
        nombre: "Euro",
        convencion: "usd_por_unidad",
        compra: 1.09,
        venta: 1.1,
        referencia: "misma_fecha",
        fecha_referencia: "2026-11-18",
        publicado_anticipado: false,
      },
      {
        fecha: "2026-11-20",
        valor: 8.41,
        codigo: 24,
        nombre: "Euro",
        convencion: "usd_por_unidad",
        compra: 1.09,
        venta: 1.1,
        referencia: "misma_fecha",
        fecha_referencia: "2026-11-20",
        publicado_anticipado: false,
      },
    ],
    monedasDisponibles: async () => [
      { codigo: 2, descripcion: "Dólares de EE.UU." },
      { codigo: 24, descripcion: "Euro" },
    ],
    tipoCambioMoneda: async (codigo) => cotizacionMoneda(codigo),
    ...overrides,
  };
}

async function conectar(banguat: BanguatClient): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(banguat).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function asResult(value: unknown): CallToolResult {
  if (!value || typeof value !== "object" || !("content" in value)) {
    throw new Error("La llamada no devolvió un resultado de tool");
  }
  return value as CallToolResult;
}

describe("tools MCP", () => {
  it("toma la versión desde package.json", () => {
    const paquete = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(versionServidor()).toBe(paquete.version);
    expect(versionServidor()).not.toBe("");
  });

  it("anuncia las cuatro herramientas en español", async () => {
    const client = await conectar(clientFalso());
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "convertir_monto",
      "monedas_disponibles",
      "tipo_cambio_desde",
      "tipo_cambio_hoy",
      "tipo_cambio_moneda",
      "tipo_cambio_moneda_rango",
    ]);
    expect(listed.tools).toHaveLength(6);
    for (const tool of listed.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true,
      });
      expect(tool.annotations?.title).toBeTruthy();
    }
    const catalogo = listed.tools.find((tool) => tool.name === "monedas_disponibles");
    expect(catalogo?.description).toMatch(/descontinuada/);
  });

  it("devuelve texto y datos estructurados del dólar del día", async () => {
    const client = await conectar(clientFalso());
    const result = asResult(await client.callTool({ name: "tipo_cambio_hoy", arguments: {} }));
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(result.content)).toContain("7.64781");
    expect(result.structuredContent).toEqual({ fecha: XML_FECHA, valor: 7.64781, moneda: "USD" });
  });

  it("devuelve la serie y rechaza una fecha futura o mal formada", async () => {
    const client = await conectar(clientFalso());
    const ok = asResult(
      await client.callTool({ name: "tipo_cambio_desde", arguments: { fecha_inicial: "2026-11-18" } }),
    );
    expect(ok.structuredContent).toMatchObject({
      agrupacion: "diaria",
      resumen: { inicio: "2026-11-18", fin: "2026-11-23", registros_originales: 2 },
      serie: [
        { fecha: "2026-11-18", cierre: 7.64489, min: 7.64489, max: 7.64489, publicado_anticipado: false },
        { fecha: "2026-11-23", cierre: 7.64059, min: 7.64059, max: 7.64059, publicado_anticipado: true },
      ],
    });
    expect(JSON.stringify(ok.content)).toContain("publicado por adelantado");

    const futura = asResult(
      await client.callTool({ name: "tipo_cambio_desde", arguments: { fecha_inicial: "2099-01-01" } }),
    );
    expect(futura.isError).toBe(true);
    expect(JSON.stringify(futura.content)).toMatch(/Fecha futura/);

    const malFormada = asResult(
      await client.callTool({ name: "tipo_cambio_desde", arguments: { fecha_inicial: "22/11/2026" } }),
    );
    expect(malFormada.isError).toBe(true);
    expect(JSON.stringify(malFormada.content)).toMatch(/YYYY-MM-DD/);
  });

  it("lista monedas y consulta una por su código", async () => {
    const client = await conectar(clientFalso());
    const monedas = asResult(await client.callTool({ name: "monedas_disponibles", arguments: {} }));
    expect(monedas.structuredContent).toEqual({
      monedas: [
        { codigo: 2, descripcion: "Dólares de EE.UU." },
        { codigo: 24, descripcion: "Euro" },
      ],
    });

    const euro = asResult(await client.callTool({ name: "tipo_cambio_moneda", arguments: { codigo: 24 } }));
    expect(euro.structuredContent).toMatchObject({
      fecha: "2026-11-20",
      codigo: 24,
      nombre: "Euro",
      nombre_singular: "euro",
      convencion: "usd_por_unidad",
      cotizacion_usd: 1.0988,
    });
    expect(JSON.stringify(euro.content)).toContain("1 euro = Q8.4034 al 20/11/2026");
    expect(JSON.stringify(euro.content)).toContain("1.0988 USD por euro");

    const peso = await conectar(
      clientFalso({
        tipoCambioMoneda: async () => ({
          fecha: "2026-11-20",
          codigo: 18,
          nombre: "Pesos Mexicanos",
          quetzales_por_unidad: 7.64781 / 19.0201,
          cotizacion_usd: 19.0201,
          convencion: "unidades_por_usd",
          compra: 19.0155,
          venta: 19.0201,
          descontinuada: false,
          referencia: "misma_fecha",
          fecha_referencia: "2026-11-20",
        }),
      }),
    );
    const mexicano = asResult(await peso.callTool({ name: "tipo_cambio_moneda", arguments: { codigo: 18 } }));
    expect(mexicano.structuredContent).toMatchObject({ nombre: "Pesos Mexicanos", nombre_singular: "peso mexicano" });
    expect(JSON.stringify(mexicano.content)).toContain(
      "1 peso mexicano = Q0.4021 al 20/11/2026 (19.0201 pesos mexicanos por 1 USD)",
    );

    const rango = asResult(
      await client.callTool({
        name: "tipo_cambio_moneda_rango",
        arguments: { codigo: 24, fecha_inicial: "2026-11-18", fecha_final: "2026-11-20" },
      }),
    );
    expect(rango.structuredContent).toMatchObject({
      nombre: "Euro",
      nombre_singular: "euro",
      serie: [
        { fecha: "2026-11-18", referencia: "misma_fecha", fecha_referencia: "2026-11-18" },
        { fecha: "2026-11-20", referencia: "misma_fecha", fecha_referencia: "2026-11-20" },
      ],
    });

    const conAviso = await conectar(
      clientFalso({
        tipoCambioMoneda: async () => ({ ...cotizacionMoneda(4), descontinuada: true, fecha: "2001-12-31" }),
      }),
    );
    const vieja = asResult(await conAviso.callTool({ name: "tipo_cambio_moneda", arguments: { codigo: 4 } }));
    expect(JSON.stringify(vieja.content)).toContain("Último dato: 31/12/2001, moneda reemplazada");
    expect(vieja.structuredContent).toMatchObject({ descontinuada: true });

    const codigoInvalido = asResult(
      await client.callTool({ name: "tipo_cambio_moneda", arguments: { codigo: -2 } }),
    );
    expect(codigoInvalido.isError).toBe(true);
    expect(JSON.stringify(codigoInvalido.content)).toMatch(/entero positivo/);
  });

  it("convierte un monto a quetzales y rechaza una moneda descontinuada", async () => {
    const client = await conectar(clientFalso());
    const euros = asResult(
      await client.callTool({
        name: "convertir_monto",
        arguments: { monto: 250, codigo: 24, direccion: "a_quetzales" },
      }),
    );
    expect(euros.isError).toBeUndefined();
    const tasa = 1.0988 * 7.64781;
    expect(euros.structuredContent).toMatchObject({
      monto: 250,
      codigo: 24,
      nombre: "Euro",
      resultado: Math.round(250 * tasa * 100) / 100,
      quetzales_por_unidad: Number(tasa.toPrecision(6)),
      fecha: "2026-11-20",
      descontinuada: false,
    });
    expect(JSON.stringify(euros.content)).toContain("250 euros = Q2,100.85 (tipo de cambio del 20/11/2026)");

    const grande = asResult(
      await client.callTool({
        name: "convertir_monto",
        arguments: { monto: 1234567.89, codigo: 24, direccion: "a_quetzales" },
      }),
    );
    const resultadoGrande = Math.round(1234567.89 * tasa * 100) / 100;
    expect(grande.structuredContent).toMatchObject({
      monto: 1234567.89,
      resultado: resultadoGrande,
      quetzales_por_unidad: Number(tasa.toPrecision(6)),
    });
    expect(JSON.stringify(grande.content)).toContain(`1,234,567.89 euros = Q${new Intl.NumberFormat("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(resultadoGrande)}`);

    const cero = asResult(
      await client.callTool({
        name: "convertir_monto",
        arguments: { monto: 0, codigo: 24, direccion: "a_quetzales" },
      }),
    );
    expect(cero.isError).toBe(true);

    const vieja = await conectar(
      clientFalso({
        tipoCambioMoneda: async () => ({ ...cotizacionMoneda(4), descontinuada: true, fecha: "2001-12-31" }),
      }),
    );
    const franco = asResult(
      await vieja.callTool({
        name: "convertir_monto",
        arguments: { monto: 10, codigo: 4, direccion: "desde_quetzales" },
      }),
    );
    expect(franco.isError).toBe(true);
    expect(JSON.stringify(franco.content)).toContain("descontinuada");
    expect(JSON.stringify(franco.content)).toContain("2001");
  });

  it("devuelve el mensaje del Banguat cuando el servicio falla", async () => {
    const client = await conectar(
      clientFalso({
        tipoCambioHoy: async () => {
          throw new Error("El servicio del Banguat no respondió en 10 segundos. Intenta de nuevo más tarde.");
        },
      }),
    );
    const result = asResult(await client.callTool({ name: "tipo_cambio_hoy", arguments: {} }));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("no respondió en 10 segundos");
  });
});
