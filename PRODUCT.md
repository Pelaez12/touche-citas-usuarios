# Touché Hair Studio — Agenda de Citas (Clientas)

Aplicación web móvil (PWA) para que las clientas de **Touché Hair Studio** (Surquillo, Lima) agenden citas en menos de 30 segundos desde su celular, conectada en tiempo real a la agenda interna del salón.

## Flujo de reserva (4 pasos)
1. **Servicio**: Acceso directo a la **Evaluación y diagnóstico capilar gratuita (20 min)**, búsqueda instantánea, filtros por categoría y precios referenciales.
2. **Especialista**: «Primera especialista disponible (más horarios)» por defecto, más opción de elegir a una especialista habilitada para el servicio seleccionado.
3. **Día y hora**: Franja rápida de 14 días + vista mensual, horarios reales en mañana y tarde según turnos, descansos semanales, excepciones y citas ya programadas.
4. **Tus datos y confirmación**: Solo nombre completo, celular WhatsApp y DNI (8 dígitos), más comprobante con código de reserva, Google Maps y descarga `.ics` / Google Calendar.

## Privacidad y sincronización
- Conectada a la base de datos compartida `touche-reservas` (Cloudflare D1) para sincronización instantánea con el panel interno de Touché Hair Studio y sus notificaciones del salón.
- Los endpoints públicos nunca exponen fichas, teléfonos, DNIs ni historial de otras clientas.
