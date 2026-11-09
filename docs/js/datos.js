// Fuentes, reglas y personal. ESTE ES EL UNICO ARCHIVO QUE HAY QUE EDITAR
// cuando entra o sale alguien, o cuando cambia una planilla de horarios.
window.DATOS = {

  // De donde salen los horarios. Se leen en vivo del Google Sheet, como CSV.
  fuentes: {
    omuh: {
      titulo: 'omuH',
      sheetId: '1y7jPipP0U4KUaftV01n24XyO8P2Ae9Dr',
      formato: 'omuh',
      // Una pestana por mes. Se prueba la del mes de la semana pedida y la del mes anterior.
      pestanaPorMes: true,
    },
    servicio: {
      titulo: 'Ancestral Servicio',
      sheetId: '1g4F2sSrvptaLx2Yt8Zq8Zv7RbZRN_9Ke',
      pestana: 'HorariosNuevo',
      formato: 'ancestral',
    },
    cocina: {
      titulo: 'Ancestral Cocina',
      sheetId: '1g4F2sSrvptaLx2Yt8Zq8Zv7RbZRN_9Ke',
      pestana: 'Horarios Cocina',
      formato: 'ancestral',
    },
  },

  reglas: {
    toleranciaAtrasoMin: 10,      // 10 ya cuenta como tarde
    umbralSalidaMadrugadaHora: 4, // una marca antes de las 04:00 es la salida del dia anterior
    cierre: '23:00',              // "Cierre" en la planilla = 23:00
    salidaAnticipadaMin: 10,      // minutos antes del cierre para avisar en las recomendaciones
  },

  // id del biometrico -> nombre y area. 'alias' son las otras formas en que
  // aparece el nombre en las planillas.
  empleados: [
    // ---- Ancestral Servicio ----
    { id: '29', area: 'servicio', nombre: 'Angie',     alias: ['Angela'] },
    { id: '3',  area: 'servicio', nombre: 'Silvia' },
    { id: '10', area: 'servicio', nombre: 'Coqui',     alias: ['Jorge'] },
    { id: '20', area: 'servicio', nombre: 'Flor' },
    { id: '30', area: 'servicio', nombre: 'Alejandro' },
    { id: '38', area: 'servicio', nombre: 'Matias',    nota: 'contrato al 50%' },
    { id: '55', area: 'servicio', nombre: 'Oriana' },
    { id: '56', area: 'servicio', nombre: 'Adolfo',    alias: ['Adolfo Adriano'] },
    { id: '13', area: 'servicio', nombre: 'Felisa' },
    { id: '33', area: 'servicio', nombre: 'Gerardo' },
    { id: '43', area: 'servicio', nombre: 'Ale G',     alias: ['Alejandro Giovanni'] },
    { id: '12', area: 'servicio', nombre: 'Paola',     subarea: 'Bar' },

    // ---- Ancestral Cocina ----
    { id: '4',  area: 'cocina', nombre: 'Diego A.',  alias: ['Diego A', 'Diego Abdon'] },
    { id: '5',  area: 'cocina', nombre: 'Raymundo',  alias: ['Reymundo'] },
    { id: '14', area: 'cocina', nombre: 'Alan' },
    { id: '19', area: 'cocina', nombre: 'Edy',       alias: ['Edinson'] },
    { id: '23', area: 'cocina', nombre: 'Diego U.',  alias: ['Diego U', 'Diego'] },
    { id: '39', area: 'cocina', nombre: 'Miguel' },
    { id: '42', area: 'cocina', nombre: 'Gladis',    alias: ['Gladys', 'Gladys Zulma'] },
    { id: '50', area: 'cocina', nombre: 'Eliazar',   alias: ['Eleazar'] },
    { id: '51', area: 'cocina', nombre: 'Ale' },
    { id: '52', area: 'cocina', nombre: 'Fabricio' },
    { id: '53', area: 'cocina', nombre: 'José',      alias: ['Jose'] },
    { id: '54', area: 'cocina', nombre: 'Israel' },
    { id: '15', area: 'cocina', nombre: 'Mauricio', alias: ['Mauricio Mendez', 'Mauricio Méndez'] },

    // ---- omuH ----
    { id: '25', area: 'omuh', nombre: 'Silvana' },
    { id: '9',  area: 'omuh', nombre: 'Huascar',   alias: ['Huascar Eduardo'] },
    { id: '27', area: 'omuh', nombre: 'Jessica' },
    { id: '45', area: 'omuh', nombre: 'Ema' },
    { id: '34', area: 'omuh', nombre: 'Oscar',     alias: ['Oscar Airton'] },
    { id: '37', area: 'omuh', nombre: 'Xiomara' },
    { id: '48', area: 'omuh', nombre: 'Miguel O.', alias: ['Miguel'] },
    { id: '47', area: 'omuh', nombre: 'Bacilia' },
    { id: '46', area: 'omuh', nombre: 'Rodrigo' },
    { id: '6',  area: 'omuh', nombre: 'Marcela' },
    { id: '44', area: 'omuh', nombre: 'Hugo',      alias: ['Hugo David'] },
    { id: '35', area: 'omuh', nombre: 'Jonathan' },
    { id: '57', area: 'omuh', nombre: 'Carolina' },
  ],

  // Marcan en el biometrico pero su horario no se controla con esta pagina.
  // No salen en la matriz ni en el aviso de "marcaron sin horario cargado".
  sinControl: [
    { id: '2', nombre: 'Maya', motivo: 'administración, se controla de otra forma' },
  ],

  // Ya no trabajan aca. Estan para no reasignar el id por error.
  bajas: [
    { id: '49', nombre: 'Alexandra', hasta: '2026-10' },
    { id: '36', nombre: 'Fernando',  hasta: '2026-10' },
  ],
};
