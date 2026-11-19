# Touché Hair Studio — Sistema Visual (Agenda de Clientas estilo Calendly)

Combina la identidad oficial del Manual de Marca de Touché Hair Studio con la claridad estructural de reservas de Calendly (observada vía REA en `research/calendly-booking-analysis.md`) y criterios de accesibilidad pensados también para personas mayores.

## Paleta
- Lienzo principal: `#ffffff`
- Superficies destacadas / resumen / alertas cálidas: `#f9efe8` y `#fdf4ef`
- Tinta principal (alto contraste AAA): `#2e2a28` / `#3e3e3e`
- Tinta secundaria legible: `#59514b`
- Borde claro / borde interactivo: `#e4d5c7` / `#c9b3a0`
- Arcilla Touché (acento y decoración): `#ac6660`
- Arcilla de acción (contraste WCAG AA/AAA): `#96504a` (hover `#7d3f3a`)
- Círculo suave de día disponible (estilo Calendly): `#f6e4e1` con tinta `#843f39`
- Aviso de precio referencial: fondo `#fff6ea`, borde `#d9a45b`, tinta `#5c3b09`
- Gratis / confirmación: fondo `#eaf5ee`, borde `#9ac7ab`, tinta `#1f5734`

## Tipografía y accesibilidad para personas mayores
- **Montserrat** variable alojada localmente (`/brand/montserrat-0.woff2`, pesos 400–700).
- Texto base cómodo (`16px`–`17px`), botones grandes (`min-height: 52px–58px`), objetivos táctiles amplios y etiquetas siempre explícitas con texto (nunca iconos misteriosos sin etiqueta).
- Cifras tabulares (`tabular-nums`) para fechas, horas, duraciones, precios y códigos de reserva.
- Jerarquía estricta sin saltos (`h1` → `h2` → `h3`).

## Estructura estilo Calendly + auto-desplazamiento guiado
- **Escritorio (`≥ 900px`)**: tarjeta elevada de dos columnas — panel izquierdo fijo con la marca Touché, ubicación en Surquillo, resumen vivo paso a paso y recordatorio del precio referencial; columna derecha con el flujo progresivo guiado.
- **Móvil (`< 900px`)**: una sola columna con barra superior de progreso y tarjetas numeradas grandes.
- **Auto-scroll suave**: cada vez que la clienta elige una categoría, servicio, especialista, día u hora, la siguiente sección aparece inmediatamente abajo y la vista baja suavemente hasta la acción siguiente (`scroll-margin-top` evita cortes con la barra fija; respeta `prefers-reduced-motion: reduce`).
