# Asfalto GT

Juego de carreras 3D para el navegador, pensado para iPhone en horizontal
(probado para correr en un iPhone 15 Pro Max). No necesita instalación: es una
página web con Three.js (WebGL).

## Cómo jugar en el iPhone

1. Abre la página en Safari y gira el teléfono en horizontal.
2. Para pantalla completa: **Compartir → Agregar a inicio**, y ábrelo desde el ícono.
3. Si no se oye nada, revisa el interruptor de silencio del iPhone.

Para publicarlo con GitHub Pages: *Settings → Pages → Deploy from a branch*,
rama `main`, carpeta `/ (root)`. El juego queda en
`https://<usuario>.github.io/Tinta/carreras/`.

## Controles

| Táctil | Acción |
|---|---|
| Flechas ‹ › (modo Botones) | Girar |
| Deslizar el dedo en la mitad izquierda (modo Deslizar) | Girar con precisión |
| Inclinar el iPhone (modo Inclinar) | Girar como un volante |
| ACELERAR / FRENO | Pedales (puedes deslizar el dedo de uno al otro) |
| Freno de mano | Derrapar |
| Mantener FRENO detenido | Marcha atrás |

Teclado: flechas o WASD, espacio (freno de mano), C (cámara), R (volver a la pista), P (pausa).
También funciona con mandos de PlayStation, Xbox o MFi.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/config.js` | Circuito, datos del auto, rivales y dificultad |
| `src/track.js` | Muestreo de la pista, posición de cada auto, línea de carrera |
| `src/vehicle.js` | Física: neumáticos Pacejka, transferencia de peso, caja, ABS/TC/ESC, choques |
| `src/ai.js` | Pilotos rivales |
| `src/race.js` | Vueltas, posiciones y tiempos |
| `src/world.js` | Escenario: asfalto, pianos, muros, terreno, árboles, tribunas |
| `src/carModel.js` | Modelo 3D del auto generado por código |
| `src/textures.js` | Texturas generadas por código |
| `src/effects.js` | Marcas de derrape, humo, polvo y chispas |
| `src/audio.js` | Motor V8 sintetizado y sonidos |
| `src/camera.js`, `src/input.js`, `src/hud.js` | Cámaras, controles e interfaz |
| `src/main.js` | Arranque y bucle principal |

## Desarrollo local

```sh
npx serve .        # desde la raíz del repositorio
# abrir http://localhost:3000/carreras/
```

`?autopilot` al final de la dirección hace que el auto del jugador se maneje solo.

Versión de un solo archivo (opcional, sin CDN), desde la carpeta `carreras/`:
`npm i --no-save esbuild three@0.186.1 && node tools/build-single.mjs`
