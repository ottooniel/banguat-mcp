export type Agrupacion = "auto" | "diaria" | "semanal" | "mensual";
export type AgrupacionResuelta = Exclude<Agrupacion, "auto">;

export type PuntoValor = {
  fecha: string;
  valor: number;
  publicado_anticipado?: boolean;
  referencia?: "misma_fecha" | "fecha_anterior";
  fecha_referencia?: string;
};

export type PuntoAgregado = {
  fecha: string;
  cierre: number;
  min: number;
  max: number;
  publicado_anticipado: boolean;
  referencia?: "misma_fecha" | "fecha_anterior";
  fecha_referencia?: string;
};

export type ResumenSerie = {
  inicio: string;
  fin: string;
  valor_inicial: number;
  valor_final: number;
  variacion_pct: number;
  minimo: { fecha: string; valor: number };
  maximo: { fecha: string; valor: number };
  registros_originales: number;
};

export type SerieLista = {
  agrupacion: AgrupacionResuelta;
  resumen: ResumenSerie;
  serie: PuntoAgregado[];
};

const MAX_LINEAS = 70;

export function prepararSerie(puntos: PuntoValor[], pedido: Agrupacion = "auto"): SerieLista {
  const ordenados = [...puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (ordenados.length === 0) {
    throw new Error("No hay puntos para armar la serie.");
  }
  const agrupacion = resolverAgrupacion(ordenados, pedido);
  const grupos = new Map<string, PuntoValor[]>();
  for (const punto of ordenados) {
    const clave = clavePeriodo(punto.fecha, agrupacion);
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(punto);
    else grupos.set(clave, [punto]);
  }
  const serie = [...grupos.values()].map((grupo) => {
    const cierre = grupo[grupo.length - 1];
    const valores = grupo.map((punto) => punto.valor);
    if (!cierre) throw new Error("No hay puntos para armar la serie.");
    const agregado: PuntoAgregado = {
      fecha: cierre.fecha,
      cierre: cierre.valor,
      min: Math.min(...valores),
      max: Math.max(...valores),
      publicado_anticipado: grupo.some((punto) => punto.publicado_anticipado === true),
    };
    if (cierre.referencia && cierre.fecha_referencia) {
      agregado.referencia = cierre.referencia;
      agregado.fecha_referencia = cierre.fecha_referencia;
    }
    return agregado;
  });
  return { agrupacion, resumen: resumir(ordenados), serie };
}

export function resolverAgrupacion(puntos: PuntoValor[], pedido: Agrupacion): AgrupacionResuelta {
  switch (pedido) {
    case "diaria":
    case "semanal":
    case "mensual":
      return pedido;
    case "auto":
      if (puntos.length <= 62) return "diaria";
      if (diasEntre(puntos[0]?.fecha ?? "", puntos[puntos.length - 1]?.fecha ?? "") <= 366) return "semanal";
      return "mensual";
    default: {
      const nunca: never = pedido;
      return nunca;
    }
  }
}

export function resumir(puntos: PuntoValor[]): ResumenSerie {
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  if (!primero || !ultimo) throw new Error("No hay puntos para armar la serie.");
  let minimo = primero;
  let maximo = primero;
  for (const punto of puntos) {
    if (punto.valor < minimo.valor) minimo = punto;
    if (punto.valor > maximo.valor) maximo = punto;
  }
  const variacion = primero.valor === 0 ? 0 : ((ultimo.valor - primero.valor) / primero.valor) * 100;
  return {
    inicio: primero.fecha,
    fin: ultimo.fecha,
    valor_inicial: primero.valor,
    valor_final: ultimo.valor,
    variacion_pct: variacion,
    minimo: { fecha: minimo.fecha, valor: minimo.valor },
    maximo: { fecha: maximo.fecha, valor: maximo.valor },
    registros_originales: puntos.length,
  };
}

export function acotarLineas(lineas: string[], maximo = MAX_LINEAS): string {
  if (lineas.length <= maximo) return lineas.join("\n");
  const cuerpo = maximo - 1;
  const cabeza = Math.ceil(cuerpo / 2);
  const cola = cuerpo - cabeza;
  const omitidas = lineas.length - cuerpo;
  return [
    ...lineas.slice(0, cabeza),
    `… ${omitidas} líneas omitidas; la serie completa está en los datos estructurados.`,
    ...lineas.slice(lineas.length - cola),
  ].join("\n");
}

function clavePeriodo(fecha: string, modo: AgrupacionResuelta): string {
  switch (modo) {
    case "diaria":
      return fecha;
    case "mensual":
      return fecha.slice(0, 7);
    case "semanal":
      return inicioSemana(fecha);
    default: {
      const nunca: never = modo;
      return nunca;
    }
  }
}

function inicioSemana(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const dia = utc.getUTCDay();
  const hastaLunes = dia === 0 ? 6 : dia - 1;
  utc.setUTCDate(utc.getUTCDate() - hastaLunes);
  return utc.toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  const inicio = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((fin - inicio) / 86_400_000);
}
