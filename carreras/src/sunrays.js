// Rayos de sol (dispersión volumétrica en pantalla) + resplandor y reflejos
// de lente sutiles. Funciona sobre la imagen HDR antes del bloom:
//  1) máscara: solo el cielo muy brillante alrededor del sol (lo que tapa el
//     sol —árboles, tribunas, autos— queda oscuro);
//  2) desenfoque radial hacia el sol a 1/4 de resolución → rayos;
//  3) composición aditiva. Si algo tapa el disco, el resplandor y los
//     reflejos de lente se apagan solos (sin lecturas a la CPU).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

const MASK = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uSun;
  uniform vec2 uTexel;
  uniform float uAspect;
  uniform float uThreshold;
  varying vec2 vUv;
  vec3 tap( vec2 o ) { return texture2D( tDiffuse, vUv + o * uTexel ).rgb; }
  void main() {
    vec3 c = ( tap( vec2( -1.5, -1.5 ) ) + tap( vec2( 1.5, -1.5 ) ) + tap( vec2( -1.5, 1.5 ) ) + tap( vec2( 1.5, 1.5 ) ) ) * 0.25;
    c = min( c, vec3( 40.0 ) );
    float lum = max( c.r, max( c.g, c.b ) );
    float m = clamp( ( lum - uThreshold ) / uThreshold, 0.0, 2.0 );
    vec2 d = ( vUv - uSun ) * vec2( uAspect, 1.0 );
    float fall = exp( -dot( d, d ) * 9.0 );
    gl_FragColor = vec4( c / max( lum, 1e-3 ) * m * fall, 1.0 );
  }`;

const RAYS = /* glsl */`
  uniform sampler2D tMask;
  uniform vec2 uSun;
  varying vec2 vUv;
  #define N 40
  void main() {
    vec2 delta = ( uSun - vUv ) * ( 0.95 / float( N ) );
    vec2 uv = vUv;
    float decay = 1.0;
    vec3 acc = vec3( 0.0 );
    for ( int i = 0; i < N; i++ ) {
      uv += delta;
      acc += texture2D( tMask, uv ).rgb * decay;
      decay *= 0.963;
    }
    gl_FragColor = vec4( acc * ( 2.2 / float( N ) ), 1.0 );
  }`;

const COMP = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tRays;
  uniform sampler2D tMask;
  uniform vec2 uSun;
  uniform float uAspect;
  uniform float uVis;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  float ghost( vec2 p, vec2 c, float r ) {
    vec2 d = ( p - c ) * vec2( uAspect, 1.0 );
    return smoothstep( r, r * 0.55, length( d ) );
  }
  void main() {
    vec4 base = texture2D( tDiffuse, vUv );
    vec3 rays = texture2D( tRays, vUv ).rgb;
    // ¿Se ve el disco del sol? (promedio de la máscara alrededor del sol)
    float sv = 0.0;
    sv += texture2D( tMask, uSun ).g;
    sv += texture2D( tMask, uSun + vec2( 0.012, 0.0 ) ).g;
    sv += texture2D( tMask, uSun - vec2( 0.012, 0.0 ) ).g;
    sv += texture2D( tMask, uSun + vec2( 0.0, 0.02 ) ).g;
    sv += texture2D( tMask, uSun - vec2( 0.0, 0.02 ) ).g;
    sv = clamp( sv * 0.22, 0.0, 1.0 );
    vec2 d = ( vUv - uSun ) * vec2( uAspect, 1.0 );
    float r = length( d );
    vec3 glare = uColor * ( exp( -r * 12.0 ) * 0.5 + exp( -r * 3.5 ) * 0.045 ) * sv;
    // reflejos de lente: pequeños fantasmas sobre el eje sol → centro
    vec2 axis = vec2( 0.5 ) - uSun;
    vec3 g = vec3( 0.0 );
    g += vec3( 1.0, 0.7, 0.35 ) * ghost( vUv, uSun + axis * 0.7, 0.03 ) * 0.07;
    g += vec3( 0.35, 0.8, 0.7 ) * ghost( vUv, uSun + axis * 1.25, 0.055 ) * 0.05;
    g += vec3( 0.6, 0.45, 1.0 ) * ghost( vUv, uSun + axis * 1.6, 0.022 ) * 0.08;
    g += vec3( 1.0, 0.9, 0.7 ) * ghost( vUv, uSun + axis * 2.1, 0.09 ) * 0.035;
    vec3 add = rays * uColor * uIntensity + glare + g * sv;
    gl_FragColor = vec4( base.rgb + add * uVis, base.a );
  }`;

export class SunRaysPass extends Pass {
  constructor({ scale = 0.25, intensity = 0.42 } = {}) {
    super();
    this.scale = scale;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.raysRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.visibility = 0;
    const sun = { value: new THREE.Vector2(0.5, 0.5) };
    const aspect = { value: 1 };
    this.u = { sun, aspect };
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: sun, uTexel: { value: new THREE.Vector2(1, 1) }, uAspect: aspect, uThreshold: { value: 3.0 } },
      vertexShader: VERT, fragmentShader: MASK, depthTest: false, depthWrite: false,
    });
    this.raysMat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: this.maskRT.texture }, uSun: sun },
      vertexShader: VERT, fragmentShader: RAYS, depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tRays: { value: this.raysRT.texture }, tMask: { value: this.maskRT.texture },
        uSun: sun, uAspect: aspect, uVis: { value: 0 }, uIntensity: { value: intensity },
        uColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
      },
      vertexShader: VERT, fragmentShader: COMP, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(null);
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  setSize(w, h) {
    const sw = Math.max(1, Math.round(w * this.scale)), sh = Math.max(1, Math.round(h * this.scale));
    this.maskRT.setSize(sw, sh);
    this.raysRT.setSize(sw, sh);
    this.maskMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.u.aspect.value = w / h;
  }

  // Posición del sol en pantalla y cuánto se ve (0 = detrás o lejos del encuadre).
  update(camera, sunDir) {
    const f = this._f.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = f.dot(sunDir);
    const p = this._v.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const vis = facing <= 0.05 ? 0 : Math.min(1, (facing - 0.05) / 0.25) * Math.max(0, Math.min(1, (1.7 - edge) / 0.7));
    this.visibility = vis;
    this.u.sun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.compMat.uniforms.uVis.value = vis;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.maskRT);
    this.quad.material = this.maskMat;
    this.quad.render(renderer);

    renderer.setRenderTarget(this.raysRT);
    this.quad.material = this.raysMat;
    this.quad.render(renderer);

    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.material = this.compMat;
    this.quad.render(renderer);
  }

  dispose() {
    this.maskRT.dispose(); this.raysRT.dispose();
    this.maskMat.dispose(); this.raysMat.dispose(); this.compMat.dispose();
    this.quad.dispose();
  }
}
