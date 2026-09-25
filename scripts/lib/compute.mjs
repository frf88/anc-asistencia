import { DIAS, aMin, sumarDias } from './tiempo.mjs';

const CUENTAN = new Set(['ok', 'tarde', 'sin_marcar']);
const RE_HORA = /^\d{2}:\d{2}$/;

function masCercano(opciones, marca) {
  const m = aMin(marca);
  return opciones.reduce((best, o) => (Math.abs(aMin(o) - m) < Math.abs(aMin(best) - m) ? o : best));
}

// Las marcas no dicen si son entrada o salida. Se descartan las de madrugada (salida del dia anterior)
// y del resto se toman como entradas la 1a, 3a, 5a... (entrada, salida, entrada, salida).
function separar(marcas, reglas) {
  const umbral = reglas.umbralSalidaMadrugadaHora * 60;
  const madrugada = marcas.filter((t) => aMin(t) < umbral);
  const resto = marcas.filter((t) => aMin(t) >= umbral).sort();
  return { madrugada, entradas: resto.filter((_, i) => i % 2 === 0) };
}

function evaluarDia({ prog, marcas, fecha, corte, reglas }) {
  const { madrugada, entradas } = separar(marcas, reglas);
  const notas = madrugada.length ? [`${madrugada[0]} es la salida del día anterior`] : [];

  if (prog === null || prog === undefined) return { tipo: 'na', notas };
  if (prog === 'LIBRE') {
    return entradas.length ? { tipo: 'libre_marco', marca: entradas[0], notas } : { tipo: 'libre', notas };
  }
  if (!RE_HORA.test(prog) && !prog.startsWith('VAR:')) {
    // BAJA, VACACIONES, COMPE, etc.: no es turno, no cuenta en el ratio.
    return { tipo: 'ausencia', etiqueta: prog.toLowerCase(), notas };
  }

  const opciones = prog.startsWith('VAR:') ? prog.slice(4).split('|') : null;
  const hora = opciones ? (entradas.length ? masCercano(opciones, entradas[0]) : null) : prog;

  // Sin biometrico, o despues del corte: todavia no se sabe si marco.
  if (!corte || fecha > corte.fecha || (fecha === corte.fecha && reglas.excluirTurnosPosterioresAlCorte
      && (hora === null || aMin(hora) > aMin(corte.hora)))) {
    return { tipo: 'sd', prog: hora, notas };
  }
  if (!entradas.length) return { tipo: 'sin_marcar', prog: hora, notas };

  const delta = aMin(entradas[0]) - aMin(hora);
  const extras = entradas.slice(1).map((t) => {
    const ref = opciones ? masCercano(opciones, t) : null;
    return { marca: t, delta: ref ? aMin(t) - aMin(ref) : null };
  });
  return {
    tipo: delta > reglas.toleranciaAtrasoMin ? 'tarde' : 'ok',
    prog: hora, marca: entradas[0], delta, extras, notas,
  };
}

// Iniciales para publicar sin nombres (el repo y la pagina son publicos).
// Se arman con el nombre del cuadro de horarios, unicas dentro de cada area; si dos coinciden
// se alarga la primera palabra (Je / Jo).
// Un campo "iniciales" en empleados.json manda sobre lo calculado.
export function asignarIniciales(empleados) {
  const palabras = (e) => String(e.nombre || e.biometrico).trim().split(/\s+/).filter(Boolean);
  const armar = (e, n) => {
    const [p, ...r] = palabras(e);
    return p.charAt(0).toUpperCase() + p.slice(1, n).toLowerCase() + r.map((w) => w[0].toUpperCase()).join('');
  };
  const res = {};
  const largo = Object.fromEntries(empleados.map((e) => [e.id, 1]));
  for (let vuelta = 0; vuelta < 8; vuelta += 1) {
    const grupos = {};
    for (const e of empleados) {
      res[e.id] = e.iniciales ?? armar(e, largo[e.id]);
      (grupos[`${e.area}|${res[e.id]}`] ??= []).push(e);
    }
    const choques = Object.values(grupos).filter((g) => g.length > 1 && g.some((e) => !e.iniciales));
    if (!choques.length) break;
    choques.flat().forEach((e) => { largo[e.id] += 1; });
  }
  return res;
}

export function calcularSemana({ semana, empleados, horarios, bio, reglas }) {
  const iniciales = asignarIniciales(empleados);
  const fechas = DIAS.map((_, i) => sumarDias(semana, i));
  const porArea = {};

  for (const emp of empleados) {
    const h = horarios[emp.id];
    if (!h) continue;
    const dias = bio.empleados[emp.id]?.dias ?? {};
    const celdas = DIAS.map((d, i) => ({
      fecha: fechas[i],
      ...evaluarDia({ prog: h[d], marcas: dias[fechas[i]] ?? [], fecha: fechas[i], corte: bio.corte, reglas }),
    }));

    // La marca de madrugada del dia i es la salida del dia i-1: se anota tambien en el dia anterior.
    celdas.forEach((c, i) => {
      if (i > 0 && c.notas.some((n) => n.includes('salida del día anterior'))) {
        celdas[i - 1].notas.push('salió pasada la medianoche');
      }
    });

    const cuentan = celdas.filter((c) => CUENTAN.has(c.tipo)
      && (reglas.contarDiaSinMarcarEnDenominador || c.tipo !== 'sin_marcar'));
    const num = cuentan.filter((c) => c.tipo === 'ok').length;
    const den = cuentan.length;

    (porArea[emp.area] ??= []).push({
      id: emp.id, nombre: iniciales[emp.id], subarea: emp.subarea ?? null,
      enBiometrico: emp.id in bio.empleados,
      celdas,
      ratio: { num, den, pct: den ? Math.round((num / den) * 100) : null },
    });
  }

  // Solo aparecen las areas que tienen planilla de horarios cargada para la semana.
  const areas = Object.entries(porArea)
    .filter(([, filas]) => filas.length)
    .map(([area, filas]) => ({
      area,
      titulo: reglas.areas[area]?.titulo ?? area,
      visibles: DIAS.map((_, i) => filas.some((f) => f.celdas[i].tipo !== 'na')),
      filas,
    }));

  return { semana, fechas, dias: DIAS, corte: bio.corte, areas };
}

export function semanasConDatos(horariosPorSemana, bio) {
  const fechasBio = new Set(Object.values(bio.empleados).flatMap((e) => Object.keys(e.dias)));
  return Object.keys(horariosPorSemana)
    .filter((s) => DIAS.some((_, i) => fechasBio.has(sumarDias(s, i))))
    .sort();
}
