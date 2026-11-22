import { describe, expect, it } from "vitest";
import { acotarLineas, prepararSerie } from "../src/serie.js";

function diarios(cantidad: number, inicio = "2020-01-01"): { fecha: string; valor: number }[] {
  const [year, month, day] = inicio.split("-").map(Number);
  const cursor = new Date(Date.UTC(year ?? 2020, (month ?? 1) - 1, day ?? 1));
  return Array.from({ length: cantidad }, (_, indice) => {
    const fecha = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return { fecha, valor: 7 + (indice % 5) * 0.1 };
  });
}

describe("agrupación", () => {
  it("deja la serie diaria si no pasa de 62 puntos", () => {
    const lista = prepararSerie(diarios(62));
    expect(lista.agrupacion).toBe("diaria");
    expect(lista.serie).toHaveLength(62);
    expect(lista.serie[0]).toMatchObject({ cierre: 7, min: 7, max: 7 });
  });

  it("agrupa por semana dentro de un año y por mes si el tramo es más largo", () => {
    const ano = prepararSerie(diarios(100));
    expect(ano.agrupacion).toBe("semanal");
    expect(ano.serie.length).toBeLessThan(100);
    expect(ano.serie[0]?.min).toBeLessThanOrEqual(ano.serie[0]?.cierre ?? 0);
    expect(ano.serie[0]?.max).toBeGreaterThanOrEqual(ano.serie[0]?.cierre ?? 0);

    const larga = prepararSerie(diarios(400));
    expect(larga.agrupacion).toBe("mensual");
    expect(larga.resumen.registros_originales).toBe(400);
    expect(larga.serie.length).toBeLessThan(20);
  });

  it("respeta una agrupación pedida y resume la serie original", () => {
    const puntos = [
      { fecha: "2026-01-01", valor: 7 },
      { fecha: "2026-01-02", valor: 8 },
      { fecha: "2026-01-03", valor: 7.5 },
    ];
    const lista = prepararSerie(puntos, "diaria");
    expect(lista.resumen).toMatchObject({
      inicio: "2026-01-01",
      fin: "2026-01-03",
      valor_inicial: 7,
      valor_final: 7.5,
      registros_originales: 3,
      minimo: { fecha: "2026-01-01", valor: 7 },
      maximo: { fecha: "2026-01-02", valor: 8 },
    });
    expect(lista.resumen.variacion_pct).toBeCloseTo(((7.5 - 7) / 7) * 100, 8);
  });

  it("no deja el texto por encima de 70 líneas", () => {
    const lineas = Array.from({ length: 120 }, (_, indice) => `punto ${indice}`);
    const texto = acotarLineas(lineas);
    expect(texto.split("\n")).toHaveLength(70);
    expect(texto).toContain("omitidas");
  });
});
