import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { BanguatClient } from "../src/banguat.js";
import { createServer } from "../src/server.js";

const XML_FECHA = "2026-11-22";

function clientFalso(overrides: Partial<BanguatClient> = {}): BanguatClient {
  return {
    tipoCambioHoy: async () => ({ fecha: XML_FECHA, valor: 7.64781, moneda: "USD" }),
    tipoCambioDesde: async () => [
      { fecha: "2026-11-18", valor: 7.64489, moneda: "USD", compra: 7.64489, venta: 7.64489 },
      { fecha: XML_FECHA, valor: 7.64781, moneda: "USD", compra: 7.64781, venta: 7.64781 },
    ],
    monedasDisponibles: async () => [
      { codigo: 2, descripcion: "Dólares de EE.UU." },
      { codigo: 24, descripcion: "Euro" },
    ],
    tipoCambioMoneda: async (codigo) =>
      codigo === 2
        ? { fecha: XML_FECHA, valor: 7.64781, moneda: "USD" }
        : { fecha: "2026-11-20", valor: 1.0988, moneda: String(codigo), compra: 1.09, venta: 1.0988 },
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
  it("anuncia las cuatro herramientas en español", async () => {
    const client = await conectar(clientFalso());
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["monedas_disponibles", "tipo_cambio_desde", "tipo_cambio_hoy", "tipo_cambio_moneda"]);
    for (const tool of listed.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }
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
      moneda: "USD",
      serie: [
        { fecha: "2026-11-18", valor: 7.64489, moneda: "USD" },
        { fecha: XML_FECHA, valor: 7.64781, moneda: "USD" },
      ],
    });

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
    expect(euro.structuredContent).toEqual({
      fecha: "2026-11-20",
      valor: 1.0988,
      moneda: "24",
      compra: 1.09,
      venta: 1.0988,
    });
    expect(JSON.stringify(euro.content)).toContain("venta 1.0988");

    const codigoInvalido = asResult(
      await client.callTool({ name: "tipo_cambio_moneda", arguments: { codigo: -2 } }),
    );
    expect(codigoInvalido.isError).toBe(true);
    expect(JSON.stringify(codigoInvalido.content)).toMatch(/entero positivo/);
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
