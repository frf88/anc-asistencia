import { DIAS, aMin, sumarDias } from './tiempo.mjs';

const CUENTAN = new Set(['ok', 'tarde', 'sin_marcar']);

function masCercano(opciones, marca) {
  const m = aMin(marca);
  return opciones.reduce((best, o) => (Math.abs(aMin(o) - m) < Math.abs(aMin(best) - m) ? o : best));
}

function evaluarDia({ prog, registros, fecha, corte, reglas }) {
  const umbral = reglas.umbralSalidaMadrugadaHora * 60;
  const marcas = registros.map((r) => r.entrada).filter(Boolean);
  const madrugada = marcas.filter((t) => aMin(t) < umbral);
  const entradas = marcas.filter((t) => aMin(t) >= umbral).sort();
  const notas = [];
  if (madrugada.length) notas.push(`${madrugada[0]} es la salida del día anterior`);

  if (prog === null || prog === undefined) return { tipo: 'na' };
  if (prog === 'LIBRE') {
    return entradas.length ? { tipo: 'libre_marco', marca: entradas[0], notas } : { tipo: 'libre' };
  }

  const opciones = prog.startsWith('VAR:') ? prog.slice(4).split('|') : null;
  const hora = opciones ? (entradas.length ? masCercano(opciones, entradas[0]) : null) : prog;

  if (corte && (fecha > corte.fecha || (fecha === corte.fecha && reglas.excluirTurnosPosterioresAlCorte
      && (hora === null || aMin(hora) > aMin(corte.hora))))) {
    return { tipo: 'sd', prog: hora };
  }

  if (!registros.length) notas.push('sin registro en el biométrico ese día');
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

export function calcularSemana({ semana, empleados, horarios, bio, reglas }) {
  const fechas = DIAS.map((_, i) => sumarDias(semana, i));
  const porArea = {};

  for (const emp of empleados) {
    const h = horarios[emp.id];
    if (!h) continue;
    const dias = bio.empleados[emp.id]?.dias ?? {};
    const celdas = DIAS.map((d, i) => ({
      fecha: fechas[i],
      ...evaluarDia({ prog: h[d], registros: dias[fechas[i]] ?? [], fecha: fechas[i], corte: bio.corte, reglas }),
    }));

    // La marca de madrugada del dia i es la salida del dia i-1: se anota en ambos.
    celdas.forEach((c, i) => {
      if (i > 0 && c.notas?.some((n) => n.includes('salida del día anterior'))) {
        const prev = celdas[i - 1];
        (prev.notas ??= []).push('salió pasada la medianoche');
      }
    });

    const cuentan = celdas.filter((c) => CUENTAN.has(c.tipo)
      && (reglas.contarDiaSinMarcarEnDenominador || c.tipo !== 'sin_marcar'));
    const num = cuentan.filter((c) => c.tipo === 'ok').length;
    const den = cuentan.length;

    (porArea[emp.area] ??= []).push({
      id: emp.id, nombre: emp.nombre, subarea: emp.subarea ?? null, celdas,
      ratio: { num, den, pct: den ? Math.round((num / den) * 100) : null },
    });
  }

  const areas = Object.entries(porArea).map(([area, filas]) => ({
    area,
    titulo: reglas.areas[area]?.titulo ?? area,
    visibles: DIAS.map((_, i) => filas.some((f) => f.celdas[i].tipo !== 'na')),
    filas,
  }));

  return { semana, fechas, dias: DIAS, corte: bio.corte, areas };
}

// Semanas del horario que tienen al menos un dia cubierto por el biometrico.
export function semanasConDatos(horariosPorSemana, bio) {
  const fechasBio = new Set(Object.values(bio.empleados).flatMap((e) => Object.keys(e.dias)));
  return Object.keys(horariosPorSemana)
    .filter((s) => DIAS.some((_, i) => fechasBio.has(sumarDias(s, i))))
    .sort();
}
