# Repositorio Tinta

Contiene dos proyectos independientes:

- **Raíz (`index.html`, `sw.js`, íconos, manifest):** TINTA, una simulación de fluidos
  Navier–Stokes subida por el dueño. No modificarla salvo que lo pida. Su service worker
  tiene alcance `/Tinta/` pero solo guarda en caché sus propios archivos.
- **`carreras/`:** Asfalto GT, juego de carreras 3D para iPhone (el trabajo principal).

## El dueño y cómo trabajar con él

- Escribe en español: responder en español.
- Antes de cambiar algo, explicar los pasos brevemente; después de generar código,
  explicarlos en detalle. Es científico de datos: en frontend/backend explicar un poco
  más, y las mediciones con números (tablas antes/después) le resultan claras.
- Juega en un iPhone 15 Pro Max (932×430 en horizontal) desde un acceso directo en la
  pantalla de inicio. No podemos probar en un iPhone real: decirlo con honestidad.
- **Flujo acordado:** él juega desde **GitHub Pages**, con un acceso directo al juego en
  su iPhone (`https://nicowalsen.github.io/Tinta/carreras/`, publicado desde `main`).
  Al terminar un cambio: subir la rama asignada, abrir el PR y **darle el link del PR**.
  Él hace el merge desde ese link y prueba en el teléfono (tarda 1–2 min en publicarse,
  más hasta 10 min de caché; cerrar y reabrir el acceso directo). Si el PR anterior ya
  está mergeado, reiniciar la rama desde `main` antes de seguir.
- La versión de claude.ai (https://claude.ai/artifact/KvSNdyQ7dmn4Ph7ovDwwsu, privada)
  es solo una vista previa opcional: no es lo que él usa para jugar.

## Asfalto GT

Estructura por archivo: ver `carreras/README.md`. Three.js r186 por importmap (CDN),
sin paso de compilación para desarrollar. Código y comentarios en español.

Decisiones y números que conviene no perder:

- **Física** (`vehicle.js`, `config.js`): modelo de bicicleta con Pacejka, paso fijo
  1/240 s, ABS/TCS/ESC. Agarre lateral máximo ≈ 10,6–12,8 m/s² según la velocidad.
- **Dirección:** el jugador (`humanSteer`) tiene un tope progresivo medido en simulación
  (margen 5–45 % sobre el ángulo que satura el agarre) y una curva `shapeSteer`
  (expo 0,3) en `input.js`. La IA conserva el tope anterior porque calcula el ángulo
  exacto; si se cambia, revisar que no se sature (tiempo con volante a fondo).
- **Giroscopio:** gravedad fusionada = `accelerationIncludingGravity − acceleration`
  (ignora el movimiento de las manos). Un filtro One Euro se probó y se descartó
  (más retraso sin beneficio). Sensibilidad Suave/Normal/Directo = 34/27/21°.
- **Turbo:** +150 kW; la energía se gasta según la potencia que llega al piso.
  Barra ≈ 5 s, se recarga frenando. La IA lo usa con histéresis.
- **Gráficos:** EffectComposer (Render → SunRays → Bloom → Output). Tope de brillo del
  cielo (`capSky`) y bloom por canal máximo con umbral 13 para evitar velos. Vegetación
  en un solo `InstancedMesh` con atlas procedural (`vegetation.js`). Rayos de sol solo
  con el sol en cuadro. Presupuesto ≈ 260 llamadas de dibujo; calidad baja apaga bloom,
  rayos y MSAA. Resolución adaptativa en modo Auto.
- **Ojo:** nada que dependa de `time * 60` para alternar cuadros (a 30 FPS fijos, modo
  de bajo consumo, la paridad no cambia); usar un contador de cuadros.

## Cómo probar (sin iPhone)

- Servidor estático en una carpeta que contenga `carreras/`: `http-server -p 8765 -c-1`.
- Playwright con el Chromium preinstalado y WebGL por software:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, viewport 932×430,
  `isMobile`/`hasTouch`. Interceptar `cdn.jsdelivr.net/npm/three@0.186.1/**` hacia un
  `node_modules/three` local (`npm i three@0.186.1` en una carpeta temporal).
- API de depuración `window.__asfalto`: `state`, `player`, `race`, `settings`,
  `skipCountdown()`, `warp(seg)` (simula sin dibujar), `camera(i)`, `debug`.
  `?autopilot` hace que la IA maneje el auto del jugador.
- Trampas de SwiftShader: los cuadros son lentos (dt topado en 0,1 s). Esperar
  `state === 'race'` antes de `warp`, leer valores después de que pasen cuadros, y para
  ver partículas de vida corta falsear `requestAnimationFrame` a 60 FPS.
- Física en Node: importar `vehicle.js` con una pista falsa
  (`project`, `surfaceAt`, `crossHeight`).
- Referencia de regresión: carrera de 1 vuelta con `?autopilot` en calidad baja; mejores
  vueltas de la IA ≈ 95,5 / 96,9 / 100,1 / 98,2 s.
- Versión de un solo archivo: `npm i --no-save esbuild three@0.186.1` y
  `node carreras/tools/build-single.mjs --fragment <salida.html>`.

## Ideas pendientes

Ordenadas por recomendación: fantasma de la mejor vuelta con telemetría (velocidad vs.
distancia, puntos de frenada, delta), lluvia y pista mojada, repetición con cámaras de
TV, campeonato, circuito en sentido inverso, atardecer/noche con faros.
Descartadas: vibración (Safari en iOS no lo permite) y multijugador en línea (requiere
un servidor). Detalle menor conocido: en pantallas de 667 px de ancho el velocímetro roza
el pedal de freno.
