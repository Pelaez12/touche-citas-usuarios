# Touché Hair Studio — Agenda de Citas (Clientas)

Aplicación web móvil (PWA) para que las clientas de **Touché Hair Studio** (Calle Las Tiendas 261, Dpto. 201, Surquillo) reserven citas en segundos desde el celular.

## Características
- **Flujo rápido móvil-primero en 4 pasos**:
  1. **Servicio**: acceso destacado a **Evaluación y diagnóstico capilar gratuita (20 min)**, buscador instantáneo, filtros por categoría y precios referenciales.
  2. **Especialista**: opción por defecto **Primera especialista disponible (más horarios)** + opción de elegir a tu estilista favorita filtrada automáticamente por especialidad.
  3. **Día y hora**: franja rápida de 14 días + calendario mensual completo con horarios en tiempo real (mañana y tarde), respetando descansos semanales, bloqueos y citas existentes.
  4. **Confirmación**: solo nombre, celular WhatsApp y DNI (8 dígitos), con código de reserva, ubicación en Google Maps, descarga `.ics` y enlace directo a Google Calendar.
- **Sincronización directa con la agenda interna**: comparte la base de datos D1 `touche-reservas` con el panel interno del salón para evitar cruces de horario y notificar al equipo al instante.
- **Privacidad estricta**: los endpoints públicos solo exponen el catálogo de servicios, especialistas habilitadas y horas libres — nunca datos ni historial de otras clientas.

## Comandos
```bash
npm run build:assets   # Empaqueta los archivos de public/ para Cloudflare Workers
npm test               # Ejecuta la suite de pruebas (horarios, especialidades, anti-doble reserva, privacidad)
npm run deploy         # Publica el Worker en Cloudflare
```
