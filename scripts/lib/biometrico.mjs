import XLSX from 'xlsx';
import path from 'node:path';
import { aHHMM, aISO } from './tiempo.mjs';

const RE_EMPLEADO = /Id del Empleado:\s*([^,]+),\s*Nombres:\s*([^,]+),\s*Departamento:\s*(.+)/i;

// El nombre del export trae la hora de generacion: "Tiempos trabajados_20260920113548_export.xlsx".
// Los turnos que empiezan despues de esa hora ese mismo dia todavia no pudieron marcarse.
export function corteDesdeNombre(nombreArchivo) {
  const m = path.basename(nombreArchivo).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return { fecha: `${m[1]}-${m[2]}-${m[3]}`, hora: `${m[4]}:${m[5]}` };
}

// Localiza las columnas por nombre. El export tiene dos columnas "Entrada" y dos "Salida":
// las primeras son el turno de la plantilla del sistema, las que siguen a "Work day" son la marcacion real.
function indices(cabecera) {
  const norm = cabecera.map((c) => String(c ?? '').trim().toLowerCase());
  const workDay = norm.indexOf('work day');
  if (workDay < 0) throw new Error('Formato de export no reconocido: falta la columna "Work day"');
  return {
    fecha: norm.indexOf('fecha'),
    entrada: norm.indexOf('entrada', workDay),
    salida: norm.indexOf('salida', workDay),
  };
}

export function parseBiometrico(rutaArchivo, nombreOriginal = rutaArchivo) {
  const wb = XLSX.readFile(rutaArchivo);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const empleados = {};
  let actual = null;
  let col = null;

  for (const fila of filas) {
    const a = fila[0];
    if (typeof a === 'string') {
      const m = a.match(RE_EMPLEADO);
      if (m) {
        const id = m[1].trim();
        actual = empleados[id] ??= { id, nombre: m[2].trim(), departamento: m[3].trim(), dias: {} };
        continue;
      }
      if (a.trim().toLowerCase() === 'nombre de empresa') {
        col = indices(fila);
        continue;
      }
    }
    if (!actual || !col) continue;
    const fecha = aISO(fila[col.fecha]);
    if (!fecha) continue;
    (actual.dias[fecha] ??= []).push({
      entrada: aHHMM(fila[col.entrada]),
      salida: aHHMM(fila[col.salida]),
    });
  }

  return { archivo: path.basename(nombreOriginal), corte: corteDesdeNombre(nombreOriginal), empleados };
}

// Combina varios exports. Si dos cubren el mismo dia, gana el mas reciente (el que tiene el corte mas tardio).
export function combinar(exports) {
  const orden = [...exports].sort((x, y) =>
    `${x.corte?.fecha ?? ''}${x.corte?.hora ?? ''}`.localeCompare(`${y.corte?.fecha ?? ''}${y.corte?.hora ?? ''}`));
  const empleados = {};
  for (const ex of orden) {
    for (const [id, e] of Object.entries(ex.empleados)) {
      const dst = empleados[id] ??= { id, nombre: e.nombre, departamento: e.departamento, dias: {} };
      Object.assign(dst.dias, e.dias);
    }
  }
  const ultimo = orden.at(-1);
  return { archivos: orden.map((e) => e.archivo), corte: ultimo?.corte ?? null, empleados };
}
