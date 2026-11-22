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
          <Variable><moneda>18</moneda><descripcion>Pesos Mexicanos</descripcion></Variable>
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

const XML_PESO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <VariablesResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <VariablesResult>
        <CambioDia><Var><moneda>18</moneda><fecha>20/11/2026</fecha><venta>18.5</venta><compra>18.4</compra></Var></CambioDia>
        <TotalItems>1</TotalItems>
      </VariablesResult>
    </VariablesResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_RANGO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TipoCambioRangoResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <TipoCambioRangoResult>
        <Vars><Var><moneda>2</moneda><fecha>20/11/2026</fecha><venta>7.64781</venta><compra>7.64781</compra></Var></Vars>
        <TotalItems>1</TotalItems>
      </TipoCambioRangoResult>
    </TipoCambioRangoResponse>
  </soap:Body>
</soap:Envelope>`;

const XML_RANGO_VACIO = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TipoCambioRangoResponse xmlns="http://www.banguat.gob.gt/variables/ws/">
      <TipoCambioRangoResult><TotalItems>0</TotalItems></TipoCambioRangoResult>
    </TipoCambioRangoResponse>
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
      { fecha: "2026-11-18", valor: 7.64489, moneda: "USD", compra: 7.64489, venta: 7.64489, publicado_anticipado: false },
      { fecha: "2026-11-19", valor: 7.64682, moneda: "USD", compra: 7.64, venta: 7.64682, publicado_anticipado: false },
    ]);
    expect(seen[0]).toContain("<fechainit>18/11/2026</fechainit>");
    expect(seen[0]).toContain("TipoCambioFechaInicial");

    const conFin = createBanguatClient({
      fetch: async (_url, init) => {
        seen.push(String(init?.body));
        return xmlResponse(XML_RANGO);
      },
      now: () => HOY.getTime(),
    });
    await conFin.tipoCambioDesde("2026-11-18", "2026-11-20");
    expect(seen.at(-1)).toContain("TipoCambioRango");
    expect(seen.at(-1)).toContain("<fechafin>20/11/2026</fechafin>");
    await expect(conFin.tipoCambioDesde("2026-11-20", "2026-11-18")).rejects.toThrow(/anterior/);
  });

  it("marca como publicado por adelantado un punto posterior a hoy", async () => {
    const xml = XML_SERIE.replace(
      "</Vars>",
      `<Var><moneda>2</moneda><fecha>23/11/2026</fecha><venta>7.64059</venta><compra>7.64059</compra></Var></Vars>`,
    );
    const client = createBanguatClient({
      fetch: async () => xmlResponse(xml),
      now: () => HOY.getTime(),
    });
    const serie = await client.tipoCambioDesde("2026-11-18");
    expect(serie.find((punto) => punto.fecha === "2026-11-22")).toBeUndefined();
    expect(serie.find((punto) => punto.fecha === "2026-11-23")?.publicado_anticipado).toBe(true);
    expect(serie.find((punto) => punto.fecha === "2026-11-19")?.publicado_anticipado).toBe(false);
  });

  it("lista las monedas del catálogo", async () => {
    const client = createBanguatClient({ fetch: async () => xmlResponse(XML_MONEDAS) });
    await expect(client.monedasDisponibles()).resolves.toEqual([
      { codigo: 2, descripcion: "Dólares de EE.UU." },
      { codigo: 18, descripcion: "Pesos Mexicanos" },
      { codigo: 24, descripcion: "Euro" },
    ]);
  });

  it("convierte el euro y el peso a quetzales con la referencia de la misma fecha", async () => {
    const llamadas: string[] = [];
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        const body = String(init?.body);
        llamadas.push(body);
        if (body.includes("VariablesDisponibles")) return xmlResponse(XML_MONEDAS);
        if (body.includes("TipoCambioRango")) return xmlResponse(XML_RANGO);
        if (body.includes("<variable>18</variable>")) return xmlResponse(XML_PESO);
        if (body.includes("<variable>24</variable>")) return xmlResponse(XML_EURO);
        return xmlResponse(XML_HOY);
      },
      now: () => HOY.getTime(),
    });

    const euro = await client.tipoCambioMoneda(24);
    expect(euro).toMatchObject({
      fecha: "2026-11-20",
      codigo: 24,
      nombre: "Euro",
      cotizacion_usd: 1.0988,
      convencion: "usd_por_unidad",
      compra: 1.09,
      venta: 1.0988,
      referencia: "misma_fecha",
    });
    expect(euro.quetzales_por_unidad).toBeCloseTo(1.0988 * 7.64781, 8);
    expect(llamadas.some((body) => body.includes("TipoCambioRango") && body.includes("20/11/2026"))).toBe(true);

    const peso = await client.tipoCambioMoneda(18);
    expect(peso.convencion).toBe("unidades_por_usd");
    expect(peso.quetzales_por_unidad).toBeCloseTo(7.64781 / 18.5, 8);
    expect(peso.nombre).toBe("Pesos Mexicanos");
  });

  it("usa TipoCambioDia si no hay referencia USD de la fecha de la moneda", async () => {
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        const body = String(init?.body);
        if (body.includes("VariablesDisponibles")) return xmlResponse(XML_MONEDAS);
        if (body.includes("TipoCambioRango")) return xmlResponse(XML_RANGO_VACIO);
        if (body.includes("TipoCambioDia")) return xmlResponse(XML_HOY);
        return xmlResponse(XML_EURO);
      },
      now: () => HOY.getTime(),
    });
    const euro = await client.tipoCambioMoneda(24);
    expect(euro.referencia).toBe("tipo_cambio_dia");
    expect(euro.quetzales_por_unidad).toBeCloseTo(1.0988 * 7.64781, 8);
  });

  it("rechaza el quetzal y resuelve el dólar con la referencia del día", async () => {
    const llamadas: string[] = [];
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        const body = String(init?.body);
        llamadas.push(body);
        if (body.includes("VariablesDisponibles")) return xmlResponse(XML_MONEDAS);
        return xmlResponse(XML_HOY);
      },
      now: () => HOY.getTime(),
    });
    await expect(client.tipoCambioMoneda(1)).rejects.toThrow(/Quetzales/);
    const dolar = await client.tipoCambioMoneda(2);
    expect(dolar.quetzales_por_unidad).toBe(7.64781);
    expect(dolar.cotizacion_usd).toBe(1);
    expect(llamadas.some((body) => body.includes("<variable>2</variable>"))).toBe(false);
  });

  it("marca descontinuada cuando el último dato tiene más de 30 días", async () => {
    const vieja = XML_EURO.replace("20/11/2026", "31/12/2001");
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        const body = String(init?.body);
        if (body.includes("VariablesDisponibles")) return xmlResponse(XML_MONEDAS);
        if (body.includes("TipoCambioRango")) return xmlResponse(XML_RANGO_VACIO);
        if (body.includes("TipoCambioDia")) return xmlResponse(XML_HOY);
        return xmlResponse(vieja);
      },
      now: () => HOY.getTime(),
    });
    const euro = await client.tipoCambioMoneda(24);
    expect(euro.descontinuada).toBe(true);
    expect(euro.fecha).toBe("2001-12-31");
  });

  it("explica cuando el código no trae cotización", async () => {
    const client = createBanguatClient({
      fetch: async (_url, init) =>
        xmlResponse(String(init?.body).includes("VariablesDisponibles") ? XML_MONEDAS : XML_VACIO),
    });
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

  it("cachea el día una hora y la serie dentro del mismo día de Guatemala", async () => {
    let calls = 0;
    const medianoche = Date.parse("2026-11-22T06:00:00.000Z");
    let clock = medianoche;
    const client = createBanguatClient({
      fetch: async (_url, init) => {
        calls += 1;
        return xmlResponse(String(init?.body).includes("TipoCambioFechaInicial") ? XML_SERIE : XML_HOY);
      },
      now: () => clock,
    });

    await client.tipoCambioHoy();
    clock = medianoche + TTL_HOY_MS - 1;
    await client.tipoCambioHoy();
    expect(calls).toBe(1);
    clock = medianoche + TTL_HOY_MS;
    await client.tipoCambioHoy();
    expect(calls).toBe(2);

    await client.tipoCambioDesde("2026-01-01");
    clock = medianoche + 23 * TTL_HOY_MS;
    await client.tipoCambioDesde("2026-01-01");
    expect(calls).toBe(3);
    clock = medianoche + 25 * TTL_HOY_MS;
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

  it("usa la fecha de Guatemala en la clave y comparte la petición en vuelo", async () => {
    const cache = new Map();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = createBanguatClient({
      cache,
      now: () => HOY.getTime(),
      fetch: async () => {
        calls += 1;
        await gate;
        return xmlResponse(XML_HOY);
      },
    });
    const pending = Promise.all([client.tipoCambioHoy(), client.tipoCambioHoy()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    release();
    await pending;
    expect([...cache.keys()]).toContain("hoy:2026-11-22");
  });

  it("borra la entrada más vieja al pasar de 200", async () => {
    const cache = new Map();
    let calls = 0;
    const client = createBanguatClient({
      cache,
      now: () => HOY.getTime(),
      fetch: async () => {
        calls += 1;
        return xmlResponse(XML_SERIE);
      },
    });
    const fecha = (dias: number) => {
      const cursor = new Date(Date.UTC(2026, 10, 22));
      cursor.setUTCDate(cursor.getUTCDate() - dias);
      return cursor.toISOString().slice(0, 10);
    };
    for (let dia = 1; dia <= 201; dia += 1) await client.tipoCambioDesde(fecha(dia));
    expect(cache.size).toBe(200);
    const hechas = calls;
    await client.tipoCambioDesde(fecha(1));
    expect(calls).toBe(hechas + 1);
    await client.tipoCambioDesde(fecha(201));
    expect(calls).toBe(hechas + 1);
  });

  it("toServiceDate usa el reloj inyectado del cliente", async () => {
    let calls = 0;
    const client = createBanguatClient({
      now: () => Date.parse("2020-01-01T18:00:00.000Z"),
      fetch: async () => {
        calls += 1;
        return xmlResponse(XML_SERIE);
      },
    });
    await expect(client.tipoCambioDesde("2026-01-01")).rejects.toThrow(/Fecha futura/);
    expect(calls).toBe(0);
  });

  it("traduce un SOAP Fault y un HTTP de error", async () => {
    const fault = createBanguatClient({ fetch: async () => xmlResponse(XML_FAULT) });
    await expect(fault.tipoCambioHoy()).rejects.toThrow(/SOAPAction/);

    const http = createBanguatClient({ fetch: async () => xmlResponse("no", 503) });
    await expect(http.tipoCambioHoy()).rejects.toThrow(/HTTP 503/);
  });
});
