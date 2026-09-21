# Asistencia Grupo ANC

Cruza el export semanal del biométrico con los horarios planificados y publica una tabla por área
(servicio, cocina, Omuh) con atrasos y ratio de propinas.

**Página:** GitHub Pages desde la carpeta `docs/`.

## Cómo funciona

1. Cada semana alguien descarga del biométrico el reporte de **Marcaciones** (una fila por cada huella:
   `ID del Empleado | Nombres | Hora de marcación | ...`) y lo sube a la carpeta de Drive. El nombre del archivo da igual.
2. Los lunes, el workflow `.github/workflows/actualizar.yml` descarga todos los exports de la carpeta,
   suma todas sus marcaciones (sin duplicar, así que solaparse no importa), cruza con los horarios y escribe
   `docs/data/`. También se puede correr a mano desde **Actions → Actualizar asistencia → Run workflow**.
3. La página lee esos JSON. No tiene backend ni credenciales.

## Reglas de cálculo (`config/reglas.json`)

| Regla | Valor | Qué hace |
|---|---|---|
| `toleranciaAtrasoMin` | 10 | Atraso mayor a esto = rojo. El adelanto nunca es rojo. |
| `umbralSalidaMadrugadaHora` | 4 | Una marca antes de las 04:00 es la salida del día anterior, no una entrada. |
| `excluirTurnosPosterioresAlCorte` | true | El corte es la última marca de los archivos. Turnos posteriores salen como `s/d` y no cuentan. |
| `contarDiaSinMarcarEnDenominador` | true | Un día sin marcar resta en el ratio. |
| `umbralPropinaBajoPct` | 60 | Ratio debajo de esto se muestra en rojo. |

**Entrada vs salida:** el biométrico no las distingue. Se descartan las marcas de madrugada y del resto la 1a, 3a, 5a... son entradas.

**Propinas** = días sin rojo ÷ días con turno. No cuentan: libres, ausencias (BAJA, VACACIONES, COMPE), `s/d`, días sin turno.
Si marcó en un día libre se muestra ("era libre") pero no suma ni resta.

## Configuración

- `config/empleados.json` — mapea el **Id del biométrico** al nombre del cuadro de horarios y al área.
  El id es la clave: si alguien cambia de nombre en el cuadro, solo se edita aquí.
  Empleado nuevo = agregar una línea.
- `config/horarios-manual.json` — horarios cargados a mano, **fuente activa** hasta definir el formato del Sheet.
  Valores: `"14:00"`, `"LIBRE"`, `null` (sin turno), `"VAR:10:30|15:00|18:30"` (se asigna el turno más cercano a la marca), cualquier otro texto (`"BAJA"`, `"VACACIONES"`) = ausencia.

Un área sin nadie en los archivos cargados no se publica hasta que suban su planilla.

### Pasar los horarios a Google Sheets

Ya está implementada una fuente `sheet` que lee una pestaña **Horarios** con tres columnas:

| ID | Fecha | Entrada |
|---|---|---|
| 29 | 15/09/2026 | 14:00 |
| 29 | 19/09/2026 | LIBRE |
| 4 | 18/09/2026 | VAR:10:30\|15:00\|18:30 |

Para activarla: variable `HORARIOS_FUENTE=sheet` y `HORARIOS_SHEET_ID` en el repo.
Si se prefiere mantener las grillas actuales, hay que escribir un adaptador por grilla en `scripts/lib/horarios.mjs`.

## Puesta en marcha (una sola vez)

1. **Cuenta de servicio de Google**
   - Google Cloud Console → crear proyecto → **APIs & Services → Library** → habilitar **Google Drive API** y **Google Sheets API**.
   - **IAM & Admin → Service Accounts → Create service account** → **Keys → Add key → Create new key → JSON**.
   - Compartir la carpeta del biométrico (y el Sheet de horarios) con el email de la cuenta de servicio, como **Viewer**.
2. **GitHub** → repo → **Settings**
   - **Secrets and variables → Actions → Secrets → New repository secret**: `GOOGLE_SERVICE_ACCOUNT_JSON` = contenido completo del JSON.
   - **Secrets and variables → Actions → Variables → New repository variable**: `BIOMETRICO_FOLDER_ID` = el id de la carpeta (lo que va después de `/folders/` en la URL).
   - **Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/docs`**.
3. **Actions → Actualizar asistencia → Run workflow** para la primera corrida.

## Local

```bash
npm install
node scripts/build.mjs --local "ruta/Marcaciones.xlsx"
npm run serve
```
