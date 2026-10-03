(() => {
 const allowed = new Set(['frontpage','create','upload','lyrics','mastering','library','homofon','liked','settings']);
 function go(view){
  if(!allowed.has(view) || typeof setView!=='function') return;
  setView(view);
  if(view==='upload'||view==='create') queueMicrotask(()=>{
   const mode=document.querySelector('.pbm-modes [data-mode="'+view+'"]');
   if(mode) mode.click();
  });
  window.scrollTo({top:0,behavior:'instant'});
 }
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-lp-view]');if(!link)return;
  if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();history.replaceState(null,'',location.pathname+location.search);go(link.dataset.lpView);
 });
 window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
 // Clear landing shortcuts when the user switches menus, so reload keeps the last menu.
 document.addEventListener('click',event=>{
  if(event.target.closest('.nav-item[data-view],.bn-item[data-view],#fp-cta')&&location.hash)history.replaceState(null,'',location.pathname+location.search);
 });
 function start(){if(!document.body.dataset.pbmAdmin && location.hash){go(location.hash.slice(1));history.replaceState(null,'',location.pathname+location.search);}}
 if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
