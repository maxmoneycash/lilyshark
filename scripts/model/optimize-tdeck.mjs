#!/usr/bin/env node
/** Reproducible web derivative. The approved CAD/master GLB is read-only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [source, destination, dependencies] = process.argv.slice(2);
if (!source || !destination || !dependencies) throw new Error('Usage: node optimize-tdeck.mjs MASTER.glb OUTPUT.glb TEMP_NPM_PREFIX');
const require = createRequire(path.join(path.resolve(dependencies), 'package.json'));
const load = (name) => import(pathToFileURL(require.resolve(name)));
const { NodeIO, PropertyType } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } = await load('@gltf-transform/extensions');
const { reorder, dedup, prune } = await load('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await load('meshoptimizer');
const { default: sharp } = await load('sharp');
const validator = require('gltf-validator');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(source);
const root = document.getRoot();
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sourceBytes = await fs.readFile(source);
const report = { source: path.basename(source), sourceSHA256: hash(sourceBytes), sourceBytes: sourceBytes.length, changes: [], textures: [] };

// Oriented triangle signatures compare positions AND normals bit-for-bit despite index reordering.
function geometrySignature(doc) {
  return Object.fromEntries(doc.getRoot().listMeshes().map((mesh) => [mesh.getName(), mesh.listPrimitives().map((p) => {
    const position=p.getAttribute('POSITION').getArray();
    const normal=p.getAttribute('NORMAL')?.getArray();
    const indexes=p.getIndices()?.getArray() || Uint32Array.from({length:position.length/3},(_,i)=>i);
    const vertex=(i)=>[...position.slice(i*3,i*3+3),...(normal?normal.slice(i*3,i*3+3):[])].map(v=>Object.is(v,-0)?'0':String(v)).join(',');
    const vertices=Array.from({length:position.length/3},(_,i)=>vertex(i));
    const triangles=[];
    for(let i=0;i<indexes.length;i+=3) {
      const v=[vertices[indexes[i]],vertices[indexes[i+1]],vertices[indexes[i+2]]];
      triangles.push([v.join('|'),[v[1],v[2],v[0]].join('|'),[v[2],v[0],v[1]].join('|')].sort()[0]);
    }
    return {triangles:indexes.length/3, signature:hash(triangles.sort().join('\n'))};
  })]));
}
const beforeSignature=geometrySignature(document);
const lcd = root.listNodes().find(n=>n.getName()==='LCD glass');
const lcdMaterial=root.listMaterials().find(m=>m.getName()==='LCD display');
if(!lcd || !lcdMaterial) throw new Error('Master LCD lookup changed. Stop rather than silently lose the live screen.');
for(const primitive of lcd.getMesh().listPrimitives()) {
  const localUV=primitive.getAttribute('TEXCOORD_1');
  if(!localUV) throw new Error('Missing measured 0..1 LCD UV layer.');
  const cleanUV=localUV.clone();
  const values=cleanUV.getArray().slice();
  for(let i=0;i<values.length;i++) {if(Math.abs(values[i])<1e-6)values[i]=0;else if(Math.abs(values[i]-1)<1e-6)values[i]=1;}
  cleanUV.setArray(values);
  primitive.setAttribute('TEXCOORD_0',cleanUV);
  primitive.setAttribute('TEXCOORD_1',null);
}
lcdMaterial.getBaseColorTextureInfo().setTexCoord(0);
lcdMaterial.getEmissiveTextureInfo().setTexCoord(0);
report.changes.push('LCD local 0..1 UVs moved to TEXCOORD_0; LCD node/material names retained.');

// The master embeds a complete 3024x4032 photo to texture a ~3 mm screw.
// Crop only the texels referenced by that material; preserve source pixels exactly.
const screw=root.listMaterials().find(m=>m.getName()==='Rear_Screw_Photograph');
const screwTexture=screw.getBaseColorTexture();
const originalPhoto=Buffer.from(screwTexture.getImage());
const meta=await sharp(originalPhoto).metadata();
const semantic=`TEXCOORD_${screw.getBaseColorTextureInfo().getTexCoord()}`;
const screwPrimitives=root.listMeshes().flatMap(m=>m.listPrimitives()).filter(p=>p.getMaterial()===screw);
const range=[Infinity,Infinity,-Infinity,-Infinity];
for(const p of screwPrimitives) {
 const a=p.getAttribute(semantic).getArray();
 for(let i=0;i<a.length;i+=2) {range[0]=Math.min(range[0],a[i]);range[1]=Math.min(range[1],a[i+1]);range[2]=Math.max(range[2],a[i]);range[3]=Math.max(range[3],a[i+1]);}
}
const left=Math.max(0,Math.floor(range[0]*meta.width)-16), top=Math.max(0,Math.floor(range[1]*meta.height)-16);
const right=Math.min(meta.width,Math.ceil(range[2]*meta.width)+16), bottom=Math.min(meta.height,Math.ceil(range[3]*meta.height)+16);
const crop={left,top,width:right-left,height:bottom-top};
screwTexture.setImage(await sharp(originalPhoto).extract(crop).png().toBuffer()).setMimeType('image/png').setName('Rear screw photo crop');
for(const p of screwPrimitives) {
 const uv=p.getAttribute(semantic).clone();const a=uv.getArray().slice();
 for(let i=0;i<a.length;i+=2) {a[i]=(a[i]*meta.width-left)/crop.width;a[i+1]=(a[i+1]*meta.height-top)/crop.height;}
 uv.setArray(a);p.setAttribute(semantic,uv);
}
report.screwCrop={originalSize:[meta.width,meta.height],crop,originalBytes:originalPhoto.length,croppedBytes:screwTexture.getImage().byteLength};
report.changes.push('Rear screw texture cropped to its used UV rectangle with a 16-pixel mipmap gutter; no source pixels resampled.');

// Preserve small print and screen pixels losslessly. Broad source photographs
// use high-quality WebP at their original resolution, without mesh simplification.
document.createExtension(EXTTextureWebP).setRequired(true);
for(const texture of root.listTextures()) {
 const input=Buffer.from(texture.getImage());const info=await sharp(input).metadata();
 const broadPhoto=['back_albedo','front_base_without_keys'].includes(texture.getName());
 const keepPNG=texture.getName()==='display';
 const encoded=keepPNG?input:await sharp(input).webp(broadPhoto?{quality:98,effort:6,smartSubsample:true}:{lossless:true,effort:6}).toBuffer();
 texture.setImage(encoded).setMimeType(keepPNG?'image/png':'image/webp');
 const row={name:texture.getName(),size:[info.width,info.height],sourceBytes:input.length,outputBytes:encoded.length,encoding:keepPNG?'PNG unchanged':broadPhoto?'WebP quality 98':'WebP lossless'};
 if(broadPhoto) {
  const a=await sharp(input).removeAlpha().raw().toBuffer();const b=await sharp(encoded).removeAlpha().raw().toBuffer();
  let sse=0,maxError=0;for(let i=0;i<a.length;i++){const e=Math.abs(a[i]-b[i]);sse+=e*e;maxError=Math.max(maxError,e);}
  row.rmse=Math.sqrt(sse/a.length);row.psnrDB=20*Math.log10(255/row.rmse);row.maxChannelError=maxError;
 }
 report.textures.push(row);console.log('TEXTURE',row.name,input.length,'->',encoded.length);
}
await document.transform(
 dedup({propertyTypes:[PropertyType.ACCESSOR,PropertyType.TEXTURE],keepUniqueNames:true}),
 reorder({encoder:MeshoptEncoder,target:'size',cleanup:false}),
 prune({keepLeaves:true,keepAttributes:false,keepSolidTextures:true,keepExtras:true})
);
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
// No quantize() transform: this meshopt mode encodes original float arrays losslessly.
await fs.mkdir(path.dirname(destination),{recursive:true});
await io.write(destination,document);
const outputBytes=await fs.readFile(destination);const decoded=await io.read(destination);
const afterSignature=geometrySignature(decoded);
if(JSON.stringify(beforeSignature)!==JSON.stringify(afterSignature)) throw new Error('Decoded positions, normals, oriented triangles, or mesh names differ from master.');
report.geometry={meshes:root.listMeshes().length,triangles:Object.values(beforeSignature).flat().reduce((n,p)=>n+p.triangles,0),losslessPositionsNormalsAndTopology:true,meshDecimation:false,positionQuantization:false};
report.outputBytes=outputBytes.length;report.outputSHA256=hash(outputBytes);report.reductionPercent=100*(1-outputBytes.length/sourceBytes.length);
function bounds(nodes){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const n of nodes){const matrix=n.getWorldMatrix();for(const p of n.getMesh()?.listPrimitives()||[]){const a=p.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i+=3){const v=[0,1,2].map(j=>matrix[j]*a[i]+matrix[4+j]*a[i+1]+matrix[8+j]*a[i+2]+matrix[12+j]);for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],v[j]);hi[j]=Math.max(hi[j],v[j]);}}}}return{min:lo,max:hi,size:hi.map((v,i)=>v-lo[i])};}
report.axes={units:'meters',front:'+Y',topAndAntenna:'-Z',threeUprightRotationX:Math.PI/2};
report.bounds={assembly:bounds(decoded.getRoot().listNodes()),handset:bounds(decoded.getRoot().listNodes().filter(n=>!/(Antenna|SMA)/i.test(n.getName()))),lcd:bounds(decoded.getRoot().listNodes().filter(n=>n.getName()==='LCD glass'))};
const screen=decoded.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).find(p=>p.getMaterial()?.getName()==='LCD display');
const uv=screen.getAttribute('TEXCOORD_0').getArray();const u=[],v=[];for(let i=0;i<uv.length;i+=2){u.push(uv[i]);v.push(uv[i+1]);}
report.screen={node:'LCD glass',material:'LCD display',textureCoordinate:'TEXCOORD_0',uvBounds:[[Math.min(...u),Math.max(...u)],[Math.min(...v),Math.max(...v)]],textureFlipY:false};
if(JSON.stringify(report.screen.uvBounds)!=='[[0,1],[0,1]]')throw new Error('LCD UV range changed.');
const rawValidation=await validator.validateBytes(new Uint8Array(outputBytes),{uri:path.basename(destination),maxIssues:100});
await fs.writeFile(path.join(path.dirname(destination),'validation.json'),JSON.stringify(rawValidation,null,2)+'\n');
// The validator cannot inspect meshopt/WebP payloads. Decode both to core glTF
// for a second semantic validation of all accessor and pixel resources.
for(const extension of decoded.getRoot().listExtensionsUsed())if(['EXT_meshopt_compression','EXT_texture_webp'].includes(extension.extensionName))extension.dispose();
for(const texture of decoded.getRoot().listTextures())if(texture.getMimeType()==='image/webp')texture.setImage(await sharp(Buffer.from(texture.getImage())).png().toBuffer()).setMimeType('image/png');
const expanded=await io.writeBinary(decoded);
const decodedValidation=await validator.validateBytes(expanded,{uri:'model-decoded-for-validation.glb',maxIssues:100});
await fs.writeFile(path.join(path.dirname(destination),'validation-decoded.json'),JSON.stringify(decodedValidation,null,2)+'\n');
report.validation={compressed:{errors:rawValidation.issues.numErrors,warnings:rawValidation.issues.numWarnings,infos:rawValidation.issues.numInfos},decoded:{errors:decodedValidation.issues.numErrors,warnings:decodedValidation.issues.numWarnings,infos:decodedValidation.issues.numInfos}};
await fs.writeFile(path.join(path.dirname(destination),'optimization.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({bytes:report.outputBytes,reduction:report.reductionPercent,geometry:report.geometry,screen:report.screen,validation:report.validation},null,2));
if(rawValidation.issues.numErrors || decodedValidation.issues.numErrors)throw new Error('Khronos validation failed; see reports.');
