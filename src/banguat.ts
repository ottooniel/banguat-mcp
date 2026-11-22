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
  tipoCambioMoneda: (codigo: number) => Promise<Cotizacion>;
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
    tipoCambioMoneda: (codigo) =>
      remember(cache, now, `moneda:${codigo}`, TTL_HOY_MS, async () =>
        parseMoneda(await soap(fetchImpl, "Variables", { variable: codigo }), codigo),
      ),
  };
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
  const result = child(child(body, "TipoCambioFechaInicialResponse"), "TipoCambioFechaInicialResult");
  const puntos = asList(child(child(result, "Vars"), "Var")).map((item) => {
    const venta = num(child(item, "venta"), "venta");
    return {
      fecha: isoFecha(text(child(item, "fecha"))),
      valor: venta,
      moneda: "USD" as const,
      compra: num(child(item, "compra"), "compra"),
      venta,
    };
  });
  if (puntos.length === 0) {
    throw new BanguatError("El Banguat no devolvió registros para esa fecha inicial.");
  }
  return puntos;
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

function parseMoneda(body: unknown, codigo: number): Cotizacion {
  const result = child(child(body, "VariablesResponse"), "VariablesResult");
  const dolar = last(asList(child(child(result, "CambioDolar"), "VarDolar")));
  if (dolar) return cotizacionDolar(dolar);

  const dia = last(asList(child(child(result, "CambioDia"), "Var")));
  if (!dia) {
    throw new BanguatError(
      `El Banguat no devolvió tipo de cambio para la moneda ${codigo}. Revisa el código con monedas_disponibles.`,
    );
  }
  const venta = num(child(dia, "venta"), "venta");
  return {
    fecha: isoFecha(text(child(dia, "fecha"))),
    valor: venta,
    moneda: String(num(child(dia, "moneda"), "moneda")),
    compra: num(child(dia, "compra"), "compra"),
    venta,
  };
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
