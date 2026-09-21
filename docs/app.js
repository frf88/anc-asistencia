(() => {
  const DIA_CORTO = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const guardado = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  let indice = null;
  let semana = null;
  let area = guardado.get('area');

  const dd = (iso) => Number(iso.slice(8, 10));
  const fmtDelta = (d) => (d === 0 ? '0' : d > 0 ? `+${d}` : `−${Math.abs(d)}`);
  const fmtFechaHora = (iso) => {
    const d = new Date(iso);
    return `${d.getDate()} ${MES[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const rangoSemana = (lunes) => {
    const fin = new Date(`${lunes}T00:00:00Z`); fin.setUTCDate(fin.getUTCDate() + 6);
    return `${dd(lunes)} – ${fin.getUTCDate()} ${MES[fin.getUTCMonth()]} ${fin.getUTCFullYear()}`;
  };

  function celda(c) {
    const notas = c.notas?.length ? c.notas.join(' · ') : '';
    const attrs = (cls) => {
      const k = [cls, notas && 'nota'].filter(Boolean).join(' ');
      return `${k ? ` class="${k}"` : ''}${notas ? ` title="${esc(notas)}"` : ''}`;
    };
    const prog = c.prog ? `<div class="p">${c.prog}</div>` : '<div class="p">turno s/d</div>';
    const extras = (c.extras ?? []).map((e) =>
      `<div class="n">${e.marca}${e.delta !== null ? ` <span class="d">${fmtDelta(e.delta)}</span>` : ''}</div>`).join('');

    switch (c.tipo) {
      case 'na': return `<td${attrs('lib')}>—</td>`;
      case 'libre': return `<td${attrs('lib')}>libre</td>`;
      case 'ausencia': return `<td${attrs('lib')}>${esc(c.etiqueta)}</td>`;
      case 'libre_marco': return `<td${attrs('')}><div class="n">${c.marca}</div><div class="p">era libre</div></td>`;
      case 'sd': return `<td${attrs('')}><div class="p">s/d${c.prog ? ` · ${c.prog}` : ''}</div></td>`;
      case 'sin_marcar': return `<td${attrs('red')}><div class="rt">sin marcar</div>${prog}</td>`;
      case 'tarde': return `<td${attrs('red')}><div class="n rt">${c.marca} ${fmtDelta(c.delta)}</div>${extras}${prog}</td>`;
      default: return `<td${attrs('')}><div class="n">${c.marca} <span class="d">${fmtDelta(c.delta)}</span></div>${extras}${prog}</td>`;
    }
  }

  function render(datos) {
    const areas = datos.areas;
    if (!areas.some((a) => a.area === area)) area = areas[0]?.area;

    $('tabs').innerHTML = areas.map((a) =>
      `<button role="tab" data-area="${a.area}" aria-selected="${a.area === area}">${esc(a.titulo)}</button>`).join('');

    const a = areas.find((x) => x.area === area);
    $('vacio').hidden = !!a?.filas.length;
    if (!a) { $('tabla').innerHTML = ''; return; }

    const idx = datos.dias.map((_, i) => i).filter((i) => a.visibles[i]);
    const head = `<thead><tr><th>Empleado</th>${idx.map((i) =>
      `<th>${DIA_CORTO[datos.dias[i]]} ${dd(datos.fechas[i])}</th>`).join('')}<th class="pr">Propinas</th></tr></thead>`;
    const umbral = indice.umbralPropinaBajoPct ?? 60;
    const body = a.filas.map((f) => {
      const bajo = f.ratio.pct !== null && f.ratio.pct < umbral;
      const ratio = f.ratio.den
        ? `<div class="pv">${f.ratio.num} / ${f.ratio.den}</div><div class="p">${f.ratio.pct} %</div>`
        : '<div class="p">sin turnos</div>';
      return `<tr><td>${esc(f.nombre)}${f.subarea ? ` <span class="sub">(${esc(f.subarea)})</span>` : ''}</td>${
        idx.map((i) => celda(f.celdas[i])).join('')}<td class="pr${bajo ? ' bajo' : ''}">${ratio}</td></tr>`;
    }).join('');
    $('tabla').innerHTML = head + `<tbody>${body}</tbody>`;
  }

  async function cargarSemana(s) {
    semana = s;
    guardado.set('semana', s);
    const r = await fetch(`data/semanas/${s}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`No se pudo cargar la semana ${s}`);
    render(await r.json());
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-area]');
    if (!b) return;
    area = b.dataset.area;
    guardado.set('area', area);
    cargarSemana(semana);
  });
  $('semana').addEventListener('change', (e) => cargarSemana(e.target.value));

  (async () => {
    try {
      const r = await fetch('data/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('Todavía no hay datos publicados');
      indice = await r.json();
      $('ley-red').textContent = `Sin marcar o atraso > ${indice.tolerancia} min`;
      const corte = indice.corte ? ` · corte del biométrico ${dd(indice.corte.fecha)}/${indice.corte.fecha.slice(5, 7)} ${indice.corte.hora}` : '';
      $('meta').textContent = `Actualizado ${fmtFechaHora(indice.generado)}${corte}`;
      $('semana').innerHTML = indice.semanas.map((s) => `<option value="${s}">${rangoSemana(s)}</option>`).join('');
      const inicial = indice.semanas.includes(guardado.get('semana')) ? guardado.get('semana') : indice.semanas[0];
      $('semana').value = inicial;
      await cargarSemana(inicial);
    } catch (e) {
      $('meta').textContent = e.message;
    }
  })();
})();
