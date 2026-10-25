(() => {
 const q=s=>document.querySelector(s), esc=s=>escapeHtml(String(s||''));
 const storageKey='pbm-presets-v1-'+getClientId();
 let saved=[];try {saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(!Array.isArray(saved))saved=[]}catch{}
 let profiles=[];
 const schema={create:['f-style','f-model','f-gender','f-type'],upload:['u-style','u-model','u-provider','u-gender','u-instrumental','u-audio-weight','u-negative-tags'],mastering:['mst-eq-low','mst-eq-lowmid','mst-eq-highmid','mst-eq-high','mst-comp-thresh','mst-comp-ratio','mst-comp-attack','mst-comp-release','mst-comp-makeup','mst-limiter-ceiling','mst-width','mst-outgain','mst-hpf','mst-saturation','mst-multiband','mst-target']};
 function persist(next){localStorage.setItem(storageKey,JSON.stringify(next));saved=next;refreshPresets()}
 function capture(kind){const fields={};for(const id of schema[kind]){const el=q('#'+id);if(!el)continue;fields[id]=el.classList.contains('segment')?el.dataset.value:el.type==='checkbox'?el.checked:el.value}return fields}
 function apply(kind,fields){
  const ids=kind==='upload'?['u-provider',...schema[kind].filter(id=>id!=='u-provider')]:schema[kind];
  for(const id of ids){const el=q('#'+id);if(!el||!(id in fields))continue;
   if(el.classList.contains('segment')){el.querySelector('[data-val="'+CSS.escape(String(fields[id]))+'"]')?.click();continue}
   if(el.type==='checkbox')el.checked=!!fields[id];else el.value=String(fields[id]);
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(kind==='mastering'){q('#mst-mode button[data-val="manual"]')?.click();if(q('#mst-preset'))q('#mst-preset').value='custom'}
 }
 function refreshPresets(){for(const kind of Object.keys(schema)){const select=q('#preset-'+kind);if(!select)continue;const old=select.value;select.innerHTML='<option value="">Pilih preset tersimpan</option>'+saved.filter(p=>p.kind===kind).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');select.value=old}}
 function widget(kind,parent){if(!parent)return;const box=document.createElement('section');box.className='pbm-preset-box';box.innerHTML=`<h3>Preset ${kind==='mastering'?'Mastering':'Musik'}</h3><p>Simpan pengaturan untuk digunakan kembali. Tersimpan di browser ini.</p><select id="preset-${kind}" aria-label="Preset ${kind}"></select><input id="preset-name-${kind}" placeholder="Nama preset, misalnya Akustik Hangat" maxlength="80" aria-label="Nama preset ${kind}"><div class="pbm-preset-actions"><button type="button" data-action="apply">Terapkan</button><button type="button" data-action="save">Simpan Baru</button><button type="button" data-action="update">Perbarui</button><button type="button" data-action="delete">Hapus</button></div>`;
  parent.prepend(box);
  box.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;try{const select=q('#preset-'+kind), current=saved.find(p=>p.id===select.value&&p.kind===kind),name=q('#preset-name-'+kind).value.trim();
   if(action==='apply'){if(!current)throw Error('Pilih preset terlebih dahulu.');apply(kind,current.fields);q('#preset-name-'+kind).value=current.name;toast('Preset diterapkan','success');return}
   if(action==='delete'){if(!current)throw Error('Pilih preset terlebih dahulu.');if(!confirm('Hapus preset '+current.name+'?'))return;persist(saved.filter(p=>p.id!==current.id));toast('Preset dihapus','success');return}
   if(!name)throw Error('Masukkan nama preset.');if(action==='update'&&!current)throw Error('Pilih preset yang ingin diperbarui.');
   const item={id:action==='update'?current.id:crypto.randomUUID(),kind,name,fields:capture(kind)};
   const next=action==='update'?saved.map(p=>p.id===item.id?item:p):[...saved,item];persist(next);select.value=item.id;toast('Preset tersimpan','success');
  }catch(e){toast(e.message||'Preset tidak bisa disimpan','error')}})
 }
 function renderVoices(){for(const mode of ['create','upload']){const select=q('#voice-'+mode);if(!select)continue;const old=select.value;select.innerHTML='<option value="">Tanpa profil penyanyi</option>'+profiles.map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('');select.value=old}}
 window.pbmSelectedPersona=mode=>{const value=q('#voice-'+mode)?.value;if(value===''||value==null)return null;const p=profiles[Number(value)];return p?{songId:p.songId,id:p.id}:null};
 async function loadVoices(){const d=await api('/api/songs');const songs=d.songs||[];profiles=songs.flatMap(s=>(s.personas||[]).map(p=>({...p,songId:s.id})));renderVoices();const select=q('#persona-source');if(select){const eligible=songs.filter(s=>s.provider==='kie'&&s.status==='success'&&!s.isUpload&&s.type!=='instrumental');select.innerHTML='<option value="">Pilih lagu KIE yang selesai</option>'+eligible.flatMap(s=>(s.tracks||[]).map(t=>`<option value="${esc(JSON.stringify({songId:s.id,audioId:t.id}))}">${esc(s.title)} — ${esc(t.title||t.id)}</option>`)).join('');q('#persona-status').textContent=eligible.length?'Pilih trek vokal sebagai sumber profil.':'Belum ada lagu vokal KIE yang selesai. Buat lagu terlebih dahulu.'}}
 function voiceControls(mode,parent){const box=document.createElement('div');box.className='pbm-preset-box';box.innerHTML=`<label for="voice-${mode}">Profil penyanyi KIE Persona</label><select id="voice-${mode}"></select><p>${mode==='upload'?'Gunakan KIE, mode vokal, dan isi lirik custom.':'Pilih model KIE dan mode vokal.'} Kelola profil dan pilihan ini di menu Persona & Preset.</p>`;parent.prepend(box)}
 function start(){
  const style=document.createElement('style');style.textContent='.pbm-preset-box{padding:16px;margin:12px 0;border:1px solid var(--pb-line,#35332b);border-radius:12px;background:var(--pb-panel,#141410)}.pbm-preset-box h3{margin:0 0 10px;font-size:15px}.pbm-preset-box p{font-size:12px;color:var(--pb-muted,#aaa);line-height:1.6}.pbm-preset-box select,.pbm-preset-box input,.pbm-preset-box textarea{width:100%;margin:6px 0;padding:10px;border-radius:8px}.pbm-preset-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.pbm-preset-actions button{padding:8px 12px;border-radius:8px;cursor:pointer}';document.head.append(style);
  const createSlot=q('#presets-create-slot'), uploadSlot=q('#presets-upload-slot');
  if(createSlot){widget('create',createSlot);voiceControls('create',createSlot)}
  if(uploadSlot){widget('upload',uploadSlot);voiceControls('upload',uploadSlot)}
  widget('mastering',q('#view-mastering'));
  const parent=q('#view-presets');const box=document.createElement('section');box.className='pbm-preset-box';box.innerHTML='<h3>Profil Penyanyi — KIE Persona</h3><p>Buat profil karakter dari lagu vokal KIE yang sudah selesai. Persona membantu menjaga karakter musik; kemiripan suara tidak dijamin identik. Gunakan karya dan suara yang Anda miliki atau diizinkan.</p><select id="persona-source" aria-label="Lagu sumber profil"></select><input id="persona-name" placeholder="Nama penyanyi / profil" maxlength="80"><textarea id="persona-description" placeholder="Deskripsikan karakter vokal dan musik" maxlength="1000"></textarea><div class="pbm-preset-actions"><button id="persona-refresh" type="button">Muat Ulang Daftar</button><button id="persona-create" type="button">Buat Profil KIE</button></div><p id="persona-status" role="status"></p><p>Profil tersimpan bersama lagu sumber. Jangan hapus lagu sumber jika profil masih digunakan. Pembuatan profil dapat menggunakan kredit KIE.</p>';
  parent?.append(box);
  q('#persona-refresh').onclick=()=>loadVoices().catch(e=>toast(e.message,'error'));
  q('#persona-create').onclick=async()=>{const btn=q('#persona-create');try{const value=q('#persona-source').value;if(!value)throw Error('Pilih lagu sumber terlebih dahulu.');const name=q('#persona-name').value.trim(),description=q('#persona-description').value.trim();if(!name||!description)throw Error('Isi nama dan deskripsi profil.');if(!confirm('Buat satu profil Persona melalui KIE? Proses ini dapat memakai kredit API.'))return;btn.disabled=true;q('#persona-status').textContent='Membuat profil di KIE…';const result=await api('/api/personas',{method:'POST',body:{...JSON.parse(value),name,description}});await loadVoices();q('#persona-status').textContent='Profil '+result.persona.name+' tersimpan. Pilih profil di Buat Lagu atau Upload Cover.';toast('Profil penyanyi tersimpan','success')}catch(e){q('#persona-status').textContent=e.message;toast(e.message,'error')}finally{btn.disabled=false}};
  refreshPresets();renderVoices();loadVoices().catch(()=>{q('#persona-status').textContent='Klik Muat Ulang Daftar untuk mengambil lagu sumber.'});
 }
 if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
