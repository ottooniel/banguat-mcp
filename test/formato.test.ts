import { describe, expect, it } from "vitest";
import { aQuetzales } from "../src/banguat.js";
import { formatoQuetzales, redondear } from "../src/formato.js";

const REF = 7.64781;

describe("precisión", () => {
  it("no deja el peso colombiano en Q0.00 y muestra el mexicano en Q0.4021", () => {
    const cop = aQuetzales("unidades_por_usd", 3419.85, REF);
    const textoCop = formatoQuetzales(cop, "Pesos Colombianos");
    expect(textoCop).toBe("100 Pesos Colombianos = Q0.2236");
    expect(textoCop).not.toContain("Q0.00");

    const mxn = aQuetzales("unidades_por_usd", 19.0201, REF);
    expect(redondear(mxn)).toBe(0.402091);
    expect(formatoQuetzales(mxn, "Pesos Mexicanos")).toBe("Q0.4021");
  });

  it("deja el euro en 4 decimales", () => {
    const euro = aQuetzales("usd_por_unidad", 1.0988, REF);
    expect(redondear(euro)).toBe(8.40341);
    expect(formatoQuetzales(euro, "Euro")).toBe("Q8.4034");
  });
});
