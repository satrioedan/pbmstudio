import {store} from './store.js'
export function resolvePersona(ref) {
 if(!ref)return {}
 const song=store.getSong(String(ref.songId||''))
 const persona=song?.personas?.find(p=>p.id===ref.id)
 if(!persona||song.provider!=='kie')throw new Error('Profil penyanyi tidak ditemukan. Pilih kembali profil yang tersimpan.')
 return {personaId:persona.id,personaKeyId:song.providerKeyId,personaRef:{songId:song.id,id:persona.id}}
}
export async function createPersona(body) {
 const song=store.getSong(String(body.songId||''))
 if(!song||song.provider!=='kie'||song.status!=='success'||song.isUpload||song.type==='instrumental')throw new Error('Pilih lagu vokal KIE yang berhasil dibuat dari menu Buat Lagu.')
 const track=song.tracks?.find(t=>t.id===body.audioId)
 if(!track)throw new Error('Pilih trek vokal sumber yang valid.')
 const existing=song.personas?.find(p=>p.audioId===track.id)
 if(existing)return {persona:existing,songId:song.id}
 const name=String(body.name||'').trim().slice(0,80), description=String(body.description||'').trim().slice(0,1000)
 if(!name||!description)throw new Error('Nama dan deskripsi profil wajib diisi.')
 const key=song.providerKeyId==='env'?process.env.KIE_API_KEY:store.getKieKeyById?.(song.providerKeyId)?.key
 if(!key)throw new Error('API key asal lagu tidak tersedia. Tambahkan kembali key KIE yang digunakan untuk lagu tersebut.')
 const response=await fetch((process.env.KIE_BASE_URL||'https://api.kie.ai').replace(/\/$/,'')+'/api/v1/generate/generate-persona',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({taskId:song.providerJobId,audioId:track.id,name,description}),signal:AbortSignal.timeout(120000)})
 const result=await response.json().catch(()=>({}))
 if(!response.ok||Number(result.code)!==200||!result.data?.personaId)throw new Error(result.msg||result.message||'KIE belum berhasil membuat Persona.')
 const persona={id:result.data.personaId,audioId:track.id,name,description,createdAt:Date.now()}
 store.updateSong(song.id,{personas:[...(song.personas||[]),persona]})
 return {persona,songId:song.id}
}
