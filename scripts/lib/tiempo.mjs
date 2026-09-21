export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

// Acepta 'H:MM', 'HH:MM', 'HH:MM:SS' o fraccion de dia de Excel. Devuelve 'HH:MM' o null.
export function aHHMM(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const min = Math.round((v % 1) * 1440) % 1440;
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export function aMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Acepta 'dd/mm/yyyy' o serial de Excel. Devuelve 'YYYY-MM-DD' o null.
export function aISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function sumarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lunesDe(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return sumarDias(iso, -dow);
}
