import XLSX from 'xlsx';
import path from 'node:path';

// Formato "Marcaciones": una fila por cada vez que alguien pone la huella.
// Columnas: ID del Empleado | Nombres | Hora de marcación | ...
// No distingue entrada de salida; eso lo decide compute.mjs por el orden de las marcas.

function normalizar(s) {
  return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Devuelve { fecha: 'YYYY-MM-DD', hora: 'HH:MM' }. Acepta serial de Excel o texto 'm/d/yy H:MM'.
function aMarca(v) {
  if (typeof v === 'number') {
    // Se truncan los segundos, igual que el biometrico al mostrar la hora (15:36:40 -> 15:36).
    const totalMin = Math.floor(v * 1440 + 1e-6);
    const dia = Math.floor(totalMin / 1440);
    const d = new Date(Date.UTC(1899, 11, 30) + dia * 86400000);
    return { fecha: d.toISOString().slice(0, 10), hora: `${String(Math.floor((totalMin % 1440) / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}` };
  }
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return { fecha: `${anio}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, hora: `${m[4].padStart(2, '0')}:${m[5]}` };
}

export function parseMarcaciones(rutaArchivo, nombreOriginal = rutaArchivo) {
  const wb = XLSX.readFile(rutaArchivo);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const iCab = filas.findIndex((f) => f.some((c) => normalizar(c) === 'hora de marcacion'));
  if (iCab < 0) throw new Error(`${path.basename(nombreOriginal)}: no tiene la columna "Hora de marcación"`);
  const cab = filas[iCab].map(normalizar);
  const col = {
    id: cab.indexOf('id del empleado'),
    nombre: cab.indexOf('nombres'),
    marca: cab.indexOf('hora de marcacion'),
  };

  const empleados = {};
  let ultima = null;
  for (const fila of filas.slice(iCab + 1)) {
    const id = fila[col.id];
    const m = aMarca(fila[col.marca]);
    if (id === null || id === undefined || !m) continue;
    const e = empleados[String(id)] ??= { id: String(id), nombre: String(fila[col.nombre] ?? '').trim(), dias: {} };
    (e.dias[m.fecha] ??= []).push(m.hora);
    const ts = `${m.fecha} ${m.hora}`;
    if (!ultima || ts > ultima) ultima = ts;
  }
  return {
    archivo: path.basename(nombreOriginal),
    // La ultima marca del archivo marca hasta donde hay datos: turnos posteriores todavia no pudieron marcarse.
    corte: ultima ? { fecha: ultima.slice(0, 10), hora: ultima.slice(11) } : null,
    empleados,
  };
}

// Une varios archivos. Las marcaciones se suman (sin duplicar): subir dos archivos que se solapan no pierde nada.
export function combinar(archivos) {
  const empleados = {};
  let corte = null;
  for (const a of archivos) {
    for (const [id, e] of Object.entries(a.empleados)) {
      const dst = empleados[id] ??= { id, nombre: e.nombre, dias: {} };
      for (const [fecha, marcas] of Object.entries(e.dias)) {
        dst.dias[fecha] = [...new Set([...(dst.dias[fecha] ?? []), ...marcas])].sort();
      }
    }
    if (a.corte && (!corte || `${a.corte.fecha} ${a.corte.hora}` > `${corte.fecha} ${corte.hora}`)) corte = a.corte;
  }
  return { archivos: archivos.map((a) => a.archivo), corte, empleados };
}
