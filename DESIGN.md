# Touché Hair Studio — Sistema Visual (Agenda de Clientas)

Hereda la identidad oficial del Manual de Marca de Touché Hair Studio y la adapta a una experiencia boutique móvil-primero.

## Paleta
- Lienzo principal: `#ffffff`
- Superficies destacadas / pie cálido: `#f9efe8`
- Tinta principal (carbón): `#3e3e3e`
- Tinta secundaria: `#675e58`
- Borde beige: `#dec4ab` / `#e6d6c8`
- Arcilla Touché (acento): `#ac6660`
- Arcilla de acción (contraste WCAG AA sobre blanco): `#96504a` (hover `#7f403b`)
- Tinte suave de selección: `#f8ecea`

## Tipografía
- **Montserrat** variable alojada localmente (`/brand/montserrat-0.woff2`, pesos 400–700).
- Cifras tabulares (`tabular-nums`) para horas, fechas, duraciones, precios referenciales y códigos de reserva.
- Jerarquía estricta sin saltos (`h1` → `h2` → `h3`), sin etiquetas tipo *eyebrow* sobre títulos.

## Ergonomía móvil y movimiento
- Diseñada primero para celulares de 360px–430px (un pulgar, objetivos táctiles ≥ 44px, barra de acción inferior con `env(safe-area-inset-bottom)`).
- Personalidad de movimiento **editorial boutique**: curva `cubic-bezier(0.2, 0, 0, 1)`, 140ms en respuesta táctil, 240ms en cambio de paso, 360ms en comprobante final.
- Animaciones exclusivamente en compositor (`transform`, `opacity`) y degradación escalonada bajo `prefers-reduced-motion: reduce`.
- Iconografía limpia de Phosphor Icons (SVG locales, sin emojis como iconos de interfaz).
