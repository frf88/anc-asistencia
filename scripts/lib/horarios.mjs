import fs from 'node:fs';
import { DIAS, aHHMM, aISO, lunesDe } from './tiempo.mjs';
import { leerGrilla } from './grilla.mjs';

// Fuente 'grilla' (la activa): una planilla por area en formato grilla, ver grilla.mjs.
// Cada fuente: { area, fileId | ruta, pestanas: [...] }. fileId = Drive, ruta = archivo local (pruebas).
async function desdeGrillas({ auth, fuentes, empleados }) {
  const semanas = {};
  const subareas = {};
  const avisos = [];
  for (const f of fuentes) {
    let buffer;
    if (f.ruta) buffer = fs.readFileSync(f.ruta);
    else {
      const { descargarBuffer } = await import('./drive.mjs');
      buffer = await descargarBuffer(auth, f.fileId);
    }
    const r = leerGrilla({ buffer, pestanas: f.pestanas, area: f.area, empleados, etiqueta: f.area });
    for (const [s, porId] of Object.entries(r.semanas)) Object.assign((semanas[s] ??= {}), porId);
    Object.assign(subareas, r.subareas);
    avisos.push(...r.avisos.map((a) => `[${f.area}] ${a}`));
  }
  return { semanas, subareas, avisos };
}

// Fuente 'manual': config/horarios-manual.json (se usó para la semana del 14/09).
function desdeManual(ruta) {
  return { semanas: JSON.parse(fs.readFileSync(ruta, 'utf8')).semanas, subareas: {}, avisos: [] };
}

// Fuente 'sheet': pestaña con columnas  ID | Fecha | Entrada  (una fila por persona y dia). Alternativa, no activa.
async function desdeSheet(auth, spreadsheetId, rango) {
  const { leerRango } = await import('./drive.mjs');
  const filas = await leerRango(auth, spreadsheetId, rango);
  const semanas = {};
  for (const [id, fechaTxt, entradaTxt] of filas.slice(1)) {
    const fecha = aISO(fechaTxt);
    if (!id || !fecha) continue;
    const valor = String(entradaTxt ?? '').trim().toUpperCase();
    const entrada = valor === 'LIBRE' ? 'LIBRE'
      : valor.startsWith('VAR:') ? valor
        : aHHMM(valor);
    const semana = lunesDe(fecha);
    const dia = DIAS[(new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7];
    ((semanas[semana] ??= {})[String(id).trim()] ??= Object.fromEntries(DIAS.map((d) => [d, null])))[dia] = entrada;
  }
  return { semanas, subareas: {}, avisos: [] };
}

export async function cargarHorarios({ fuente, auth, rutaManual, sheetId, sheetRango, fuentes, empleados }) {
  if (fuente === 'grilla') return desdeGrillas({ auth, fuentes, empleados });
  if (fuente === 'sheet') return desdeSheet(auth, sheetId, sheetRango);
  return desdeManual(rutaManual);
}
