/* Carga el export del biometrico, baja los horarios del Google Sheet,
   arma las 3 matrices y las recomendaciones. */
(function () {
  'use strict';

  const L = window.LIB;
  const D = window.DATOS;
  const R = D.reglas;
  const $ = (id) => document.getElementById(id);
  const DIA_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Cada pagina define que areas muestra (window.SOLO_AREAS). Sin eso, muestra todas.
  const CLAVES = (window.SOLO_AREAS || Object.keys(D.fuentes)).filter((k) => D.fuentes[k]);

  let bio = null;          // marcaciones leidas
  let semanaElegida = null;
  const bloqueElegido = {}; // area -> indice, cuando la semana esta duplicada
  let ultimo = null;        // ultimo resultado, para los PNG

  /* ---------------- indice de nombres por area ---------------- */

  function indice(area) {
    const idx = new Map();
    for (const e of D.empleados) {
      if (e.area !== area) continue;
      const nombres = [e.nombre].concat(e.alias || []);
      for (const n of nombres) {
        const k = L.norm(n);
        if (idx.has(k) && idx.get(k) !== e.id) idx.set(k, null);
        else idx.set(k, e.id);
      }
    }
    return idx;
  }
  const porId = {};
  D.empleados.forEach((e) => { porId[e.id] = e; });

  /* ---------------- evaluacion de un dia ---------------- */

  // Separa entradas de salidas. Una marca antes de las 04:00 es la salida del dia anterior.
  function separar(dia) {
    const umbral = R.umbralSalidaMadrugadaHora * 60;
    const temprana = (t) => L.aMin(t) < umbral;
    const madrugada = dia.marcas.filter(temprana);
    const resto = dia.marcas.filter((t) => !temprana(t)).sort();
    const entradas = dia.entradas
      ? dia.entradas.filter((t) => !temprana(t))
      : resto.filter((_, i) => i % 2 === 0);
    return { madrugada, resto, entradas };
  }

  function evaluar(prog, dia, fecha, corte) {
    const s = separar(dia);
    const notas = s.madrugada.length ? [s.madrugada[0] + ' es la salida del día anterior'] : [];

    if (!prog || prog.tipo === 'vacio') return { tipo: 'na', notas };
    if (prog.tipo === 'libre') {
      return s.resto.length
        ? { tipo: 'libre_marco', marca: s.resto[0], notas }
        : { tipo: 'libre', notas };
    }
    if (prog.tipo === 'ausencia') return { tipo: 'ausencia', etiqueta: prog.etiqueta, notas };

    // Despues del corte del export todavia no se sabe si marco.
    const pasoCorte = !corte || fecha > corte.fecha
      || (fecha === corte.fecha && L.aMin(prog.entrada) > L.aMin(corte.hora));
    if (pasoCorte) return { tipo: 'sd', prog: prog.entrada, notas };

    const n = s.resto.length;
    if (n === 0) return { tipo: 'sin_marcar', prog: prog.entrada, cortado: prog.cortado, notas };

    const entrada = s.resto[0];
    const salida = n > 1 ? s.resto[n - 1] : null;
    const delta = L.aMin(entrada) - L.aMin(prog.entrada);
    const tarde = delta >= R.toleranciaAtrasoMin;
    let antes = null;
    if (salida && prog.salida) {
      const d = L.aMin(prog.salida) - L.aMin(salida);
      if (d >= R.salidaAnticipadaMin) antes = d;
    }
    return {
      tipo: tarde ? 'tarde' : (n === 1 ? 'una_marca' : 'ok'),
      unaMarca: n === 1,
      marcas: n,
      prog: prog.entrada,
      progSalida: prog.salida,
      cortado: prog.cortado,
      entrada,
      salida,
      delta,
      antes,
      notas,
    };
  }

  // rojo = atraso de 10 min o mas | anaranjado = no marco | amarillo = una sola marca
  function color(c) {
    if (c.tipo === 'tarde') return 'rojo';
    if (c.tipo === 'sin_marcar') return 'naranja';
    if (c.tipo === 'una_marca') return 'amarillo';
    if (c.tipo === 'libre_marco') return 'amarillo';
    return '';
  }
  const CUENTAN = ['ok', 'tarde', 'sin_marcar', 'una_marca'];

  /* ---------------- bajar y elegir los bloques de horario ---------------- */

  function pestanasOmuh(lunes) {
    const vistas = [];
    for (const off of [0, 6]) {
      const f = L.sumarDias(lunes, off).split('-').map(Number);
      const nombre = L.MESES[f[1] - 1].toUpperCase() + ' ' + f[0];
      if (vistas.indexOf(nombre) < 0) vistas.push(nombre);
    }
    return vistas;
  }

  async function cargarArea(clave, lunes) {
    const f = D.fuentes[clave];
    const avisos = [];
    let bloques = [];
    if (f.formato === 'omuh') {
      for (const pes of pestanasOmuh(lunes)) {
        try {
          const filas = await L.bajarCSV(f.sheetId, pes);
          bloques = bloques.concat(L.bloquesOmuh(filas, R.cierre).map((b) => ({ ...b, pestana: pes })));
        } catch (e) {
          avisos.push('No se pudo leer la pestaña "' + pes + '" de ' + f.titulo + ': ' + e.message);
        }
      }
    } else {
      const filas = await L.bajarCSV(f.sheetId, f.pestana);
      bloques = L.bloquesAncestral(filas, R.cierre).map((b) => ({ ...b, pestana: f.pestana }));
    }
    // La pestana del mes siguiente repite la ultima semana del mes anterior: si dos
    // candidatos dicen exactamente lo mismo, es el mismo horario y no hay nada que elegir.
    const vistos = [];
    const candidatos = [];
    for (const b of L.elegirBloques(bloques, lunes, f.formato)) {
      const hh = huella(b);
      if (vistos.indexOf(hh) >= 0) continue;
      vistos.push(hh);
      candidatos.push(b);
    }
    return { bloques, candidatos, avisos };
  }

  function huella(b) {
    return JSON.stringify(b.filas.map((f) => [L.norm(f.nombre), f.celdas.map((c) =>
      (c.tipo === 'turno' ? c.entrada + '-' + c.salida : (c.etiqueta || c.tipo)))]));
  }

  /* ---------------- armar una matriz ---------------- */

  function matriz(clave, bloque) {
    const f = D.fuentes[clave];
    const idx = indice(clave);
    const fechas = [0, 1, 2, 3, 4, 5, 6].map((i) => L.sumarDias(semanaElegida, i));
    const filas = [];
    const sinId = [];
    let corregidas = 0;

    for (const fila of bloque.filas) {
      const id = idx.get(L.norm(fila.nombre));
      if (id === undefined || id === null) {
        if (sinId.indexOf(fila.nombre) < 0) sinId.push(fila.nombre);
        continue;
      }
      const dias = (bio.empleados[id] || {}).dias || {};
      const celdas = fila.celdas.map((prog, i) => {
        if (prog && prog.corregida) corregidas += 1;
        return Object.assign({ fecha: fechas[i] },
          evaluar(prog, dias[fechas[i]] || { marcas: [], entradas: null }, fechas[i], bio.corte));
      });

      // La marca de madrugada del dia i es la salida del dia i-1.
      celdas.forEach((c, i) => {
        if (i > 0 && c.notas.some((n) => n.indexOf('salida del día anterior') >= 0)) {
          celdas[i - 1].notas.push('salió pasada la medianoche');
        }
      });

      const cuentan = celdas.filter((c) => CUENTAN.indexOf(c.tipo) >= 0);
      const buenos = cuentan.filter((c) => !color(c)).length;
      filas.push({
        id,
        nombre: (porId[id] || {}).nombre || fila.nombre,
        subarea: fila.subarea,
        enBiometrico: !!bio.empleados[id],
        celdas,
        ratio: { num: buenos, den: cuentan.length },
      });
    }

    // Si nadie tiene turno ese dia, el local estaba cerrado: la columna no se muestra.
    const OCULTO = ['na', 'libre'];
    const visibles = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      filas.some((fl) => OCULTO.indexOf(fl.celdas[i].tipo) < 0));

    return { clave, titulo: f.titulo, bloque, fechas, visibles, filas, sinId, corregidas };
  }

  /* ---------------- dibujar ---------------- */

  function celdaHTML(c) {
    const cls = color(c);
    const tit = c.notas.length ? ' title="' + c.notas.join(' · ').replace(/"/g, '') + '"' : '';
    let cuerpo;
    if (c.tipo === 'na') cuerpo = '<span class="gris">·</span>';
    else if (c.tipo === 'libre') cuerpo = '<span class="gris">libre</span>';
    else if (c.tipo === 'libre_marco') cuerpo = '<b>' + c.marca + '</b><div class="sub">marcó en día libre</div>';
    else if (c.tipo === 'ausencia') cuerpo = '<span class="gris">' + c.etiqueta.toLowerCase() + '</span>';
    else if (c.tipo === 'sd') cuerpo = '<span class="gris">s/d</span><div class="prog">' + c.prog + '</div>';
    else if (c.tipo === 'sin_marcar') cuerpo = '<b>sin marcar</b><div class="prog">' + c.prog + '</div>';
    else {
      const d = c.delta > 0 ? '+' + c.delta : String(c.delta);
      cuerpo = '<b>' + c.entrada + '</b> <span class="d">' + d + '</span>'
        + '<div class="sal">' + (c.salida ? c.salida : '— sin salida') + '</div>'
        + '<div class="prog">' + c.prog + (c.cortado ? ' ·' : '') + '</div>';
    }
    return '<td class="' + cls + '"' + tit + '>' + cuerpo + '</td>';
  }

  function tablaHTML(m) {
    const dias = [0, 1, 2, 3, 4, 5, 6].filter((i) => m.visibles[i]);
    let h = '<table class="tb"><thead><tr><th class="emp">Empleado</th>';
    for (const i of dias) h += '<th>' + DIA_CORTO[i] + ' ' + m.fechas[i].slice(8) + '</th>';
    h += '<th class="pr">Prop.</th></tr></thead><tbody>';
    let sub = null;
    for (const fl of m.filas) {
      const generica = ['personal', 'empleado', 'empleados'].indexOf(L.norm(fl.subarea)) >= 0;
      if (fl.subarea && !generica && fl.subarea !== sub && L.norm(fl.subarea) !== L.norm(m.titulo)) {
        sub = fl.subarea;
        h += '<tr class="sec"><td colspan="' + (dias.length + 2) + '">' + sub + '</td></tr>';
      }
      h += '<tr><td class="emp">' + fl.nombre
        + (fl.enBiometrico ? '' : ' <span class="gris">(no está en el biométrico)</span>') + '</td>';
      for (const i of dias) h += celdaHTML(fl.celdas[i]);
      const pct = fl.ratio.den ? Math.round((fl.ratio.num / fl.ratio.den) * 100) : null;
      h += '<td class="pr' + (pct !== null && pct < 60 ? ' rojo' : '') + '">'
        + fl.ratio.num + '/' + fl.ratio.den + (pct === null ? '' : '<div class="sub">' + pct + '%</div>') + '</td></tr>';
    }
    return h + '</tbody></table>';
  }

  function recomendaciones(ms, avisos) {
    const tarde = [];
    const sinMarcar = [];
    const unaMarca = [];
    const antes = [];
    const libreMarco = [];
    for (const m of ms) {
      for (const fl of m.filas) {
        m.visibles.forEach((v, i) => {
          if (!v) return;
          const c = fl.celdas[i];
          const et = fl.nombre + ' (' + m.titulo + ') ' + DIA_CORTO[i];
          if (c.tipo === 'tarde') tarde.push(et + ': entró ' + c.entrada + ', +' + c.delta + ' min sobre ' + c.prog);
          if (c.tipo === 'sin_marcar') sinMarcar.push(et + ': no marcó, le tocaba ' + c.prog);
          if (c.tipo === 'una_marca') unaMarca.push(et + ': una sola marca (' + c.entrada + '), falta la salida');
          if (c.tipo === 'libre_marco') libreMarco.push(et + ': marcó ' + c.marca + ' en día libre');
          if (c.antes) antes.push(et + ': salió ' + c.salida + ', ' + c.antes + ' min antes de ' + c.progSalida);
        });
      }
    }
    const bloqs = [];
    for (const m of ms) {
      const falt = m.sinId;
      if (falt.length) {
        bloqs.push({
          t: m.titulo + ': ' + falt.length + ' nombre' + (falt.length > 1 ? 's' : '') + ' de la planilla sin id del biométrico',
          l: falt.map((n) => n + ' — agregar en docs/js/datos.js con su id, o corregir el nombre en la planilla'),
          clase: 'alerta',
        });
      }
    }
    const idsEnHorario = new Set(ms.flatMap((m) => m.filas.map((fl) => fl.id)));
    const fechas = [0, 1, 2, 3, 4, 5, 6].map((i) => L.sumarDias(semanaElegida, i));
    const marcaronSinHorario = Object.values(bio.empleados)
      .filter((e) => !idsEnHorario.has(e.id) && fechas.some((f) => (e.dias[f] || { marcas: [] }).marcas.length))
      .map((e) => 'id ' + e.id + (e.nombre ? ' (' + e.nombre + ')' : '') + ' marcó esta semana y no está en ninguna planilla');
    if (marcaronSinHorario.length) bloqs.push({ t: 'Marcaron sin horario cargado', l: marcaronSinHorario, clase: 'alerta' });

    const corr = ms.filter((m) => m.corregidas > 0)
      .map((m) => m.titulo + ': ' + m.corregidas + ' celdas tenían la salida en formato de 12 horas '
        + '(por ejemplo "10:30 - 11:00"); se leyeron como salida de la tarde. '
        + 'Conviene escribir 23:00 o "Cierre" en la planilla.');
    if (corr.length) bloqs.push({ t: 'Horas de salida interpretadas', l: corr, clase: 'alerta' });

    if (avisos.length) bloqs.push({ t: 'Avisos de lectura', l: avisos, clase: 'alerta' });
    if (tarde.length) bloqs.push({ t: 'Atrasos de 10 minutos o más (' + tarde.length + ')', l: tarde, clase: 'rojo-t' });
    if (sinMarcar.length) bloqs.push({ t: 'No marcaron (' + sinMarcar.length + ')', l: sinMarcar, clase: 'naranja-t' });
    if (unaMarca.length) bloqs.push({ t: 'Marcaron una sola vez (' + unaMarca.length + ')', l: unaMarca, clase: 'amarillo-t' });
    if (libreMarco.length) bloqs.push({ t: 'Marcaron en día libre (' + libreMarco.length + ')', l: libreMarco, clase: 'amarillo-t' });
    if (antes.length) bloqs.push({ t: 'Salieron antes de la hora (' + antes.length + ')', l: antes, clase: '' });
    if (!bloqs.length) return '<p class="ok-t">Sin observaciones: todos marcaron entrada y salida dentro de su horario.</p>';

    return bloqs.map((b) => '<div class="rec ' + b.clase + '"><h4>' + b.t + '</h4><ul>'
      + b.l.map((x) => '<li>' + x + '</li>').join('') + '</ul></div>').join('');
  }

  /* ---------------- pintar todo ---------------- */

  async function pintar() {
    const cont = $('areas');
    cont.innerHTML = '<p class="cargando">Bajando los horarios del Google Sheet…</p>';
    const ms = [];
    const avisos = [];
    const dup = [];
    const sinHorario = [];   // areas que existen pero no tienen la semana cargada

    for (const clave of CLAVES) {
      const titulo = D.fuentes[clave].titulo;
      let r;
      try {
        r = await cargarArea(clave, semanaElegida);
      } catch (e) {
        sinHorario.push({ clave, titulo, error: e.message, disponibles: [] });
        continue;
      }
      avisos.push.apply(avisos, r.avisos);
      if (!r.candidatos.length) {
        sinHorario.push({ clave, titulo, error: null, disponibles: r.bloques.map((b) => b.texto) });
        continue;
      }
      if (r.candidatos.length > 1) dup.push({ clave, titulo, cands: r.candidatos });
      const i = Math.min(bloqueElegido[clave] || 0, r.candidatos.length - 1);
      ms.push(matriz(clave, r.candidatos[i]));
    }

    ultimo = ms;
    let h = '';
    for (const d of dup) {
      h += '<div class="rec alerta"><h4>' + d.titulo + ': la semana está cargada ' + d.cands.length
        + ' veces en la planilla, con contenido distinto</h4><p>Elegí cuál vale. Conviene borrar la que sobra en el Google Sheet.</p><p>';
      d.cands.forEach((c, i) => {
        const sel = (Math.min(bloqueElegido[d.clave] || 0, d.cands.length - 1) === i);
        h += '<button class="chip' + (sel ? ' on' : '') + '" data-dup="' + d.clave + '" data-i="' + i
          + '">Bloque ' + (i + 1) + ' · fila ' + c.linea + '</button> ';
      });
      h += '</p></div>';
    }
    for (const m of ms) {
      h += '<section class="area" id="area-' + m.clave + '">'
        + '<div class="cap" id="cap-' + m.clave + '">'
        + '<div class="cab"><h3>' + m.titulo + '</h3>'
        + '<span class="per">' + m.fechas[0].split('-').reverse().join('/') + ' al '
        + m.fechas[6].split('-').reverse().join('/') + '</span></div>'
        + '<div class="ley"><span><i class="sw rojo"></i>atraso de 10 min o más</span>'
        + '<span><i class="sw amarillo"></i>una sola marca</span>'
        + '<span><i class="sw naranja"></i>no marcó</span>'
        + '<span class="gris">el número chico es la hora programada · "·" turno cortado</span></div>'
        + tablaHTML(m) + '</div>'
        + '<p class="acc"><button data-png="' + m.clave + '">Descargar PNG</button>'
        + '<span class="gris"> fuente: ' + m.bloque.pestana + ', fila ' + m.bloque.linea + '</span></p>'
        + '</section>';
    }
    // El area se muestra siempre, aunque no haya horario: asi queda claro que falta cargarlo.
    for (const s of sinHorario) {
      const fin = L.sumarDias(semanaElegida, 6);
      h += '<section class="area"><div class="cap vacia">'
        + '<div class="cab"><h3>' + s.titulo + '</h3>'
        + '<span class="per">' + semanaElegida.split('-').reverse().join('/') + ' al '
        + fin.split('-').reverse().join('/') + '</span></div>'
        + '<p class="nada"><b>No hay horario cargado para esta semana.</b></p>'
        + (s.error
          ? '<p class="gris">No se pudo leer la planilla: ' + s.error + '</p>'
          : '<p class="gris">La planilla tiene ' + s.disponibles.length + ' semana'
            + (s.disponibles.length === 1 ? '' : 's') + '. Las últimas: '
            + (s.disponibles.slice(-4).join(' · ') || 'ninguna')
            + '.<br>Cargá esta semana en el Google Sheet y tocá "Volver a bajar los horarios".</p>')
        + '</div></section>';
    }
    h += '<section class="recs"><h2>Recomendaciones</h2>' + recomendaciones(ms, avisos) + '</section>';
    cont.innerHTML = h;

    cont.querySelectorAll('[data-png]').forEach((b) => {
      b.addEventListener('click', () => descargarPNG(b.getAttribute('data-png')));
    });
    cont.querySelectorAll('[data-dup]').forEach((b) => {
      b.addEventListener('click', () => {
        bloqueElegido[b.getAttribute('data-dup')] = Number(b.getAttribute('data-i'));
        pintar();
      });
    });
  }

  function descargarPNG(clave) {
    const el = $('cap-' + clave);
    html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false }).then((canvas) => {
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'asistencia-' + clave + '-' + semanaElegida + '.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
    });
  }

  /* ---------------- entrada de archivos ---------------- */

  function semanasDe(b) {
    const cuenta = {};
    for (const e of Object.values(b.empleados)) {
      for (const f of Object.keys(e.dias)) {
        const lun = L.lunesDe(f);
        cuenta[lun] = (cuenta[lun] || 0) + e.dias[f].marcas.length;
      }
    }
    return Object.keys(cuenta).sort().map((s) => ({ semana: s, marcas: cuenta[s] }));
  }

  async function leerArchivos(lista) {
    const est = $('estado');
    est.className = 'estado';
    est.textContent = 'Leyendo ' + lista.length + ' archivo' + (lista.length > 1 ? 's' : '') + '…';
    const partes = [];
    for (const f of lista) {
      try {
        partes.push(L.parseBiometrico(new Uint8Array(await f.arrayBuffer()), f.name));
      } catch (e) {
        est.className = 'estado mal';
        est.textContent = e.message;
        return;
      }
    }
    bio = L.combinar(partes);
    const sem = semanasDe(bio);
    if (!sem.length) {
      est.className = 'estado mal';
      est.textContent = 'El archivo no tiene marcaciones con fecha.';
      return;
    }
    sem.sort((a, b2) => b2.marcas - a.marcas);
    semanaElegida = sem[0].semana;
    sem.sort((a, b2) => a.semana.localeCompare(b2.semana));

    est.className = 'estado bien';
    est.innerHTML = 'Leído: <b>' + Object.keys(bio.empleados).length + '</b> empleados · formato '
      + bio.formatos.join(' + ') + ' · corte '
      + (bio.corte ? bio.corte.fecha.split('-').reverse().join('/') + ' ' + bio.corte.hora : 'desconocido');

    const sel = $('semana');
    sel.innerHTML = sem.map((s) => '<option value="' + s.semana + '"'
      + (s.semana === semanaElegida ? ' selected' : '') + '>Semana del '
      + s.semana.split('-').reverse().join('/') + ' · ' + s.marcas + ' marcas</option>').join('');
    $('barra').hidden = false;
    pintar();
  }

  /* ---------------- enganches ---------------- */

  const zona = $('zona');
  const input = $('archivo');
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.classList.remove('sobre');
    if (e.dataTransfer.files.length) leerArchivos(Array.from(e.dataTransfer.files));
  });
  input.addEventListener('change', () => {
    if (input.files.length) leerArchivos(Array.from(input.files));
  });
  $('semana').addEventListener('change', (e) => {
    semanaElegida = e.target.value;
    Object.keys(bloqueElegido).forEach((k) => delete bloqueElegido[k]);
    pintar();
  });
  $('recargar').addEventListener('click', () => pintar());
}());
