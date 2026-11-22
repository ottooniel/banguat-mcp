import { nombrePlural } from "./nombres.js";

export function redondear(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(n.toPrecision(6));
}

export function formatoQuetzales(q: number, codigo: number, respaldo: string): string {
  const valor = redondear(q);
  if (valor >= 0.1) return `Q${valor.toFixed(4)}`;
  const porCien = redondear(valor * 100);
  return `100 ${nombrePlural(codigo, respaldo)} = Q${porCien.toFixed(4)}`;
}

export function redondearDatos<T>(value: T): T {
  if (typeof value === "number") return redondear(value) as T;
  if (Array.isArray(value)) return value.map((item) => redondearDatos(item)) as T;
  if (value !== null && typeof value === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, item] of Object.entries(value)) salida[clave] = redondearDatos(item);
    return salida as T;
  }
  return value;
}
