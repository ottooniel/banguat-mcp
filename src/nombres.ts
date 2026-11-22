const SINGULARES: Record<number, string> = {
  1: "quetzal",
  2: "dólar de EE.UU.",
  3: "yen japonés",
  4: "franco belga",
  5: "franco suizo",
  6: "franco francés",
  7: "dólar canadiense",
  8: "lira italiana",
  9: "libra esterlina",
  11: "marco alemán",
  12: "peseta española",
  13: "chelín austríaco",
  14: "florín holandés",
  15: "corona sueca",
  16: "colón costarricense",
  17: "colón salvadoreño",
  18: "peso mexicano",
  19: "lempira hondureño",
  21: "córdoba nicaragüense",
  22: "bolívar venezolano",
  23: "corona danesa",
  24: "euro",
  25: "corona noruega",
  26: "DEG",
  27: "escudo portugués",
  28: "unidad de cuenta del BID",
  29: "peso argentino",
  30: "real brasileño",
  31: "won coreano",
  32: "dólar de Hong Kong",
  33: "dólar de Taiwán",
  34: "yuan chino",
  35: "rupia pakistaní",
  36: "rupia india",
  37: "bolívar fuerte",
  38: "peso colombiano",
  39: "peso dominicano",
  40: "ringgit malasio",
  41: "bolívar soberano",
  42: "zloty",
};

export function nombreSingular(codigo: number, respaldo: string): string {
  return SINGULARES[codigo] ?? respaldo.toLowerCase();
}

export function codigosConNombre(): number[] {
  return Object.keys(SINGULARES).map(Number);
}
