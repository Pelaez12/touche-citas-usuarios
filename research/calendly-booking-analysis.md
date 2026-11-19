# Referencia pública de reservas Calendly observada con REA

Fecha: 19 de noviembre de 2026. Herramienta: REA (MCP `capture_browser_scenario` + `export_evidence_bundle`) ejecutado con Chrome local en modo headless con perfil temporal propio (`es-PE`, `America/Lima`).

## Evidencia obtenida
- `https://calendly.com/` (escritorio `1280×840`): evidencia `ev_e0c634fde77f5c79206fb43ab94d8f03e17e882281ea6773aec2a1be47716061` (URL, DOM, accesibilidad y captura de pantalla).
- `https://calendly.com/features/scheduling` → `https://calendly.com/scheduling` (móvil `390×844`): evidencia `ev_c6d0c2537dff456c91419430e1d1ed60db7123e25310e63183228e59aa9fa0ce` (URL, DOM, accesibilidad y captura de pantalla).
- `https://calendly.com/scheduling` (escritorio `1280×840`): evidencia `ev_c0c8cc5fa52fa352eee26d77b0886650f62e818003180ed6174978d5abead41a` (URL, DOM, accesibilidad y captura de pantalla).
- `https://calendly.com/` con desplazamiento hacia la vista de ejemplo de calendario (escritorio `1280×900`): captura del módulo público de calendario con encabezado `< Mes Año >`, columnas de días de la semana y botones circulares suaves únicamente sobre fechas disponibles.

## Patrones clave observados y adaptados a Touché Hair Studio
1. **Tarjeta blanca luminosa con doble columna en escritorio (estilo Calendly):**
   - Columna izquierda fija con marca, duración/ubicación y resumen vivo de la reserva.
   - Columna derecha interactiva y limpia, que en móvil pasa a una columna única sin fricción.
2. **Calendario mensual con días disponibles en círculos suaves:**
   - Controles claros `< Mes anterior` / `Mes siguiente >`.
   - Solo los días con cupo real tienen círculo destacado en tono suave de marca (`#f6e4e1` / texto `#8b453f`); el día seleccionado se rellena en arcilla sólida (`#96504a`); los domingos o días sin cupo quedan atenuados y deshabilitados. Esto permite que personas mayores distingan de un vistazo qué días pueden tocar.
3. **Botones de hora claros y perfilados:**
   - Bloques de hora grandes (`≥ 52px`) con borde nítido y alto contraste, separados en **Mañana** y **Tarde**, evitando textos pequeños o saturación visual.
4. **Flujo progresivo en una sola página con avance automático hacia abajo:**
   - En lugar de esconder pasos previos en pantallas desconectadas, cada selección desbloquea la siguiente sección inmediatamente debajo y desplaza suavemente la pantalla hasta la acción siguiente (con `prefers-reduced-motion` respetado).
5. **Aviso visible de precio referencial:**
   - Al elegir cualquier servicio con precio `"Desde S/ ..."`, se muestra una aclaración visible y directa explicando que el precio final puede variar dentro del salón según largo, cantidad y estado del cabello.

## Límites
No se inició sesión ni se accedió a cuentas privadas de Calendly ni se enviaron formularios a sus servidores. Todas las observaciones provienen exclusivamente de páginas públicas de Calendly y se adaptaron integralmente a la identidad oficial del Manual de Marca de Touché Hair Studio.
