import { describe, expect, it } from "vitest";
import {
  BanguatError,
  TTL_HOY_MS,
  TTL_SERIE_MS,
  createBanguatClient,
  fechaInicialError,
  toServiceDate,
} from "../src/banguat.js";

const HOY = new Date("2026-11-22T18:00:00.000Z");

const XML_HOY = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TipoCambioDiaResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <TipoCambioDiaResult>
        <CambioDolar><VarDolar><fecha>22/11/2026</fecha><referencia>7.64781</referencia></VarDolar></CambioDolar>
        <TotalItems>1</TotalItems>
      </TipoCambioDiaResult>
    </TipoCambioDiaResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_SERIE = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TipoCambioFechaInicialResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <TipoCambioFechaInicialResult>
        <Vars>
          <Var><moneda>2</moneda><fecha>18/11/2026</fecha><venta>7.64489</venta><compra>7.64489</compra></Var>
          <Var><moneda>2</moneda><fecha>19/11/2026</fecha><venta>7.64682</venta><compra>7.64000</compra></Var>
        </Vars>
        <TotalItems>2</TotalItems>
      </TipoCambioFechaInicialResult>
    </TipoCambioFechaInicialResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_MONEDAS = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VariablesDisponiblesResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <VariablesDisponiblesResult>
        <Variables>
          <Variable><moneda>2</moneda><descripcion>Dólares de EE.UU.</descripcion></Variable>
          <Variable><moneda>24</moneda><descripcion>Euro</descripcion></Variable>
        </Variables>
        <TotalItems>2</TotalItems>
      </VariablesDisponiblesResult>
    </VariablesDisponiblesResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_EURO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VariablesResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <VariablesResult>
        <CambioDia><Var><moneda>24</moneda><fecha>20/11/2026</fecha><venta>1.0988</venta><compra>1.0900</compra></Var></CambioDia>
        <TotalItems>1</TotalItems>
      </VariablesResult>
    </VariablesResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_USD = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VariablesResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <VariablesResult>
        <CambioDolar><VarDolar><fecha>22/11/2026</fecha><referencia>7.64781</referencia></VarDolar></CambioDolar>
        <TotalItems>1</TotalItems>
      </VariablesResult>
    </VariablesResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_VACIO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VariablesResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <VariablesResult><TotalItems>0</TotalItems></VariablesResult>
    </VariablesResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_FAULT = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault><faultstring>Server did not recognize the value of HTTP Header SOAPAction</faultstring></soap:Fault>
  </soap:Body>
</soap:Envelope>`;

function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml" } });
}

describe("fechas", () => {
  it("convierte YYYY-MM-DD al formato dd/mm/aaaa del servicio", () => {
    expect(toServiceDate("2026-11-18", HOY)).toBe("18/11/2026");
  });

  it("rechaza una fecha que no existe", () => {
    expect(fechaInicialError("2026-02-31", HOY)).toMatch(/no existe/);
  });

  it("rechaza un formato distinto de YYYY-MM-DD", () => {
    expect(fechaInicialError("22/11/2026", HOY)).toMatch(/YYYY-MM-DD/);
  });

  it("rechaza una fecha futura en hora de Guatemala", () => {
    expect(fechaInicialError("2026-11-23", HOY)).toMatch(/Fecha futura/);
  });

  it("acepta el día de hoy en Guatemala aunque en UTC ya sea el día siguiente", () => {
    const casiMedianoche = new Date("2026-11-23T05:30:00.000Z");
    expect(fechaInicialError("2026-11-22", casiMedianoche)).toBeUndefined();
  });
});

describe("cliente SOAP", () => {
  it("lee el tipo de cambio de referencia del día", async () => {
    const client = createBanguatClient({ fetch: async () => xmlResponse(XML_HOY) });
    await expect(client.tipoCambioHoy()).resolves.toEqual({
      fecha: "2026-11-22",
      valor: 7.64781,
      moneda: "USD",
    });
  });

  it("lee la serie desde una fecha y usa venta como valor", async () => {
    const seen: string[] = [];
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        seen.push(String(init?.body));
        return xmlResponse(XML_SERIE);
      },
      now: () => HOY.getTime(),
    });

    await expect(client.tipoCambioDesde("2026-11-18")).resolves.toEqual([
      { fecha: "2026-11-18", valor: 7.64489, moneda: "USD", compra: 7.64489, venta: 7.64489 },
      { fecha: "2026-11-19", valor: 7.64682, moneda: "USD", compra: 7.64, venta: 7.64682 },
    ]);
    expect(seen[0]).toContain("<fechainit>18/11/2026</fechainit>");
    expect(seen[0]).toContain("TipoCambioFechaInicial");
  });

  it("lista las monedas del catálogo", async () => {
    const client = createBanguatClient({ fetch: async () => xmlResponse(XML_MONEDAS) });
    await expect(client.monedasDisponibles()).resolves.toEqual([
      { codigo: 2, descripcion: "Dólares de EE.UU." },
      { codigo: 24, descripcion: "Euro" },
    ]);
  });

  it("lee compra y venta de una moneda y la referencia si el código es el dólar", async () => {
    const client = createBanguatClient({
      fetch: async (_url, init) => xmlResponse(String(init?.body).includes("<variable>2</variable>") ? XML_USD : XML_EURO),
    });

    await expect(client.tipoCambioMoneda(24)).resolves.toEqual({
      fecha: "2026-11-20",
      valor: 1.0988,
      moneda: "24",
      compra: 1.09,
      venta: 1.0988,
    });
    await expect(client.tipoCambioMoneda(2)).resolves.toMatchObject({
      fecha: "2026-11-22",
      valor: 7.64781,
      moneda: "USD",
    });
  });

  it("explica cuando el código no trae cotización", async () => {
    const client = createBanguatClient({ fetch: async () => xmlResponse(XML_VACIO) });
    await expect(client.tipoCambioMoneda(999)).rejects.toThrow(/moneda 999/);
  });

  it("no llama al servicio si la fecha es inválida", async () => {
    let calls = 0;
    const client = createBanguatClient({
      fetch: async () => {
        calls += 1;
        return xmlResponse(XML_SERIE);
      },
      now: () => HOY.getTime(),
    });
    await expect(client.tipoCambioDesde("2026-11-23")).rejects.toBeInstanceOf(BanguatError);
    expect(calls).toBe(0);
  });

  it("cachea el día una hora y la serie 24 horas", async () => {
    let calls = 0;
    let clock = 0;
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        calls += 1;
        return xmlResponse(String(init?.body).includes("TipoCambioFechaInicial") ? XML_SERIE : XML_HOY);
      },
      now: () => clock,
    });

    await client.tipoCambioHoy();
    clock = TTL_HOY_MS - 1;
    await client.tipoCambioHoy();
    expect(calls).toBe(1);
    clock = TTL_HOY_MS;
    await client.tipoCambioHoy();
    expect(calls).toBe(2);

    await client.tipoCambioDesde("2026-01-01");
    clock = TTL_HOY_MS + TTL_SERIE_MS - 1;
    await client.tipoCambioDesde("2026-01-01");
    expect(calls).toBe(3);
    clock = TTL_HOY_MS + TTL_SERIE_MS;
    await client.tipoCambioDesde("2026-01-01");
    expect(calls).toBe(4);
  });

  it("no guarda en caché una respuesta fallida", async () => {
    let calls = 0;
    const client = createBanguatClient({
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("reset");
        return xmlResponse(XML_HOY);
      },
    });
    await expect(client.tipoCambioHoy()).rejects.toThrow(/No se pudo contactar/);
    await expect(client.tipoCambioHoy()).resolves.toMatchObject({ valor: 7.64781 });
    expect(calls).toBe(2);
  });

  it("avisa si el Banguat no responde a tiempo", async () => {
    const client = createBanguatClient({
      fetch: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    await expect(client.tipoCambioHoy()).rejects.toThrow(/no respondió en 10 segundos/);
  });

  it("traduce un SOAP Fault y un HTTP de error", async () => {
    const fault = createBanguatClient({ fetch: async () => xmlResponse(XML_FAULT) });
    await expect(fault.tipoCambioHoy()).rejects.toThrow(/SOAPAction/);

    const http = createBanguatClient({ fetch: async () => xmlResponse("no", 503) });
    await expect(http.tipoCambioHoy()).rejects.toThrow(/HTTP 503/);
  });
});
