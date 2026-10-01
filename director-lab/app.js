import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { SSAOPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/SSAOPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/environments/RoomEnvironment.js/+esm';

const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const canvas=$('#stage'), viewport=$('#viewport'), loading=$('#loading'), bar=$('#progressBar'), detail=$('#loadDetail');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const compact=matchMedia('(max-width:700px)').matches;renderer.setPixelRatio(Math.min(devicePixelRatio,compact?1.15:1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080a0f);scene.fog=new THREE.FogExp2(0x111723,.018);
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;pmrem.dispose();
const camera=new THREE.PerspectiveCamera(50,1,.08,180);camera.position.set(0,4.5,18);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=1.4;controls.maxDistance=70;controls.maxPolarAngle=Math.PI*.49;controls.target.set(0,3,0);
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const ssao=new SSAOPass(scene,camera,1280,720);ssao.kernelRadius=10;ssao.minDistance=.002;ssao.maxDistance=.14;ssao.enabled=!compact;composer.addPass(ssao);const bloom=new UnrealBloomPass(new THREE.Vector2(1280,720),.085,.35,.92);composer.addPass(bloom);composer.addPass(new OutputPass());
const keyLight=new THREE.DirectionalLight(0xe6efff,3.2);keyLight.position.set(-8,18,10);keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.camera.left=-25;keyLight.shadow.camera.right=25;keyLight.shadow.camera.top=25;keyLight.shadow.camera.bottom=-25;scene.add(keyLight);
const warm=new THREE.PointLight(0xffc98b,24,45,1.6);warm.position.set(0,8,-3);scene.add(warm);const hemi=new THREE.HemisphereLight(0x9fb9dd,0x3b2d26,1.15);scene.add(hemi);

const worldRoot=new THREE.Group();scene.add(worldRoot);const botanicRoot=new THREE.Group();scene.add(botanicRoot);const fxRoot=new THREE.Group();scene.add(fxRoot);
let worldBox=new THREE.Box3(new THREE.Vector3(-10,0,-10),new THREE.Vector3(10,10,10)), worldCenter=new THREE.Vector3(), worldSize=new THREE.Vector3(20,10,20), modelReady=false;
let meshList=[], triCount=0, hovered=null, xray=false, tilt=false, mode='orbit', playing=false, playTime=0, energy=.36, selectedRoute='browser';
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(10,10);const hoverBox=new THREE.BoxHelper(new THREE.Object3D(),0x7ce8ff);hoverBox.material.transparent=true;hoverBox.material.opacity=.72;hoverBox.visible=false;scene.add(hoverBox);

function loadProgress(p,msg){bar.style.width=Math.max(4,Math.min(100,p))+'%';detail.textContent=msg}
function toast(msg){const t=$('#globalToast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1200)}
function classifyMesh(name=''){const n=name.toLowerCase();if(/plant|leaf|foliage|ivy|tree/.test(n))return'vegetation';if(/curtain|fabric|cloth|vase|lamp|pot|decoration|flag|drape/.test(n))return'set';return'architecture'}

loadProgress(10,'loading PBR environment');
const loader=new GLTFLoader();
const modelURL='https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Sponza/glTF/Sponza.gltf';
loader.load(modelURL,gltf=>{
  const model=gltf.scene;worldRoot.add(model);loadProgress(66,'normalizing scene scale');
  const b=new THREE.Box3().setFromObject(model), s=b.getSize(new THREE.Vector3()), c=b.getCenter(new THREE.Vector3());
  const scale=32/Math.max(s.x,s.z);model.scale.setScalar(scale);model.position.sub(c.multiplyScalar(scale));
  const nb=new THREE.Box3().setFromObject(model);worldBox.copy(nb);worldBox.getCenter(worldCenter);worldBox.getSize(worldSize);
  meshList=[];triCount=0;model.traverse(o=>{if(o.isMesh){meshList.push(o);o.castShadow=false;o.receiveShadow=true;o.userData.layer=classifyMesh(o.name);if(o.geometry?.index)triCount+=o.geometry.index.count/3;else if(o.geometry?.attributes?.position)triCount+=o.geometry.attributes.position.count/3;if(o.material){o.userData.originalMaterial=o.material;o.material.envMapIntensity=.72;}}});
  $('#meshCount').textContent=meshList.length.toLocaleString('fr-FR');$('#triCount').textContent=Math.round(triCount/1000)+'k';
  buildBotanic();buildParticles();makeShots();modelReady=true;loadProgress(100,'director scene ready');setTimeout(()=>loading.classList.add('hide'),320);toast('PBR world loaded');
},xhr=>{if(xhr.total)loadProgress(10+Math.round(xhr.loaded/xhr.total*48),'streaming textures '+Math.round(xhr.loaded/xhr.total*100)+'%')},err=>{console.error(err);loadProgress(100,'asset network blocked — fallback scene');buildFallback();buildBotanic();buildParticles();makeShots();modelReady=true;setTimeout(()=>loading.classList.add('hide'),320);$('#engineStatus').textContent='FALLBACK MODE'});

function buildFallback(){const m=new THREE.MeshStandardMaterial({color:0x302c29,roughness:.88});const floor=new THREE.Mesh(new THREE.PlaneGeometry(34,22),new THREE.MeshStandardMaterial({color:0x17191d,roughness:1}));floor.rotation.x=-Math.PI/2;worldRoot.add(floor);for(const x of[-12,-6,0,6,12]){const col=new THREE.Mesh(new THREE.CylinderGeometry(.8,.95,9,28),m);col.position.set(x,4.5,0);worldRoot.add(col)}worldSize.set(34,9,22);worldBox.setFromObject(worldRoot);worldBox.getCenter(worldCenter);meshList=worldRoot.children.filter(x=>x.isMesh);$('#meshCount').textContent=meshList.length;$('#triCount').textContent='—'}
function buildBotanic(){botanicRoot.clear();const mat=new THREE.MeshStandardMaterial({color:0x264a37,roughness:.85,side:THREE.DoubleSide});for(let i=0;i<28;i++){const g=new THREE.Group();const stem=new THREE.Mesh(new THREE.CylinderGeometry(.035,.055,1.7,8),new THREE.MeshStandardMaterial({color:0x3c5038,roughness:1}));stem.position.y=.85;g.add(stem);for(let j=0;j<9;j++){const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.46,.18),mat);leaf.position.set((j%2?.18:-.18),.38+j*.13,0);leaf.rotation.set(-.15,Math.PI*(j%2),j%2?.35:-.35);g.add(leaf)}const side=i%2?-1:1;const z=-worldSize.z*.35+(i/27)*worldSize.z*.7;g.position.set(side*(worldSize.x*.42),0,z);g.scale.setScalar(.65+(i%4)*.1);botanicRoot.add(g)}setBotanic(.42)}
function setBotanic(v){const count=Math.max(0,Math.floor(botanicRoot.children.length*v*1.9));botanicRoot.children.forEach((o,i)=>o.visible=i<count)}
function buildParticles(){fxRoot.clear();const n=900,geo=new THREE.BufferGeometry(),pos=new Float32Array(n*3),vel=new Float32Array(n);for(let i=0;i<n;i++){pos[i*3]=(Math.random()-.5)*worldSize.x*1.1;pos[i*3+1]=.2+Math.random()*Math.max(5,worldSize.y*.75);pos[i*3+2]=(Math.random()-.5)*worldSize.z*.92;vel[i]=.3+Math.random()*.9}geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('v',new THREE.BufferAttribute(vel,1));const mat=new THREE.PointsMaterial({color:0xffe6c9,size:.026,transparent:true,opacity:.42,depthWrite:false,sizeAttenuation:true});fxRoot.add(new THREE.Points(geo,mat))}

let shots=[];function makeShots(){const X=worldSize.x*.5,Y=worldSize.y,Z=worldSize.z*.5;shots=[
{name:'01 · Establish',meta:'28 mm · slow push · focus 9.2 m',mm:28,dur:3.1,p0:[0,Y*.33,Z*.88],p1:[0,Y*.30,Z*.54],t:[0,Y*.22,0]},
{name:'02 · Dolly',meta:'35 mm · lateral track · parallax',mm:35,dur:3.2,p0:[-X*.62,Y*.2,Z*.32],p1:[X*.15,Y*.22,Z*.12],t:[0,Y*.18,-Z*.06]},
{name:'03 · Reveal',meta:'40 mm · foreground reveal',mm:40,dur:2.9,p0:[X*.58,Y*.14,Z*.18],p1:[X*.25,Y*.28,-Z*.18],t:[0,Y*.21,0]},
{name:'04 · Orbit',meta:'50 mm · hero orbit · 32°',mm:50,dur:3.1,p0:[X*.36,Y*.30,-Z*.36],p1:[-X*.30,Y*.27,-Z*.42],t:[0,Y*.22,0]},
{name:'05 · Detail',meta:'75 mm · compressed detail',mm:75,dur:2.5,p0:[-X*.26,Y*.18,-Z*.10],p1:[-X*.20,Y*.2,-Z*.24],t:[-X*.02,Y*.18,-Z*.26]},
{name:'06 · Hero',meta:'32 mm · rise + hold',mm:32,dur:3.2,p0:[0,Y*.18,-Z*.46],p1:[0,Y*.45,-Z*.58],t:[0,Y*.23,0]}
];selectShot(0,false)}
function vec(a){return new THREE.Vector3(...a)}
let activeShot=0,targetPos=new THREE.Vector3(),targetLook=new THREE.Vector3();function selectShot(i,animate=true){activeShot=i;const s=shots[i]||{p0:[0,4,18],t:[0,3,0],mm:28,name:'01 · Establish',meta:'28 mm'};targetPos.copy(vec(s.p0));targetLook.copy(vec(s.t));camera.setFocalLength(s.mm);$('#shotName').textContent=s.name;$('#shotMeta').textContent=s.meta;$('#focalSlider').value=s.mm;$('#focalVal').textContent=s.mm+' mm';$$('[data-shot]').forEach((b,n)=>b.classList.toggle('active',n===i));if(!animate){camera.position.copy(targetPos);controls.target.copy(targetLook)}else{mode='director';setModeButtons()}}
$$('[data-shot]').forEach((b,i)=>b.onclick=()=>selectShot(i));

function setModeButtons(){$$('[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode));controls.enabled=mode==='orbit'}
$$('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;setModeButtons();if(mode==='director')selectShot(activeShot);toast(mode.toUpperCase()+' mode')});
const keys=new Set();addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;keys.add(e.key.toLowerCase());if(e.key>='1'&&e.key<='6')selectShot(+e.key-1);if(e.key===' '){e.preventDefault();togglePlay()}});addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
function updateWalk(dt){if(mode!=='walk')return;const speed=(keys.has('shift')?9:4.4)*dt;const f=new THREE.Vector3();camera.getWorldDirection(f);f.y=0;f.normalize();const r=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize();if(keys.has('w'))camera.position.addScaledVector(f,speed);if(keys.has('s'))camera.position.addScaledVector(f,-speed);if(keys.has('a'))camera.position.addScaledVector(r,-speed);if(keys.has('d'))camera.position.addScaledVector(r,speed);controls.target.copy(camera.position).add(f.multiplyScalar(5))}

canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width*2-1;pointer.y=-((e.clientY-r.top)/r.height*2-1)});
function inspect(){if(!modelReady||!meshList.length||!document.querySelector('[data-layer="analysis"] .toggle').classList.contains('on')){hoverBox.visible=false;return}raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(meshList,false)[0];if(hit?.object!==hovered){hovered=hit?.object||null;if(hovered){hoverBox.setFromObject(hovered);hoverBox.visible=true;const nm=hovered.name||'Unnamed mesh';$('#meshName').textContent=nm;$('#meshMeta').textContent=(hovered.userData.layer||'scene')+' · '+(hovered.material?.name||hovered.material?.type||'material');$('#selectionLabel').textContent=nm}else{hoverBox.visible=false;$('#meshName').textContent='Scene intelligence ready';$('#meshMeta').textContent='Raycast + bounds + material semantics';$('#selectionLabel').textContent='hover an object to inspect'}}}

$$('.layer').forEach(el=>el.onclick=()=>{const t=el.querySelector('.toggle');t.classList.toggle('on');const on=t.classList.contains('on'),layer=el.dataset.layer;if(layer==='vegetation')botanicRoot.visible=on;if(layer==='atmosphere')fxRoot.visible=on;if(layer==='analysis'&&!on)hoverBox.visible=false;if(layer==='architecture'||layer==='set')meshList.forEach(m=>{if(m.userData.layer===layer)m.visible=on});toast(layer+' '+(on?'ON':'OFF'))});
$('#xrayBtn').onclick=()=>{xray=!xray;$('#xrayBtn').classList.toggle('active',xray);meshList.forEach(m=>{if(!m.userData.baseMat){m.userData.baseMat=m.material;m.userData.xrayMat=new THREE.MeshBasicMaterial({color:0x91a7ff,wireframe:true,transparent:true,opacity:.12,depthWrite:false})}m.material=xray?m.userData.xrayMat:m.userData.baseMat});$('#renderMode').textContent=xray?'X-RAY / WIREFRAME':'PBR / ACES / SSAO';toast(xray?'X-Ray enabled':'PBR restored')};
$('#tiltBtn').onclick=()=>{tilt=!tilt;$('#tiltBtn').classList.toggle('active',tilt);canvas.style.transform=tilt?'perspective(1200px) rotateX(.6deg) rotateZ(-.35deg) scale(1.012)':'';toast(tilt?'Tilt-shift feel ON':'Tilt OFF')};
$('#resetBtn').onclick=()=>{mode='orbit';setModeButtons();selectShot(0,false);controls.enabled=true;controls.update();toast('Camera reset')};

function timeLighting(v){const t=v/100;const dusk=Math.abs(t-.5)*2;keyLight.intensity=.45+2.9*dusk;warm.intensity=12+28*(1-dusk);hemi.intensity=.45+1.2*dusk;renderer.toneMappingExposure=.76+.4*dusk;const day=new THREE.Color(0x8fa8c8),night=new THREE.Color(0x070a11);scene.background.copy(night).lerp(day,dusk*.42);scene.fog.color.copy(scene.background).lerp(new THREE.Color(0x161d29),.35)}
$('#timeSlider').oninput=e=>{const v=+e.target.value;$('#timeVal').textContent=v+'%';timeLighting(v)};timeLighting(58);
$('#fogSlider').oninput=e=>{const v=+e.target.value;$('#fogVal').textContent=v+'%';scene.fog.density=.004+v*.00065;fxRoot.children[0]&&(fxRoot.children[0].material.opacity=.18+v*.006)};
$('#greenSlider').oninput=e=>{const v=+e.target.value;$('#greenVal').textContent=v+'%';setBotanic(v/100)};
$('#energySlider').oninput=e=>{const v=+e.target.value;$('#energyVal').textContent=v+'%';energy=v/100};
$('#focalSlider').oninput=e=>{const v=+e.target.value;camera.setFocalLength(v);$('#focalVal').textContent=v+' mm'};
$('#exposureSlider').oninput=e=>{const v=+e.target.value/100;renderer.toneMappingExposure=v;$('#exposureVal').textContent=v.toFixed(2)};
$('#focusSlider').oninput=e=>{$('#focusVal').textContent=(+e.target.value/10).toFixed(1)+' m'};

$$('.route-card').forEach(c=>c.onclick=()=>{selectedRoute=c.dataset.route;$$('.route-card').forEach(x=>x.classList.toggle('selected',x===c));$('#routeBtn').textContent='ROUTE: '+selectedRoute.toUpperCase();toast('Production route → '+selectedRoute)});
$('#routeBtn').onclick=()=>{const order=['browser','video','unreal'];selectedRoute=order[(order.indexOf(selectedRoute)+1)%order.length];document.querySelector('.route-card[data-route="'+selectedRoute+'"]').click()};
function runCommand(){const input=$('#commandInput'),q=input.value.trim().toLowerCase();if(!q)return;const log=$('#commandLog');let result='no matching deterministic rule';if(q.includes('nuit')){$('#timeSlider').value=50;$('#timeSlider').dispatchEvent(new Event('input'));result='lighting → night / practicals'}const fm=q.match(/fog\s*(\d+)/);if(fm){$('#fogSlider').value=Math.min(100,+fm[1]);$('#fogSlider').dispatchEvent(new Event('input'));result='fog density → '+fm[1]+'%'}if(q.includes('xray')){$('#xrayBtn').click();result='x-ray toggled'}const names=['establish','dolly','reveal','orbit','detail','hero'];for(let i=0;i<names.length;i++)if(q.includes(names[i])){selectShot(i);result='shot → '+names[i]}if(q.includes('play')){if(!playing)togglePlay();result='director reel → play'}if(q.includes('unreal')){document.querySelector('[data-route="unreal"]').click();result='route → Unreal Premium'}if(q.includes('video')){document.querySelector('[data-route="video"]').click();result='route → Image→Video'}log.innerHTML='<b>director&gt;</b> '+q+'<br><span style="color:#77e2a1">✓ '+result+'</span>';input.value='';toast(result)}
$('#commandRun').onclick=runCommand;$('#commandInput').addEventListener('keydown',e=>{if(e.key==='Enter')runCommand()});
$('#dnaOpen').onclick=()=>$('#drawer').classList.add('open');$('#dnaClose').onclick=()=>$('#drawer').classList.remove('open');$('#drawer').addEventListener('click',e=>{if(e.target===$('#drawer'))$('#drawer').classList.remove('open')});
$('#exportBtn').onclick=()=>{const s=shots[activeShot]||{};const payload={scene:'Atrium Study',shot:s.name,focal_mm:camera.getFocalLength().toFixed(1),route:selectedRoute,camera:{position:camera.position.toArray().map(x=>+x.toFixed(3)),target:controls.target.toArray().map(x=>+x.toFixed(3))},layers:{architecture:true,set:true,vegetation:botanicRoot.visible,atmosphere:fxRoot.visible},continuity:'locked'};navigator.clipboard?.writeText(JSON.stringify(payload,null,2));$('#commandLog').innerHTML='<b>package&gt;</b> '+selectedRoute+'<br><span style="color:#7ce8ff">shot package copied / ready for bridge</span>';toast('Shot package ready')};

const totalDuration=18;function togglePlay(){playing=!playing;$('#playBtn').textContent=playing?'❚❚':'▶';if(playing&&playTime>=totalDuration-.01)playTime=0;if(playing){mode='director';setModeButtons()}}
$('#playBtn').onclick=togglePlay;$('#snapBtn').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.download='squa-shot.png';try{a.href=canvas.toDataURL('image/png');a.click();toast('Frame captured')}catch{toast('Capture blocked by cross-origin asset')}};
function shotAt(t){let a=0;for(let i=0;i<shots.length;i++){const d=shots[i].dur;if(t<a+d)return{i,local:(t-a)/d};a+=d}return{i:shots.length-1,local:1}}
function ease(t){return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2}
function updateReel(dt){if(!playing||!shots.length)return;playTime+=dt;if(playTime>totalDuration){playTime=totalDuration;playing=false;$('#playBtn').textContent='▶'}const {i,local}=shotAt(playTime);if(i!==activeShot){activeShot=i;const s=shots[i];$('#shotName').textContent=s.name;$('#shotMeta').textContent=s.meta;camera.setFocalLength(s.mm);$$('[data-shot]').forEach((b,n)=>b.classList.toggle('active',n===i))}const s=shots[i],k=ease(local),p0=vec(s.p0),p1=vec(s.p1),mid=p0.clone().lerp(p1,.5).add(new THREE.Vector3(0,energy*worldSize.y*.08,0));const curve=new THREE.QuadraticBezierCurve3(p0,mid,p1);camera.position.copy(curve.getPoint(k));const target=vec(s.t);controls.target.lerp(target,.12);camera.lookAt(controls.target);$('#playhead').style.left=(playTime/totalDuration*100)+'%';$('#timecode').textContent='00:00:'+playTime.toFixed(2).padStart(5,'0')}

function resize(){const r=viewport.getBoundingClientRect(),w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));renderer.setSize(w,h,false);composer.setSize(w,h);ssao.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}new ResizeObserver(resize).observe(viewport);resize();
let last=performance.now(),frames=0,ft=last;function loop(now){requestAnimationFrame(loop);const dt=Math.min(.05,(now-last)/1000);last=now;updateWalk(dt);updateReel(dt);if(mode==='director'&&!playing){camera.position.lerp(targetPos,1-Math.pow(.001,dt));controls.target.lerp(targetLook,1-Math.pow(.001,dt))}if(fxRoot.children[0]){const p=fxRoot.children[0].geometry.attributes.position.array;for(let i=1;i<p.length;i+=3){p[i]+=dt*(.02+energy*.08);if(p[i]>worldSize.y*.75)p[i]=.1}fxRoot.children[0].geometry.attributes.position.needsUpdate=true;fxRoot.rotation.y+=dt*.006*(.5+energy)}controls.update();inspect();composer.render();frames++;if(now-ft>750){$('#fps').textContent=Math.round(frames*1000/(now-ft))+' FPS';frames=0;ft=now}const n=$('#mapCam');n.style.left=(48+Math.sin(now*.0002)*5)+'%';n.style.top=(48+Math.cos(now*.00016)*4)+'%'}requestAnimationFrame(loop);
const worldBtn=$('#worldBtn'),toolsBtn=$('#toolsBtn'),leftPanel=$('#leftPanel'),rightPanel=document.querySelector('.right');
if(worldBtn)worldBtn.onclick=()=>{leftPanel.classList.toggle('mobile-open');rightPanel?.classList.remove('mobile-open')};
if(toolsBtn)toolsBtn.onclick=()=>{rightPanel?.classList.toggle('mobile-open');leftPanel.classList.remove('mobile-open')};
