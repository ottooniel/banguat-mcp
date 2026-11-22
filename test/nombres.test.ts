import { describe, expect, it } from "vitest";
import { codigosConNombre, nombreSingular } from "../src/nombres.js";

describe("nombres en singular", () => {
  it("cubre los 40 códigos del catálogo", () => {
    expect(codigosConNombre()).toHaveLength(40);
  });

  it("usa el singular de los ejemplos del catálogo", () => {
    expect(nombreSingular(18, "Pesos Mexicanos")).toBe("peso mexicano");
    expect(nombreSingular(3, "Yenes Japoneses")).toBe("yen japonés");
    expect(nombreSingular(4, "Francos Belgas")).toBe("franco belga");
    expect(nombreSingular(24, "Euro")).toBe("euro");
  });
});
