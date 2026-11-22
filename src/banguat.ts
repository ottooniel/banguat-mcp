import { XMLParser } from "fast-xml-parser";

export const SERVICE_URL = "https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx";
const NAMESPACE = "http://www.banguat.gob.gt/variables/ws/";
const TIMEOUT_MS = 10_000;

export const TTL_HOY_MS = 60 * 60 * 1000;
export const TTL_SERIE_MS = 24 * TTL_HOY_MS;

export class BanguatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BanguatError";
  }
}

export type Cotizacion = {
  fecha: string;
  valor: number;
  moneda: string;
  compra?: number;
  venta?: number;
};

export type Convencion = "usd_por_unidad" | "unidades_por_usd";

export type CotizacionMoneda = {
  fecha: string;
  codigo: number;
  nombre: string;
  quetzales_por_unidad: number;
  cotizacion_usd: number;
  convencion: Convencion;
  compra: number;
  venta: number;
  descontinuada: boolean;
  referencia: "misma_fecha" | "tipo_cambio_dia";
};

const USD_POR_UNIDAD = new Set([9, 24, 26]);

export function convencionDe(codigo: number): Convencion {
  return USD_POR_UNIDAD.has(codigo) ? "usd_por_unidad" : "unidades_por_usd";
}

export function aQuetzales(convencion: Convencion, cotizacionUsd: number, referenciaUsd: number): number {
  if (cotizacionUsd === 0) {
    throw new BanguatError("El Banguat devolvió una cotización en cero y no se puede convertir a quetzales.");
  }
  switch (convencion) {
    case "usd_por_unidad":
      return cotizacionUsd * referenciaUsd;
    case "unidades_por_usd":
      return referenciaUsd / cotizacionUsd;
    default: {
      const nunca: never = convencion;
      return nunca;
    }
  }
}

export type PuntoSerie = {
  fecha: string;
  valor: number;
  moneda: "USD";
  compra: number;
  venta: number;
};

export type MonedaDisponible = {
  codigo: number;
  descripcion: string;
};

export type BanguatClient = {
  tipoCambioHoy: () => Promise<Cotizacion>;
  tipoCambioDesde: (fechaInicialIso: string) => Promise<PuntoSerie[]>;
  monedasDisponibles: () => Promise<MonedaDisponible[]>;
  tipoCambioMoneda: (codigo: number) => Promise<CotizacionMoneda>;
};

type CacheEntry = { expiresAt: number; value: unknown };

export type ClientOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  cache?: Map<string, CacheEntry>;
};

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  isArray: (tagName) => tagName === "Variable" || tagName === "Var" || tagName === "VarDolar",
});

export function fechaGuatemala(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function fechaInicialError(iso: string, now = new Date()): string | undefined {
  const value = iso.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return `Fecha inválida: "${iso}". Usa el formato YYYY-MM-DD.`;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const exists =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  if (!exists) {
    return `Fecha inválida: "${value}" no existe en el calendario.`;
  }
  const hoy = fechaGuatemala(now);
  if (value > hoy) {
    return `Fecha futura: "${value}". El servicio del Banguat solo acepta fechas hasta hoy (${hoy}, hora de Guatemala).`;
  }
  return undefined;
}

export function toServiceDate(iso: string, now = new Date()): string {
  const message = fechaInicialError(iso, now);
  if (message) throw new BanguatError(message);
  const [year, month, day] = iso.trim().split("-");
  return `${day}/${month}/${year}`;
}

export function createBanguatClient(options: ClientOptions = {}): BanguatClient {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? new Map<string, CacheEntry>();

  return {
    tipoCambioHoy: () =>
      remember(cache, now, "hoy", TTL_HOY_MS, async () => parseHoy(await soap(fetchImpl, "TipoCambioDia", {}))),
    tipoCambioDesde: async (fechaInicialIso) => {
      const fechainit = toServiceDate(fechaInicialIso);
      return remember(cache, now, `serie:${fechainit}`, TTL_SERIE_MS, async () =>
        parseSerie(await soap(fetchImpl, "TipoCambioFechaInicial", { fechainit })),
      );
    },
    monedasDisponibles: () =>
      remember(cache, now, "monedas", TTL_HOY_MS, async () =>
        parseMonedas(await soap(fetchImpl, "VariablesDisponibles", {})),
      ),
    tipoCambioMoneda: (codigo) => cotizarMoneda(codigo),
  };

  async function cotizarMoneda(codigo: number): Promise<CotizacionMoneda> {
    if (codigo === 1) {
      throw new BanguatError(
        "El código 1 es Quetzales, la moneda base. No tiene cotización contra el quetzal.",
      );
    }
    return remember(cache, now, `moneda:${codigo}`, TTL_HOY_MS, async () => {
      if (codigo === 2) {
        const nombre = await nombreMoneda(codigo);
        const hoy = await remember(cache, now, "hoy", TTL_HOY_MS, async () =>
          parseHoy(await soap(fetchImpl, "TipoCambioDia", {})),
        );
        return {
          fecha: hoy.fecha,
          codigo: 2,
          nombre,
          quetzales_por_unidad: hoy.valor,
          cotizacion_usd: 1,
          convencion: "usd_por_unidad",
          compra: hoy.valor,
          venta: hoy.valor,
          descontinuada: false,
          referencia: "misma_fecha",
        };
      }

      const cruda = parseVariable(await soap(fetchImpl, "Variables", { variable: codigo }), codigo);
      const referencia = await referenciaUsd(cruda.fecha);
      const convencion = convencionDe(codigo);
      const nombreCotizacion = await nombreMoneda(codigo);
      return {
        fecha: cruda.fecha,
        codigo,
        nombre: nombreCotizacion,
        quetzales_por_unidad: aQuetzales(convencion, cruda.venta, referencia.valor),
        cotizacion_usd: cruda.venta,
        convencion,
        compra: cruda.compra,
        venta: cruda.venta,
        descontinuada: false,
        referencia: referencia.fuente,
      };
    });
  }

  async function nombreMoneda(codigo: number): Promise<string> {
    const monedas = await remember(cache, now, "monedas", TTL_HOY_MS, async () =>
      parseMonedas(await soap(fetchImpl, "VariablesDisponibles", {})),
    );
    return monedas.find((moneda) => moneda.codigo === codigo)?.descripcion ?? `Moneda ${codigo}`;
  }

  async function referenciaUsd(fecha: string): Promise<{ valor: number; fuente: "misma_fecha" | "tipo_cambio_dia" }> {
    const fechainit = aFormatoServicio(fecha);
    const puntos = await remember(cache, now, `usdref:${fechainit}`, TTL_SERIE_MS, async () =>
      parseSerieDe(
        await soap(fetchImpl, "TipoCambioRango", { fechainit, fechafin: fechainit }),
        "TipoCambioRangoResponse",
        "TipoCambioRangoResult",
      ),
    );
    const misma = puntos.find((punto) => punto.fecha === fecha);
    if (misma) return { valor: misma.valor, fuente: "misma_fecha" };
    const hoy = await remember(cache, now, "hoy", TTL_HOY_MS, async () =>
      parseHoy(await soap(fetchImpl, "TipoCambioDia", {})),
    );
    return { valor: hoy.valor, fuente: "tipo_cambio_dia" };
  }
}

async function remember<T>(
  cache: Map<string, CacheEntry>,
  now: () => number,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const current = now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > current) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: current + ttlMs, value });
  return value;
}

async function soap(
  fetchImpl: typeof fetch,
  operation: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(SERVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${NAMESPACE}${operation}"`,
      },
      body: envelope(operation, params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new BanguatError(
        "El servicio del Banguat no respondió en 10 segundos. Intenta de nuevo más tarde.",
      );
    }
    throw new BanguatError(
      "No se pudo contactar el web service del Banguat. Revisa la conexión e intenta de nuevo.",
    );
  }

  const xml = await response.text();
  if (!response.ok) {
    throw new BanguatError(`El Banguat respondió HTTP ${response.status}. Intenta de nuevo más tarde.`);
  }

  const body = child(child(parser.parse(xml), "Envelope"), "Body");
  const fault = child(body, "Fault");
  if (fault) {
    const detail = text(child(fault, "faultstring")) ?? "error SOAP sin detalle";
    throw new BanguatError(`El Banguat rechazó la consulta: ${detail}`);
  }
  return body;
}

function envelope(operation: string, params: Record<string, string | number>): string {
  const fields = Object.entries(params)
    .map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${operation} xmlns="${NAMESPACE}">${fields}</${operation}></soap:Body>` +
    `</soap:Envelope>`
  );
}

function parseHoy(body: unknown): Cotizacion {
  const result = child(child(body, "TipoCambioDiaResponse"), "TipoCambioDiaResult");
  const dolar = last(asList(child(child(result, "CambioDolar"), "VarDolar")));
  if (!dolar) {
    throw new BanguatError("El Banguat no devolvió el tipo de cambio de referencia del día.");
  }
  return cotizacionDolar(dolar);
}

function parseSerie(body: unknown): PuntoSerie[] {
  const puntos = parseSerieDe(body, "TipoCambioFechaInicialResponse", "TipoCambioFechaInicialResult");
  if (puntos.length === 0) {
    throw new BanguatError("El Banguat no devolvió registros para esa fecha inicial.");
  }
  return puntos;
}

function parseSerieDe(body: unknown, respuesta: string, resultado: string): PuntoSerie[] {
  const result = child(child(body, respuesta), resultado);
  return asList(child(child(result, "Vars"), "Var")).map((item) => {
    const venta = num(child(item, "venta"), "venta");
    return {
      fecha: isoFecha(text(child(item, "fecha"))),
      valor: venta,
      moneda: "USD" as const,
      compra: num(child(item, "compra"), "compra"),
      venta,
    };
  });
}

function parseVariable(body: unknown, codigo: number): { fecha: string; compra: number; venta: number } {
  const result = child(child(body, "VariablesResponse"), "VariablesResult");
  const dia = last(asList(child(child(result, "CambioDia"), "Var")));
  if (!dia) {
    throw new BanguatError(
      `El Banguat no devolvió tipo de cambio para la moneda ${codigo}. Revisa el código con monedas_disponibles.`,
    );
  }
  return {
    fecha: isoFecha(text(child(dia, "fecha"))),
    compra: num(child(dia, "compra"), "compra"),
    venta: num(child(dia, "venta"), "venta"),
  };
}

function aFormatoServicio(iso: string): string {
  const value = iso.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new BanguatError(`Fecha inválida: "${iso}". Usa el formato YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const exists =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  if (!exists) throw new BanguatError(`Fecha inválida: "${value}" no existe en el calendario.`);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function parseMonedas(body: unknown): MonedaDisponible[] {
  const result = child(child(body, "VariablesDisponiblesResponse"), "VariablesDisponiblesResult");
  const monedas = asList(child(child(result, "Variables"), "Variable")).map((item) => ({
    codigo: num(child(item, "moneda"), "moneda"),
    descripcion: text(child(item, "descripcion")) ?? "",
  }));
  if (monedas.length === 0) {
    throw new BanguatError("El Banguat no devolvió monedas disponibles.");
  }
  return monedas;
}

function cotizacionDolar(item: unknown): Cotizacion {
  return {
    fecha: isoFecha(text(child(item, "fecha"))),
    valor: num(child(item, "referencia"), "referencia"),
    moneda: "USD",
  };
}

function isoFecha(value: string | undefined): string {
  if (!value) throw new BanguatError("El Banguat devolvió una cotización sin fecha.");
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return value.trim();
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function asList(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function last(items: unknown[]): unknown {
  return items.length === 0 ? undefined : items[items.length - 1];
}

function child(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  return (node as Record<string, unknown>)[key];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BanguatError(`El Banguat devolvió un valor ilegible en ${field}.`);
  }
  return parsed;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = String(error.name);
  return name === "TimeoutError" || name === "AbortError";
}
