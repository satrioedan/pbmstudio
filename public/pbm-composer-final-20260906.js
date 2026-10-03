/* Unified composer: preserve existing controls, IDs and API handlers. */
(() => {
  function start() {
    const q = s => document.querySelector(s);
    const create=q('#view-create'), upload=q('#view-upload'), library=q('#view-library');
    if(!create || !upload || q('#pbm-composer')) return;
    const shell=document.createElement('div'); shell.id='pbm-composer'; shell.hidden=true;
    create.before(shell);
    const editor=document.createElement('section'); editor.className='pbm-editor';
    editor.innerHTML='<div class="pbm-eyebrow">WORKSPACES › COMPOSER</div><h2>Create</h2><div class="pbm-mode-label">MODE</div><div class="pbm-modes" role="group" aria-label="Mode pembuatan"><button type="button" data-mode="create" aria-pressed="true">Buat Baru</button><button type="button" data-mode="upload" aria-pressed="false">Upload Cover</button></div>';
    shell.append(editor); editor.append(create,upload); shell.append(library);
    const detail=document.createElement('aside'); detail.className='pbm-detail'; detail.innerHTML='<p class="pbm-detail-empty">Pilih hasil di library untuk melihat detail.</p>'; shell.append(detail);
    const modal=q('#detail'), home=document.createComment('detail home'); modal.before(home);
    function field(id){return q(id)?.closest('.create-field');}
    function arrange(view, prefix, lyrics) {
      const form=view.querySelector('.create-form');
      const ordered=[field(prefix+'model'),field(prefix+'gender'),field(prefix+'title'),field(lyrics),view.querySelector('.create-main-prompt')].filter(Boolean);
      const region=document.createElement('div'); region.className='pbm-fields'; form.prepend(region);
      ordered.forEach(el=>region.append(el));
      const advanced=view.querySelector('.create-advanced');
      if(advanced && !advanced.querySelector('.create-field')) advanced.hidden=true;
    }
    arrange(create,'#f-','#f-lyrics'); arrange(upload,'#u-','#u-prompt');
    const type=q('#f-type'); q('#f-model').closest('.create-field').prepend(type);
    const source=q('#upload-drop-zone'), fileInfo=q('#upload-file-info');
    q('#u-title').closest('.create-field').before(source,fileInfo);
    const route=q('.kampung-route'); if(route) editor.insertBefore(route,editor.querySelector('.pbm-mode-label'));
    q('#u-provider').closest('.create-field').classList.add('pbm-cover-route'); upload.querySelector('.pbm-fields').prepend(q('#u-provider').closest('.create-field'));
    const inst=q('#u-instrumental').closest('.create-field'); q('#u-model').closest('.create-field').prepend(inst);
    const modes=[...shell.querySelectorAll('[data-mode]')]; let mode='create';
    function select(next){
      if(next!==mode){[['#f-title','#u-title'],['#f-lyrics','#u-prompt'],['#f-style','#u-style']].forEach(([a,b])=>{const from=q(mode==='create'?a:b),to=q(next==='create'?a:b);to.value=from.value;to.dispatchEvent(new Event('input',{bubbles:true}));});}
      mode=next; create.classList.toggle('hidden',mode!=='create'); upload.classList.toggle('hidden',mode!=='upload');
      modes.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
      if(route) route.hidden=mode==='upload';
    }
    modes.forEach(b=>b.addEventListener('click',()=>select(b.dataset.mode)));
    document.querySelectorAll('.nav-item[data-view="upload"],.bn-item[data-view="upload"]').forEach(el=>el.hidden=true);
    function refresh(){
      const active=typeof state!=='undefined' && (state.view==='create'||state.view==='upload');
      shell.hidden=!active; document.body.classList.toggle('pbm-composing',active);
      if(active){if(library.parentNode!==shell)shell.append(library,detail);library.classList.remove('hidden');detail.append(modal);select(state.view==='upload'?'upload':mode);}
      else {shell.after(library);home.after(modal);}
    }
    // Observe navigation visibility only; do not recreate forms or their listeners.
    let scheduled=false;
    const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{observer.disconnect();refresh();scheduled=false;observe();});});
    function observe(){document.querySelectorAll('.nav-item[data-view]').forEach(el=>observer.observe(el,{attributes:true,attributeFilter:['class']}));}
    observe();refresh();
    library.querySelector('h2').textContent='Library';
    const importField=q('#btn-import-lyrics').closest('.create-field'); q('#f-gender').closest('.create-field').append(importField); create.querySelector('.create-advanced').hidden=true;
    const crumb=document.createElement('div');crumb.className='pbm-eyebrow';crumb.textContent='WORKSPACES › MY WORKSPACE';library.prepend(crumb);
  }
  if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
