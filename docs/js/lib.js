/* Utilidades, lectura de CSV de Google Sheets, lectura del export del biometrico
   y el calculo de la matriz. Todo corre en el navegador. */
(function (W) {
  'use strict';

  /* ---------- texto, horas, fechas ---------- */

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

  const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  const DIAS_LARGO = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const aMin = (t) => {
    const p = String(t).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  };
  const deMin = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

  function sumarDias(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function lunesDe(iso) {
    const dow = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
    return sumarDias(iso, -dow);
  }

  /* ---------- CSV (admite comillas y saltos de linea dentro de la celda) ---------- */

  function parseCSV(txt) {
    const filas = [];
    let fila = [];
    let cel = '';
    let enComillas = false;
    const s = String(txt).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (enComillas) {
        if (c === '"') {
          if (s[i + 1] === '"') { cel += '"'; i += 1; } else enComillas = false;
        } else cel += c;
      } else if (c === '"') enComillas = true;
      else if (c === ',') { fila.push(cel); cel = ''; }
      else if (c === '\n') { fila.push(cel); filas.push(fila); fila = []; cel = ''; }
      else cel += c;
    }
    if (cel !== '' || fila.length) { fila.push(cel); filas.push(fila); }
    return filas;
  }

  const urlCSV = (sheetId, pestana) => 'https://docs.google.com/spreadsheets/d/' + sheetId
    + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(pestana);

  async function bajarCSV(sheetId, pestana) {
    const r = await fetch(urlCSV(sheetId, pestana), { cache: 'no-store' });
    if (!r.ok) throw new Error('la pestaña "' + pestana + '" devolvió HTTP ' + r.status);
    const txt = await r.text();
    if (/^\s*</.test(txt)) throw new Error('la pestaña "' + pestana + '" no existe, o la planilla no está compartida');
    return parseCSV(txt);
  }

  /* ---------- una celda de la planilla de horarios ---------- */

  const NO_TRABAJA = ['libre', 'descanso', 'franco'];

  // Devuelve uno de:
  //   { tipo:'turno', entrada:'HH:MM', salida:'HH:MM'|null, cortado:bool }
  //   { tipo:'libre' } | { tipo:'ausencia', etiqueta:'...' } | { tipo:'vacio' }
  function celdaTurno(txt, cierre) {
    const t = String(txt == null ? '' : txt).trim();
    if (!t) return { tipo: 'vacio' };
    const n = norm(t);
    if (NO_TRABAJA.indexOf(n) >= 0) return { tipo: 'libre' };

    const re = /(\d{1,2})[:;.](\d{2})/g;
    const horas = [];
    let m = re.exec(t);
    while (m !== null) {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h <= 23 && mi <= 59) horas.push(deMin(h * 60 + mi));
      m = re.exec(t);
    }
    if (!horas.length) {
      if (NO_TRABAJA.some((k) => n.indexOf(k) >= 0)) return { tipo: 'libre' };
      return { tipo: 'ausencia', etiqueta: t.replace(/\s+/g, ' ') };
    }

    const cortado = n.indexOf('cortad') >= 0;
    const entrada = horas[0];
    let salida = null;
    let corregida = false;
    if (cortado) salida = cierre;                       // 10:30-16:00 / 18:30-Cierre
    else if (horas.length > 1) {
      salida = horas[horas.length - 1];
      // En la planilla de Servicio el cierre esta escrito en formato de 12 horas:
      // "15:00 - 11:00" o "10:30 - 11:00" quieren decir 23:00. Si el turno sale
      // negativo o dura menos de dos horas, la salida es de la tarde.
      if (aMin(salida) - aMin(entrada) < 120 && aMin(salida) + 720 <= 1439) {
        salida = deMin(aMin(salida) + 720);
        corregida = true;
      }
    } else if (n.indexOf('cierre') >= 0) salida = cierre;
    return { tipo: 'turno', entrada, salida, cortado, corregida };
  }

  /* ---------- bloques semanales: omuH ---------- */

  const RE_SEM_OMUH = /semana\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

  function bloquesOmuh(filas, cierre) {
    const bloques = [];
    let actual = null;
    let col = null;
    filas.forEach((f, i) => {
      const titulo = f.filter((c) => RE_SEM_OMUH.test(String(c == null ? '' : c)))[0];
      if (titulo) {
        const m = String(titulo).match(RE_SEM_OMUH);
        const iso = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
        actual = { iso, lunes: lunesDe(iso), texto: String(titulo).trim(), linea: i + 1, filas: [] };
        bloques.push(actual);
        col = null;
        return;
      }
      const cab = f.map(norm);
      const iEmp = cab.indexOf('empleado');
      if (iEmp >= 0) {
        const dias = DIAS_LARGO.map((d) => {
          for (let k = 0; k < cab.length; k += 1) if (cab[k].indexOf(d.slice(0, 5)) === 0) return k;
          return -1;
        });
        col = dias.every((d) => d >= 0) ? { emp: iEmp, area: cab.indexOf('area'), dias } : null;
        return;
      }
      if (!actual || !col) return;
      const nombre = String(f[col.emp] == null ? '' : f[col.emp]).trim();
      if (!nombre) return;
      actual.filas.push({
        nombre,
        subarea: col.area >= 0 ? String(f[col.area] == null ? '' : f[col.area]).trim() : '',
        celdas: col.dias.map((c) => celdaTurno(f[c], cierre)),
      });
    });
    return bloques;
  }

  /* ---------- bloques semanales: Ancestral (Servicio y Cocina) ---------- */

  // El titulo trae el dia y el mes de inicio. El anio solo a veces.
  function tituloAncestral(f) {
    const celdas = f.map((c) => String(c == null ? '' : c).trim()).filter((c) => c !== '');
    if (!celdas.length) return null;
    const txt = celdas[0];
    if (!/\d/.test(txt) || !/[-–]/.test(txt)) return null;
    const n = norm(txt);
    let mes = -1;
    for (let i = 0; i < MESES.length; i += 1) if (n.indexOf(MESES[i]) >= 0) { mes = i; break; }
    if (mes < 0) return null;
    const md = n.match(/\d{1,2}/);
    const dia = md ? Number(md[0]) : 0;
    if (!dia || dia > 31) return null;
    const ma = n.match(/\b(20\d{2})\b/);
    return { texto: txt, dia, mes: mes + 1, anio: ma ? Number(ma[1]) : null };
  }

  const NO_EMPLEADO = ['total personal', 'total', 'personal', 'servicio', 'bar', 'cocina', 'eventos'];

  function bloquesAncestral(filas, cierre) {
    const bloques = [];
    let actual = null;
    let col = null;
    filas.forEach((f, i) => {
      const cab = f.map(norm);

      // Cabecera: los 7 dias en columnas seguidas. Se usa la primera aparicion, porque
      // a la derecha la planilla repite la grilla para las tareas (REJAS, JUGO, BANOS).
      let iLun = -1;
      for (let k = 1; k < cab.length; k += 1) {
        if (cab[k] !== 'lunes') continue;
        let ok = true;
        for (let j = 0; j < 7; j += 1) {
          const c = cab[k + j] || '';
          if (c.indexOf(DIAS_LARGO[j].slice(0, 5)) !== 0) { ok = false; break; }
        }
        if (ok) { iLun = k; break; }
      }
      if (iLun > 0) {
        col = { nombre: iLun - 1, dias: [0, 1, 2, 3, 4, 5, 6].map((j) => iLun + j) };
        if (actual) actual.subarea = String(f[iLun - 1] == null ? '' : f[iLun - 1]).trim();
        return;
      }

      const t = tituloAncestral(f);
      if (t) {
        actual = { texto: t.texto, dia: t.dia, mes: t.mes, anio: t.anio, linea: i + 1, filas: [] };
        bloques.push(actual);
        col = null;
        return;
      }
      if (!actual || !col) return;
      const nombre = String(f[col.nombre] == null ? '' : f[col.nombre]).trim();
      if (!nombre || NO_EMPLEADO.indexOf(norm(nombre)) >= 0) return;
      actual.filas.push({
        nombre,
        subarea: actual.subarea || '',
        celdas: col.dias.map((c) => celdaTurno(f[c], cierre)),
      });
    });
    return bloques;
  }

  // Elige los bloques del lunes pedido. Puede devolver mas de uno: la planilla
  // a veces tiene la misma semana cargada dos veces, con contenido distinto.
  function elegirBloques(bloques, lunes, formato) {
    if (formato === 'omuh') return bloques.filter((b) => b.lunes === lunes);
    const p = lunes.split('-').map(Number);
    return bloques.filter((b) => b.dia === p[2] && b.mes === p[1] && (b.anio === null || b.anio === p[0]));
  }

  /* ---------- export del biometrico (xlsx) ---------- */

  const RE_EMPLEADO = /Id del Empleado:\s*([^,]+),\s*Nombres:\s*([^,]+)/i;

  function hhmmBio(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return deMin(Math.floor((v % 1) * 1440 + 1e-6));
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
    return m && m[0] !== '00:00' ? m[1].padStart(2, '0') + ':' + m[2] : null;
  }
  function isoBio(v) {
    if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
  }
  // Los reportes vienen en dia/mes o en mes/dia segun de donde se exporten. Se decide
  // mirando todas las fechas de la hoja: si alguna parte pasa de 12, ya no hay duda.
  function ordenFechas(valores) {
    let dmy = false;
    let mdy = false;
    for (const v of valores) {
      if (typeof v === 'number') continue;
      const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\//);
      if (!m) continue;
      if (Number(m[1]) > 12) dmy = true;
      if (Number(m[2]) > 12) mdy = true;
    }
    if (dmy && mdy) throw new Error('las fechas del reporte mezclan día/mes con mes/día');
    return mdy ? 'mdy' : 'dmy';
  }
  function fechaHora(v, orden) {
    if (typeof v === 'number') {
      const total = Math.floor(v * 1440 + 1e-6);
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(total / 1440) * 86400000);
      return { fecha: d.toISOString().slice(0, 10), hora: deMin(total % 1440) };
    }
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const anio = m[3].length === 2 ? '20' + m[3] : m[3];
    const dia = orden === 'mdy' ? m[2] : m[1];
    const mes = orden === 'mdy' ? m[1] : m[2];
    return {
      fecha: anio + '-' + mes.padStart(2, '0') + '-' + dia.padStart(2, '0'),
      hora: m[4].padStart(2, '0') + ':' + m[5],
    };
  }
  function agregar(emp, fecha) {
    if (!emp.dias[fecha]) emp.dias[fecha] = { marcas: [], entradas: null };
    return emp.dias[fecha];
  }
  function tomarEmpleado(empleados, id, nombre) {
    if (!empleados[id]) empleados[id] = { id, nombre, dias: {} };
    return empleados[id];
  }

  function cabeceraMarcaciones(filas) {
    let i = -1;
    for (let k = 0; k < filas.length; k += 1) {
      if (filas[k].some((c) => norm(c) === 'id del empleado')) { i = k; break; }
    }
    if (i < 0) return null;
    const cab = filas[i].map(norm);
    const col = {
      fila: i,
      id: cab.indexOf('id del empleado'),
      nombre: cab.indexOf('nombres'),
      marca: cab.indexOf('hora de marcacion'),
      fecha: cab.indexOf('fecha'),
      hora: cab.indexOf('hora'),
    };
    return (col.marca < 0 && (col.fecha < 0 || col.hora < 0)) ? null : col;
  }

  function leerMarcaciones(filas, col, empleados) {
    const datos = filas.slice(col.fila + 1).filter((f) => {
      const id = f[col.id];
      return id !== null && id !== undefined && String(id).trim() !== '';
    });
    const orden = ordenFechas(datos.map((f) => (col.marca >= 0 ? f[col.marca] : f[col.fecha])));
    for (const f of datos) {
      const m = col.marca >= 0 ? fechaHora(f[col.marca], orden)
        : fechaHora(String(f[col.fecha]) + ' ' + String(f[col.hora]), orden);
      if (!m) continue;
      const e = tomarEmpleado(empleados, String(f[col.id]).trim(),
        String(f[col.nombre] == null ? '' : f[col.nombre]).trim());
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
        if (m) { emp = tomarEmpleado(empleados, m[1].trim(), m[2].trim()); continue; }
        if (norm(a) === 'nombre de empresa') {
          const cab = f.map(norm);
          const wd = cab.indexOf('work day');
          // Ojo: hay dos columnas "Entrada". La primera es el turno teorico, igual para todos;
          // la marcacion real es la que viene despues de "Work day".
          col = { fecha: cab.indexOf('fecha'), entrada: cab.indexOf('entrada', wd), salida: cab.indexOf('salida', wd) };
          continue;
        }
      }
      if (!emp || !col) continue;
      const fecha = isoBio(f[col.fecha]);
      if (!fecha) continue;
      const d = agregar(emp, fecha);
      if (!d.entradas) d.entradas = [];
      const ent = hhmmBio(f[col.entrada]);
      const sal = hhmmBio(f[col.salida]);
      if (ent) { d.entradas.push(ent); d.marcas.push(ent); }
      if (sal) d.marcas.push(sal);
    }
  }

  function leerMarcacionesPorBloques(filas, empleados) {
    let emp = null;
    let col = null;
    const pend = [];
    for (const f of filas) {
      const a = f[0];
      if (typeof a === 'string') {
        const m = a.match(RE_EMPLEADO);
        if (m) { emp = tomarEmpleado(empleados, m[1].trim(), m[2].trim()); continue; }
        const cab = f.map(norm);
        if (cab.indexOf('fecha') >= 0 && cab.indexOf('hora') >= 0) {
          col = { fecha: cab.indexOf('fecha'), hora: cab.indexOf('hora') };
          continue;
        }
      }
      if (!emp || !col) continue;
      const v = f[col.fecha];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      pend.push({ emp, fecha: v, hora: f[col.hora] });
    }
    if (!pend.length) return false;
    const orden = ordenFechas(pend.map((x) => x.fecha));
    for (const x of pend) {
      const m = fechaHora(String(x.fecha) + ' ' + String(x.hora), orden);
      if (m) agregar(x.emp, m.fecha).marcas.push(m.hora);
    }
    return true;
  }

  function parseBiometrico(buffer, nombreArchivo) {
    const wb = XLSX.read(buffer, { type: 'array', raw: true });
    const empleados = {};
    let formato = null;
    for (const nombre of wb.SheetNames) {
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
      if (filas.some((f) => f.some((c) => norm(c) === 'work day'))) {
        leerTiempos(filas, empleados);
        formato = formato || 'tiempos';
        continue;
      }
      const col = cabeceraMarcaciones(filas);
      if (col) {
        leerMarcaciones(filas, col, empleados);
        formato = formato || 'marcaciones';
        continue;
      }
      if (leerMarcacionesPorBloques(filas, empleados)) formato = formato || 'marcaciones';
    }
    if (!Object.keys(empleados).length) {
      throw new Error(nombreArchivo + ': no se reconoce el formato. Se espera un "Reporte de Marcaciones" o un "Tiempos trabajados" del biométrico.');
    }
    let ultima = null;
    for (const e of Object.values(empleados)) {
      for (const fecha of Object.keys(e.dias)) {
        const d = e.dias[fecha];
        d.marcas = Array.from(new Set(d.marcas)).sort();
        if (d.entradas) d.entradas = Array.from(new Set(d.entradas)).sort();
        if (d.marcas.length) {
          const t = fecha + ' ' + d.marcas[d.marcas.length - 1];
          if (!ultima || t > ultima) ultima = t;
        }
      }
    }
    // El nombre del export trae la fecha y hora en que se genero: ese es el corte.
    // Si no la trae, se usa la ultima marca que aparece en el archivo.
    const m = String(nombreArchivo).match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    let corte = null;
    if (m) corte = { fecha: m[1] + '-' + m[2] + '-' + m[3], hora: m[4] + ':' + m[5] };
    else if (ultima) corte = { fecha: ultima.slice(0, 10), hora: ultima.slice(11) };
    return { archivo: nombreArchivo, formato, corte, empleados };
  }

  // Une varios archivos. Las marcas se suman sin duplicar, asi que solaparse no pierde nada.
  function combinar(archivos) {
    const empleados = {};
    let corte = null;
    for (const a of archivos) {
      for (const id of Object.keys(a.empleados)) {
        const e = a.empleados[id];
        const dst = tomarEmpleado(empleados, id, e.nombre);
        for (const fecha of Object.keys(e.dias)) {
          const d = e.dias[fecha];
          const cur = agregar(dst, fecha);
          cur.marcas = Array.from(new Set(cur.marcas.concat(d.marcas))).sort();
          if (d.entradas) cur.entradas = Array.from(new Set((cur.entradas || []).concat(d.entradas))).sort();
        }
      }
      if (a.corte && (!corte || a.corte.fecha + ' ' + a.corte.hora > corte.fecha + ' ' + corte.hora)) corte = a.corte;
    }
    return {
      archivos: archivos.map((a) => a.archivo),
      formatos: Array.from(new Set(archivos.map((a) => a.formato))),
      corte,
      empleados,
    };
  }

  W.LIB = {
    norm, DIAS, DIAS_LARGO, MESES, aMin, deMin, sumarDias, lunesDe,
    parseCSV, bajarCSV, urlCSV, celdaTurno,
    bloquesOmuh, bloquesAncestral, elegirBloques,
    parseBiometrico, combinar,
  };
}(window));
