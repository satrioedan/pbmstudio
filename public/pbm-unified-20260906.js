(() => {
 const root=document.documentElement;
 root.setAttribute('data-pbm-ui','unified');
 function apply(theme){
  root.setAttribute('data-pbm-theme',theme);root.setAttribute('data-theme',theme);
  localStorage.setItem('pbm-unified-theme',theme);
  localStorage.setItem('gejemuzik-theme',theme);
  document.querySelectorAll('#theme-toggle-side,#theme-toggle-set,#theme-toggle').forEach(b=>{b.textContent=theme==='dark'?'☀ Mode terang':'☾ Mode gelap';b.setAttribute('aria-label',theme==='dark'?'Aktifkan mode terang':'Aktifkan mode gelap');});
 }
 function start(){
  apply(localStorage.getItem('pbm-unified-theme')||'dark');
  document.addEventListener('click',e=>{const b=e.target.closest('#theme-toggle-side,#theme-toggle-set,#theme-toggle');if(!b)return;e.preventDefault();e.stopImmediatePropagation();apply(root.getAttribute('data-pbm-theme')==='dark'?'light':'dark');},true);
 }
 if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
