import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL_SERVICIO = "https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx";
const NAMESPACE = "http://www.banguat.gob.gt/variables/ws/";
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

const hoy = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Guatemala",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

await mkdir(SALIDA, { recursive: true });

await guardar("tipo-cambio-dia.xml", "TipoCambioDia", {});
await guardar("tipo-cambio-fecha-inicial.xml", "TipoCambioFechaInicial", {
  fechainit: formato(restarDias(hoy, 4)),
});
await guardar("tipo-cambio-rango.xml", "TipoCambioRango", {
  fechainit: formato(restarDias(hoy, 30)),
  fechafin: formato(hoy),
});
await guardar("variables-disponibles.xml", "VariablesDisponibles", {});
await guardar("variables-24.xml", "Variables", { variable: 24 });
await guardar("variables-18.xml", "Variables", { variable: 18 });
await guardar("variables-4.xml", "Variables", { variable: 4 });

console.log(`Fixtures guardados en ${SALIDA} (hoy Guatemala: ${hoy}).`);

async function guardar(archivo, operacion, params) {
  const response = await fetch(URL_SERVICIO, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NAMESPACE}${operacion}"`,
    },
    body: sobre(operacion, params),
    signal: AbortSignal.timeout(10_000),
  });
  const xml = await response.text();
  if (!response.ok || xml.includes("<faultstring>")) {
    throw new Error(`${operacion} falló (${response.status}): ${xml.slice(0, 300)}`);
  }
  await writeFile(join(SALIDA, archivo), xml, "utf8");
  console.log(`${archivo} (${xml.length} bytes)`);
}

function sobre(operacion, params) {
  const campos = Object.entries(params)
    .map(([nombre, valor]) => `<${nombre}>${valor}</${nombre}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${operacion} xmlns="${NAMESPACE}">${campos}</${operacion}></soap:Body>` +
    `</soap:Envelope>`
  );
}

function restarDias(iso, dias) {
  const [year, month, day] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

function formato(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
