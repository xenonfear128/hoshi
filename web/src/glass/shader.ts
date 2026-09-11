// Adapted from martin65536/liquid-glass-webgl (Apache-2.0).
// See vendor/NOTICE.md for provenance and modifications.
import { SDF_GLSL } from "./vendor/sdf";
export const vertex = `attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.,1.);}`;
export const fragment = `precision highp float;
uniform vec2 uSize;
uniform vec2 uViewport;
uniform vec2 uOffset;
uniform float uDpr;
uniform vec4 uRadii;
uniform float uOpenBottom;
uniform float uLight;
uniform float uMaterial;
uniform float uTime;
uniform sampler2D uScene;
${SDF_GLSL}
float circleMap(float x) { return 1.0-sqrt(max(0.0,1.0-x*x)); }
vec3 backdrop(vec2 p, float radius) {
  vec2 uv=vec2(p.x/uViewport.x,1.-p.y/uViewport.y);
  vec2 px=vec2(1.)/uViewport*radius;
  vec3 color=vec3(0.);
  float total=0.;
  for(int y=-2;y<=2;y++) {
    for(int x=-2;x<=2;x++) {
      vec2 p=vec2(float(x),float(y));
      float weight=exp(-dot(p,p)*.5);
      color+=texture2D(uScene,uv+px*p*.6).rgb*weight;
      total+=weight;
    }
  }
  return color/total;
}
void main(){
  vec2 local=vec2(gl_FragCoord.x/uDpr,uSize.y-gl_FragCoord.y/uDpr);
  vec2 halfSize=uSize*.5;
  vec2 centered=local-halfSize;
  float radius=min(radiusAt(centered,uRadii),min(halfSize.x,halfSize.y));
  // An editing sheet continues into the keyboard's occluded area. Its lower
  // half has side edges only, so no rounded bottom or horizontal optical rim
  // is painted across the last visible line of the form.
  bool openEdge=uOpenBottom>.5 && centered.y>0.;
  float sd=openEdge ? abs(centered.x)-halfSize.x : sdShape(centered,halfSize,radius);
  float aa=.65/uDpr;
  if(sd>aa) discard;
  float depth=max(-sd,0.);
  // All directional optics vanish before the medial axis, where a distance
  // field's nearest edge changes abruptly. Lighting that axis draws >--<.
  float bevel=max(1.,min(9.,min(radius*.55,min(halfSize.x,halfSize.y)*.28)));
  float rim=1.-smoothstep(0.,bevel,depth);
  float d=circleMap(rim)*mix(7.,11.,uMaterial);
  vec2 grad=openEdge ? vec2(sign(centered.x),0.) : gradSdShape(centered,halfSize,radius);
  vec2 screen=uOffset+local;
  float blurRadius=mix(8.,14.,uMaterial)*mix(1.,.42,rim);
  vec3 color=vec3(
    backdrop(screen+grad*(d*1.08+rim*.25),blurRadius).r,
    backdrop(screen+grad*d,blurRadius).g,
    backdrop(screen+grad*(d*.92-rim*.25),blurRadius).b
  );
  vec3 tint=mix(vec3(.23,.25,.29),vec3(.985,.985,.995),uLight);
  float tintAmount=mix(.26,.44,uLight)-uMaterial*.04;
  color=mix(color,tint,clamp(tintAmount,0.2,0.7));
  float edge=exp(-pow(depth/1.25,2.));
  float inner=rim*(1.-edge);
  float fresnel=pow(1.0-max(0.0,dot(normalize(vec3(grad*rim,1.0)),vec3(0.,0.,1.))),2.0);
  float lightDir=dot(grad,normalize(vec2(-.72,-.9)))*.5+.5;
  float shine=pow(max(0.0,lightDir),3.5);
  float opposite=pow(max(0.,1.-lightDir),5.);
  // Joined, square panels need a restrained rim; rounded floating surfaces
  // receive the full highlight so workspace seams do not become wireframes.
  float outlineStrength=mix(.28,1.,smoothstep(0.,8.,radius));
  color+=outlineStrength*(edge*(.06+shine*.42+opposite*.14)+rim*shine*.075+fresnel*.14);
  color-=inner*(.032+uMaterial*.016);
  float coverage=1.-smoothstep(-aa,aa,sd);
  gl_FragColor=vec4(clamp(color,0.,1.)*coverage,coverage);
}`;
