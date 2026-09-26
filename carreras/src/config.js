// Parámetros globales del juego: circuito, auto, reglas de carrera.
// Unidades: metros, segundos, kilogramos, newtons.

export const TRACK = {
  name: 'Circuito del Valle',
  // Puntos de control [x, z, altura]. La curva pasa por ellos (Catmull-Rom cerrada).
  points: [
    [-120, 0, 0], [330, 0, 0], [400, 12, 0], [428, 60, 1], [430, 200, 3],
    [470, 290, 6], [560, 330, 9], [640, 400, 12], [690, 480, 15], [700, 545, 17],
    [660, 585, 18], [600, 560, 17], [520, 505, 14], [380, 480, 10], [220, 520, 7],
    [100, 552, 5], [45, 540, 5], [5, 562, 4], [-30, 592, 4], [-90, 600, 4],
    [-250, 540, 3], [-400, 470, 2], [-490, 430, 1], [-540, 340, 0], [-535, 160, 0],
    [-470, 40, 0], [-330, 4, 0],
  ],
  elevScale: 1.5,     // exagera un poco los desniveles
  spacing: 2,         // metros entre muestras de la pista
  roadHalf: 6.5,      // medio ancho del asfalto (13 m en total)
  curbWidth: 1.3,     // ancho de los pianos
  wallOffset: 16,     // distancia del muro al eje de la pista
};

export const CAR = {
  mass: 1400,
  inertia: 2350,        // momento de inercia en guiñada (kg·m²)
  cgToFront: 1.30,      // centro de gravedad → eje delantero
  cgToRear: 1.35,       // centro de gravedad → eje trasero
  cgHeight: 0.48,
  halfTrack: 0.83,      // mitad de la trocha
  wheelRadius: 0.34,
  length: 4.5,
  width: 1.96,
  mu: 1.10,             // adherencia de neumáticos deportivos en asfalto seco
  gripFront: 1.0,
  gripRear: 1.07,       // traseros más anchos: el auto tiende a subvirar (estable)
  drag: 0.42,           // ½·ρ·Cd·A
  downforce: 0.75,      // ½·ρ·Cl·A
  rolling: 170,         // resistencia a la rodadura (N)
  // Curva de par motor [rpm, N·m]
  torque: [[800, 260], [1500, 330], [2500, 425], [3500, 495], [4500, 540],
           [5500, 550], [6500, 530], [7400, 490], [8000, 430]],
  gears: [3.35, 2.25, 1.68, 1.32, 1.08, 0.90],
  reverse: 3.2,
  final: 3.55,
  efficiency: 0.88,
  idle: 950,
  redline: 7800,
  limiter: 8000,
  upshift: 7450,
  downshift: 3900,
  brakeForce: 1.35,     // fuerza máxima de frenado en múltiplos de m·g
  brakeBias: 0.62,      // reparto delantero
  maxSteer: 0.62,       // ángulo máximo de las ruedas (rad)
  steerSpeed: 3.4,      // velocidad de giro del volante (rad/s)
};

export const RACE = {
  cars: 6,
  playerSlot: 4,        // sale 5º en la parrilla
  gridSpacing: 8,
  gridLateral: 2.6,
};

export const DRIVERS = [
  { name: 'Vega', color: 0x1f5fd6 },
  { name: 'Okafor', color: 0x16181c },
  { name: 'Lindqvist', color: 0xf2f2ee },
  { name: 'Tanaka', color: 0xf0b313 },
  { name: 'Moreau', color: 0x2f8f4e },
  { name: 'Salas', color: 0x7a2fd0 },
];

export const PLAYER_COLORS = [
  { id: 'rojo', hex: 0xc4121c, label: 'Rojo' },
  { id: 'azul', hex: 0x1d4fb8, label: 'Azul' },
  { id: 'amarillo', hex: 0xf2b705, label: 'Amarillo' },
  { id: 'verde', hex: 0x1f6b3a, label: 'Verde' },
  { id: 'gris', hex: 0x6d737a, label: 'Gris' },
  { id: 'blanco', hex: 0xe9ebe6, label: 'Blanco' },
];

export const DIFFICULTY = {
  facil: { skill: 0.82, label: 'Fácil' },
  normal: { skill: 0.885, label: 'Normal' },
  pro: { skill: 0.94, label: 'Pro' },
};
