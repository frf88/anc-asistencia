import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export function authDesdeEntorno() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta la variable GOOGLE_SERVICE_ACCOUNT_JSON');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

// Lista los exports del biometrico en la carpeta. Acepta .xlsx y tambien Google Sheets,
// por si Drive convierte el archivo al subirlo.
export async function listarExports(auth, carpetaId) {
  const drive = google.drive({ version: 'v3', auth });
  const { data } = await drive.files.list({
    q: `'${carpetaId}' in parents and trashed = false and (mimeType = '${XLSX_MIME}' or mimeType = '${GSHEET_MIME}')`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files ?? [];
}

export async function descargar(auth, archivo, carpetaDestino) {
  const drive = google.drive({ version: 'v3', auth });
  fs.mkdirSync(carpetaDestino, { recursive: true });
  const nombre = archivo.name.endsWith('.xlsx') ? archivo.name : `${archivo.name}.xlsx`;
  const destino = path.join(carpetaDestino, nombre);
  const res = archivo.mimeType === GSHEET_MIME
    ? await drive.files.export({ fileId: archivo.id, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' })
    : await drive.files.get({ fileId: archivo.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  fs.writeFileSync(destino, Buffer.from(res.data));
  return { ruta: destino, nombre };
}

// Baja un archivo (xlsx subido a Drive o Google Sheet nativo) como buffer xlsx.
export async function descargarBuffer(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const { data: meta } = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
  const res = meta.mimeType === GSHEET_MIME
    ? await drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' })
    : await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

export async function leerRango(auth, spreadsheetId, rango) {
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: rango });
  return data.values ?? [];
}
