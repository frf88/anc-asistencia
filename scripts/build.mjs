// Uso:
//   npm run build                         -> lee el Drive (necesita GOOGLE_SERVICE_ACCOUNT_JSON y BIOMETRICO_FOLDER_ID)
//   node scripts/build.mjs --local a.xlsx -> usa archivos locales, sin Google
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBiometrico, combinar } from './lib/biometrico.mjs';
import { cargarHorarios } from './lib/horarios.mjs';
import { calcularSemana, semanasConDatos } from './lib/compute.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leerJSON = (p) => JSON.parse(fs.readFileSync(path.join(RAIZ, p), 'utf8'));

async function obtenerExports(args) {
  const i = args.indexOf('--local');
  if (i >= 0) {
    const rutas = args.slice(i + 1);
    if (!rutas.length) throw new Error('--local necesita al menos un archivo .xlsx');
    return { auth: null, archivos: rutas.map((r) => ({ ruta: r, nombre: path.basename(r) })) };
  }
  const { authDesdeEntorno, listarExports, descargar } = await import('./lib/drive.mjs');
  const carpeta = process.env.BIOMETRICO_FOLDER_ID;
  if (!carpeta) throw new Error('Falta la variable BIOMETRICO_FOLDER_ID');
  const auth = authDesdeEntorno();
  const lista = await listarExports(auth, carpeta);
  if (!lista.length) throw new Error('La carpeta del biométrico está vacía o la cuenta de servicio no tiene acceso');
  const tmp = path.join(RAIZ, 'tmp');
  const archivos = [];
  for (const a of lista) archivos.push(await descargar(auth, a, tmp));
  return { auth, archivos };
}

async function main() {
  const args = process.argv.slice(2);
  const empleados = leerJSON('config/empleados.json').empleados;
  const reglas = leerJSON('config/reglas.json');

  const { auth, archivos } = await obtenerExports(args);
  const bio = combinar(archivos.map((a) => parseBiometrico(a.ruta, a.nombre)));
  console.log(`Biométrico: ${bio.archivos.length} archivo(s), ${Object.keys(bio.empleados).length} empleados, corte ${bio.corte?.fecha} ${bio.corte?.hora}`);

  const horariosPorSemana = await cargarHorarios({
    fuente: process.env.HORARIOS_FUENTE ?? 'manual',
    auth,
    rutaManual: path.join(RAIZ, 'config/horarios-manual.json'),
    sheetId: process.env.HORARIOS_SHEET_ID,
    sheetRango: process.env.HORARIOS_SHEET_RANGO ?? 'Horarios!A:C',
  });

  const salida = path.join(RAIZ, 'docs/data/semanas');
  fs.mkdirSync(salida, { recursive: true });

  const semanas = semanasConDatos(horariosPorSemana, bio);
  if (!semanas.length) console.warn('Ninguna semana del horario coincide con las fechas del biométrico.');
  for (const semana of semanas) {
    const r = calcularSemana({ semana, empleados, horarios: horariosPorSemana[semana], bio, reglas });
    fs.writeFileSync(path.join(salida, `${semana}.json`), JSON.stringify(r, null, 1));
    console.log(`  ${semana}: ${r.areas.map((a) => `${a.area} ${a.filas.length}`).join(', ')}`);
  }

  const existentes = fs.readdirSync(salida).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse();
  fs.writeFileSync(path.join(RAIZ, 'docs/data/index.json'), JSON.stringify({
    generado: new Date().toISOString(),
    archivos: bio.archivos,
    corte: bio.corte,
    tolerancia: reglas.toleranciaAtrasoMin,
    umbralPropinaBajoPct: reglas.umbralPropinaBajoPct,
    semanas: existentes,
  }, null, 1));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
