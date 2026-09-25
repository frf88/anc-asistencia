import XLSX from 'xlsx';
import path from 'node:path';

// Lee los dos reportes del biometrico y los deja en la misma forma:
//   empleados[id].dias['YYYY-MM-DD'] = { marcas: ['10:00','23:26'], entradas: ['10:00'] | null }
//
// "Marcaciones": una fila por huella. No dice cual es entrada y cual salida -> entradas: null,
//   lo resuelve compute.mjs por el orden de las marcas.
// "Tiempos trabajados": una fila por turno, con columnas Entrada y Salida ya separadas -> entradas explicitas.
//   Solo guarda la primera y la ultima marca del dia: si alguien sale pasada la medianoche, esa salida
//   ocupa el lugar de la entrada y la entrada real se pierde.

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const RE_EMPLEADO = /Id del Empleado:\s*([^,]+),\s*Nombres:\s*([^,]+)(?:,\s*Departamento:\s*(.+))?/i;

function hhmm(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const min = Math.floor((v % 1) * 1440 + 1e-6);
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m && m[0] !== '00:00' ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function iso(v) {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function fechaHora(v) {
  if (typeof v === 'number') {
    const total = Math.floor(v * 1440 + 1e-6);
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(total / 1440) * 86400000);
    const min = total % 1440;
    return { fecha: d.toISOString().slice(0, 10), hora: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` };
  }
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return { fecha: `${a}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, hora: `${m[4].padStart(2, '0')}:${m[5]}` };
}

const agregar = (emp, fecha) => (emp.dias[fecha] ??= { marcas: [], entradas: null });

function hojas(wb) {
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }));
}

function esMarcaciones(filas) {
  return filas.some((f) => f.some((c) => norm(c) === 'hora de marcacion'));
}

function leerMarcaciones(filas, empleados) {
  const iCab = filas.findIndex((f) => f.some((c) => norm(c) === 'hora de marcacion'));
  const cab = filas[iCab].map(norm);
  const col = { id: cab.indexOf('id del empleado'), nombre: cab.indexOf('nombres'), marca: cab.indexOf('hora de marcacion') };
  for (const f of filas.slice(iCab + 1)) {
    const id = f[col.id];
    const m = fechaHora(f[col.marca]);
    if (id === null || id === undefined || !m) continue;
    const e = empleados[String(id)] ??= { id: String(id), nombre: String(f[col.nombre] ?? '').trim(), dias: {} };
    agregar(e, m.fecha).marcas.push(m.hora);
  }
}

function leerTiempos(filas, empleados) {
  let emp = null;
  let col = null;
  for (const f of filas) {
    const a = f[0];
    if (typeof a === 'string') {
      const m = a.match(RE_EMPLEADO);
      if (m) {
        const id = m[1].trim();
        emp = empleados[id] ??= { id, nombre: m[2].trim(), dias: {} };
        continue;
      }
      if (norm(a) === 'nombre de empresa') {
        const cab = f.map(norm);
        const wd = cab.indexOf('work day');
        col = { fecha: cab.indexOf('fecha'), entrada: cab.indexOf('entrada', wd), salida: cab.indexOf('salida', wd) };
        continue;
      }
    }
    if (!emp || !col) continue;
    const fecha = iso(f[col.fecha]);
    if (!fecha) continue;
    const d = agregar(emp, fecha);
    d.entradas ??= [];
    const ent = hhmm(f[col.entrada]);
    const sal = hhmm(f[col.salida]);
    if (ent) { d.entradas.push(ent); d.marcas.push(ent); }
    if (sal) d.marcas.push(sal);
  }
}

export function parseBiometrico(rutaArchivo, nombreOriginal = rutaArchivo) {
  const empleados = {};
  let formato = null;
  for (const filas of hojas(XLSX.readFile(rutaArchivo))) {
    if (esMarcaciones(filas)) { leerMarcaciones(filas, empleados); formato ??= 'marcaciones'; }
    else { leerTiempos(filas, empleados); formato ??= 'tiempos'; }
  }
  if (!Object.keys(empleados).length) {
    throw new Error(`${path.basename(nombreOriginal)}: no se reconoce el formato (ni "Marcaciones" ni "Tiempos trabajados")`);
  }
  let ultima = null;
  for (const e of Object.values(empleados)) {
    for (const [fecha, d] of Object.entries(e.dias)) {
      d.marcas = [...new Set(d.marcas)].sort();
      if (d.entradas) d.entradas = [...new Set(d.entradas)].sort();
      const t = `${fecha} ${d.marcas.at(-1) ?? '00:00'}`;
      if (d.marcas.length && (!ultima || t > ultima)) ultima = t;
    }
  }
  // El nombre del export trae la hora de generacion; si no, se usa la ultima marca.
  const m = path.basename(nombreOriginal).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const corte = m
    ? { fecha: `${m[1]}-${m[2]}-${m[3]}`, hora: `${m[4]}:${m[5]}` }
    : (ultima ? { fecha: ultima.slice(0, 10), hora: ultima.slice(11) } : null);
  return { archivo: path.basename(nombreOriginal), formato, corte, empleados };
}

export const parseMarcaciones = parseBiometrico;

// Une varios archivos: las marcas se suman sin duplicar, asi que solaparse no pierde nada.
export function combinar(archivos) {
  const empleados = {};
  let corte = null;
  for (const a of archivos) {
    for (const [id, e] of Object.entries(a.empleados)) {
      const dst = empleados[id] ??= { id, nombre: e.nombre, dias: {} };
      for (const [fecha, d] of Object.entries(e.dias)) {
        const cur = dst.dias[fecha] ??= { marcas: [], entradas: null };
        cur.marcas = [...new Set([...cur.marcas, ...d.marcas])].sort();
        if (d.entradas) cur.entradas = [...new Set([...(cur.entradas ?? []), ...d.entradas])].sort();
      }
    }
    if (a.corte && (!corte || `${a.corte.fecha} ${a.corte.hora}` > `${corte.fecha} ${corte.hora}`)) corte = a.corte;
  }
  return {
    archivos: archivos.map((a) => a.archivo),
    formatos: [...new Set(archivos.map((a) => a.formato))],
    corte,
    empleados,
  };
}
