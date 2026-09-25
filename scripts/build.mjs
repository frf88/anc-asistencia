// Uso:
//   npm run build        -> lee Drive: biometrico (BIOMETRICO_FOLDER_ID) + horarios (HORARIOS_FUENTES)
//
// Pruebas locales, sin Google:
//   node scripts/build.mjs --local Marcaciones.xlsx [otro.xlsx ...] --horarios omuh "HORARIOS OMUH.xlsx" "Prueba SEPTIEMBRE 2026"
//   --sin-biometrico en lugar de --local: solo carga horarios (todo sale s/d).
//
// HORARIOS_FUENTES (secret de GitHub, JSON):
//   [{"area":"omuh","fileId":"...","pestanas":["Prueba SEPTIEMBRE 2026"]}, {"area":"cocina",...}, {"area":"servicio",...}]
//
// Los logs de GitHub Actions son publicos en un repo publico: aqui no se imprimen nombres ni ids de archivos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarcaciones, combinar } from './lib/biometrico.mjs';
import { cargarHorarios } from './lib/horarios.mjs';
import { calcularSemana } from './lib/compute.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leerJSON = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));

// Valores que siguen a un flag, hasta el proximo flag.
function valores(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const fin = args.findIndex((a, k) => k > i && a.startsWith('--'));
  return args.slice(i + 1, fin < 0 ? undefined : fin);
}

async function authGoogle() {
  const { authDesdeEntorno } = await import('./lib/drive.mjs');
  return authDesdeEntorno();
}

async function obtenerExports(args, auth) {
  if (args.includes('--sin-biometrico')) return [];
  const locales = valores(args, '--local');
  if (locales) {
    if (!locales.length) throw new Error('--local necesita al menos un archivo .xlsx');
    return locales.map((r) => ({ ruta: r, nombre: path.basename(r) }));
  }
  const { listarExports, descargar } = await import('./lib/drive.mjs');
  const carpeta = process.env.BIOMETRICO_FOLDER_ID;
  if (!carpeta) throw new Error('Falta la variable BIOMETRICO_FOLDER_ID');
  const lista = await listarExports(auth, carpeta);
  if (!lista.length) throw new Error('La carpeta del biométrico está vacía o la cuenta de servicio no tiene acceso');
  const tmp = path.join(RAIZ, 'tmp');
  const archivos = [];
  for (const a of lista) archivos.push(await descargar(auth, a, tmp));
  return archivos;
}

function fuentesHorarios(args) {
  const loc = valores(args, '--horarios');
  if (loc) {
    const [area, ruta, ...pestanas] = loc;
    if (!area || !ruta) throw new Error('--horarios necesita: area ruta.xlsx [pestaña ...]');
    return [{ area, ruta, pestanas }];
  }
  const raw = process.env.HORARIOS_FUENTES;
  if (!raw) throw new Error('Falta HORARIOS_FUENTES');
  return JSON.parse(raw);
}

async function main() {
  const args = process.argv.slice(2);
  const empleados = leerJSON('config/empleados.json').empleados;
  const reglas = leerJSON('config/reglas.json');
  const fuente = process.env.HORARIOS_FUENTE ?? 'grilla';

  const bioLocal = args.includes('--sin-biometrico') || args.includes('--local');
  const horLocal = fuente === 'manual' || (fuente === 'grilla' && args.includes('--horarios'));
  const auth = bioLocal && horLocal ? null : await authGoogle();

  const archivos = await obtenerExports(args, auth);
  const bio = combinar(archivos.map((a) => parseMarcaciones(a.ruta, a.nombre)));
  console.log(`Biométrico: ${bio.archivos.length} archivo(s), ${Object.keys(bio.empleados).length} empleados, corte ${bio.corte?.fecha ?? '-'} ${bio.corte?.hora ?? ''}`);

  const hor = await cargarHorarios({
    fuente,
    auth,
    empleados,
    fuentes: fuente === 'grilla' ? fuentesHorarios(args) : null,
    rutaManual: path.join(RAIZ, 'config/horarios-manual.json'),
    sheetId: process.env.HORARIOS_SHEET_ID,
    sheetRango: process.env.HORARIOS_SHEET_RANGO ?? 'Horarios!A:C',
  });
  hor.avisos.forEach((a) => console.warn(`AVISO ${a}`));

  // La subarea (Servicio, Cocina, Limpieza, Produccion...) sale de la columna "Area" de la planilla.
  const emps = empleados.map((e) => ({ ...e, subarea: hor.subareas[e.id] ?? e.subarea }));

  const salida = path.join(RAIZ, 'docs/data/semanas');
  fs.mkdirSync(salida, { recursive: true });

  // Se publica toda semana con horario cargado, tenga o no marcas: sin marcas los dias salen s/d.
  const semanas = Object.keys(hor.semanas).sort();
  if (!semanas.length) console.warn('No se encontró ninguna semana en los horarios.');
  for (const semana of semanas) {
    const r = calcularSemana({ semana, empleados: emps, horarios: hor.semanas[semana], bio, reglas });
    fs.writeFileSync(path.join(salida, `${semana}.json`), JSON.stringify(r, null, 1));
    console.log(`  ${semana}: ${r.areas.map((a) => `${a.area} ${a.filas.length}`).join(', ') || 'sin áreas publicables'}`);
  }

  const existentes = fs.readdirSync(salida).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse();
  fs.writeFileSync(path.join(RAIZ, 'docs/data/index.json'), JSON.stringify({
    generado: new Date().toISOString(),
    archivos: bio.archivos.length,
    corte: bio.corte,
    tolerancia: reglas.toleranciaAtrasoMin,
    umbralPropinaBajoPct: reglas.umbralPropinaBajoPct,
    semanas: existentes,
  }, null, 1));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
