import fs from 'node:fs';
import { DIAS, aHHMM, aISO, lunesDe } from './tiempo.mjs';
import { leerRango } from './drive.mjs';

// Fuente 'manual': config/horarios-manual.json. Es la activa mientras se define el formato del Sheet.
function desdeManual(ruta) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8')).semanas;
}

// Fuente 'sheet': pestaña con columnas  ID | Fecha | Entrada  (una fila por persona y dia).
// Entrada acepta HH:MM, LIBRE, o VAR:10:30|15:00|18:30. Propuesta de formato, no activa todavia.
async function desdeSheet(auth, spreadsheetId, rango) {
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
  return semanas;
}

export async function cargarHorarios({ fuente, auth, rutaManual, sheetId, sheetRango }) {
  if (fuente === 'sheet') return desdeSheet(auth, sheetId, sheetRango);
  return desdeManual(rutaManual);
}
