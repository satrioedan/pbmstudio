import { randomUUID } from 'node:crypto'
import { WEBHOOK_TOKEN } from './config.js'
import { store } from './store.js'
const BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '')
const PUBLIC = (process.env.PUBLIC_URL || 'https://ulas.tech').replace(/\/$/, '')
const models = ['V4','V4_5','V4_5PLUS','V4_5ALL','V5','V5_5']
export function coverBody(input, uploadUrl) {
 const model = models.includes(input.model) ? input.model : 'V4_5PLUS'
 const instrumental = !!input.instrumental
 const customMode = instrumental || !!String(input.prompt || '').trim()
 const body = {uploadUrl, model, instrumental, customMode, callBackUrl:`${PUBLIC}/api/webhooks/kie?t=${WEBHOOK_TOKEN}`}
 if(customMode){
  body.title = String(input.title || 'Cover').slice(0,80)
  body.style = String(input.style || 'Pop').slice(0,model==='V4'?200:1000)
  if(!instrumental) body.prompt = String(input.prompt).slice(0,model==='V4'?3000:5000)
 } else body.prompt = String(input.style || input.title || 'Music').slice(0,500)
 if(input.vocalGender==='male')body.vocalGender='m'
 if(input.vocalGender==='female')body.vocalGender='f'
 if(input.negativeTags)body.negativeTags=String(input.negativeTags).slice(0,500)
 if(input.audioWeight != null && input.audioWeight !== ''){
  const weight=Number(input.audioWeight)
  if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error('Audio Weight harus antara 0 dan 1')
  body.audioWeight=Math.round(weight*100)/100
 }
 return body
}
export async function kieUploadCover(input) {
 // Validate before uploading or creating a paid task.
 coverBody(input,'https://example.invalid/audio')
 const keys=store.getKieRawKeys?.() || []
 const pool=keys.length?keys:(process.env.KIE_API_KEY?[{id:'env',key:process.env.KIE_API_KEY}]:[])
 if(!pool.length)throw new Error('Belum ada API key KIE. Tambahkan di Pengaturan bagian KIE AI.')
 const start=(store.getKieKeyCursor?.()||0)%pool.length
 let last=''
 for(let i=0;i<pool.length;i++){
  const idx=(start+i)%pool.length;const {id,key}=pool[idx]
  let uploadUrl=input.uploadUrl
  if(!uploadUrl){
   const bytes=Buffer.from(String(input.base64Data||'').replace(/^data:[^;]+;base64,/,''),'base64')
   if(!bytes.length)throw new Error('File audio kosong atau tidak valid')
   const extension=String(input.fileName||'audio.mp3').split('.').pop().toLowerCase()
   const mime={mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac'}[extension]||'application/octet-stream'
   const filename=`${randomUUID()}.${extension}`
   const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),filename);form.append('uploadPath','audio/pbmstudio');form.append('fileName',filename)
   const res=await fetch('https://kieai.redpandaai.co/api/file-stream-upload',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(120000)})
   const data=await res.json().catch(()=>({}))
   if(!res.ok || Number(data.code)!==200 || data.success===false){
    last=data.msg||data.message||`Upload HTTP ${res.status}`
    if([401,402,429,430].includes(res.status)||[401,402,429,430].includes(Number(data.code)))continue
    throw new Error('Upload KIE gagal: '+last)
   }
   uploadUrl=data.data?.downloadUrl
   if(!uploadUrl||!/^https:\/\//.test(uploadUrl))throw new Error('KIE tidak memberikan URL audio yang valid')
  }
  // Do not rotate on network timeouts: the paid task may already have been accepted.
  const res=await fetch(`${BASE}/api/v1/generate/upload-cover`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(coverBody(input,uploadUrl)),signal:AbortSignal.timeout(120000)})
  const data=await res.json().catch(()=>({}))
  if(res.ok && Number(data.code)===200 && data.data?.taskId){
   store.setKieKeyCursor?.((idx+1)%pool.length)
   return {jobId:data.data.taskId,status:'processing',keyId:id,uploadUrl}
  }
  last=data.msg||data.message||`Cover HTTP ${res.status}`
  if([401,402,429,430].includes(res.status)||[401,402,429,430].includes(Number(data.code))){
   if(res.status===402||Number(data.code)===402)store.updateKieKeyCredits?.(id,0)
   continue
  }
  throw new Error('Cover KIE gagal: '+last)
 }
 throw new Error('API key KIE tidak dapat memproses cover: '+last)
}
