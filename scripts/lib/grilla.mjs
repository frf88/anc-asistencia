import XLSX from 'xlsx';
import { DIAS, aHHMM, aISO, lunesDe, sumarDias } from './tiempo.mjs';

// Lee la planilla de horarios en formato grilla (una por area: omuH, Ancestral Cocina, Ancestral Servicio).
//
//   B1:  HORARIOS OMUH - SEMANA 28/09/2026 AL 04/10/2026      <- titulo: fija la semana del bloque
//   2:   Area | Empleado | FUNCIÓN | LUNES 28 | MARTES 29 | ... | DOMINGO 04   <- cabecera
//   3+:  Servicio | Silvana | Caja/Despacho | 11:00 - 20:30 | LIBRE | ...
//
// Una pestaña puede tener varias semanas apiladas: cada titulo "SEMANA dd/mm/aaaa" abre un bloque nuevo.
// Celdas: "HH:MM - HH:MM" = turno (cuenta la entrada) | "LIBRE" | vacia = sin turno | otro texto = ausencia (BAJA, VACACIONES...).
// Columnas fuera de LUNES..DOMINGO (p. ej. la lista auxiliar "Horarios") se ignoran.

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const CAB_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const RE_SEMANA = /semana\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
const RE_TURNO = /^(\d{1,2}:\d{2})\s*(?:-|–|a)\s*(\d{1,2}:\d{2})$/i;

function valorCelda(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return aHHMM(v);
  const t = String(v).trim();
  const m = t.match(RE_TURNO);
  if (m) return aHHMM(m[1]);
  if (/^\d{1,2}:\d{2}$/.test(t)) return aHHMM(t);
  if (norm(t) === 'libre') return 'LIBRE';
  return t.toUpperCase();
}

// Nombre de la planilla -> id del biometrico, solo entre los empleados de esa area.
function indexarEmpleados(empleados, area) {
  const idx = new Map();
  for (const e of empleados.filter((x) => x.area === area)) {
    for (const n of [e.nombre, e.biometrico, ...(e.alias ?? [])]) {
      if (!n) continue;
      const k = norm(n);
      if (idx.has(k) && idx.get(k) !== e.id) idx.set(k, null); // ambiguo
      else idx.set(k, e.id);
    }
  }
  return idx;
}

export function leerGrilla({ buffer, pestanas, area, empleados, etiqueta = area }) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const hojas = pestanas?.length ? pestanas : wb.SheetNames;
  const faltan = hojas.filter((h) => !wb.Sheets[h]);
  if (faltan.length) throw new Error(`${etiqueta}: no existe la pestaña ${faltan.map((h) => `"${h}"`).join(', ')}`);

  const idx = indexarEmpleados(empleados, area);
  const semanas = {};
  const subareas = {};
  const avisos = [];

  for (const hoja of hojas) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: null });
    let semana = null;
    let col = null;

    filas.forEach((fila, i) => {
      const nFila = i + 1;
      const titulo = fila.map((c) => String(c ?? '')).find((c) => RE_SEMANA.test(c));
      if (titulo) {
        const f = aISO(titulo.match(RE_SEMANA)[1]);
        semana = lunesDe(f);
        if (semana !== f) avisos.push(`${hoja} fila ${nFila}: la semana empieza ${f}, no es lunes; se usa ${semana}`);
        col = null;
        return;
      }
      const cab = fila.map(norm);
      const iEmp = cab.indexOf('empleado');
      if (iEmp >= 0) {
        const dias = CAB_DIAS.map((d) => cab.findIndex((c) => c.startsWith(d)));
        if (dias.some((d) => d < 0)) { avisos.push(`${hoja} fila ${nFila}: cabecera sin los 7 días`); col = null; return; }
        col = { emp: iEmp, area: cab.indexOf('area'), dias };
        if (semana) {
          // El numero del encabezado ("LUNES 28") tiene que coincidir con la fecha del titulo.
          col.dias.forEach((c, d) => {
            const num = String(fila[c] ?? '').match(/(\d{1,2})\s*$/)?.[1];
            if (num && Number(num) !== Number(sumarDias(semana, d).slice(8))) {
              avisos.push(`${hoja} fila ${nFila}: "${String(fila[c]).trim()}" no coincide con la semana ${semana}`);
            }
          });
        }
        return;
      }
      if (!col) return;
      const nombre = String(fila[col.emp] ?? '').trim();
      if (!nombre) return;
      if (!semana) { avisos.push(`${hoja} fila ${nFila}: hay empleados antes del título "SEMANA dd/mm/aaaa"`); return; }

      const id = idx.get(norm(nombre));
      if (id === undefined) { avisos.push(`${hoja} fila ${nFila}: empleado sin id del biométrico (agregar en empleados.json)`); return; }
      if (id === null) { avisos.push(`${hoja} fila ${nFila}: el nombre coincide con más de un empleado`); return; }

      const dst = ((semanas[semana] ??= {})[id] = {});
      DIAS.forEach((d, k) => { dst[d] = valorCelda(fila[col.dias[k]]); });
      if (col.area >= 0 && fila[col.area]) subareas[id] = String(fila[col.area]).trim();
    });
  }
  return { semanas, subareas, avisos };
}
