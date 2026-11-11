
(function(){
  const toggle=document.querySelector('.wlh-mobile-toggle');
  const menu=document.getElementById('wlh-mobile-menu');
  if(!toggle||!menu)return;
  function close(){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}
  toggle.addEventListener('click',function(){const opening=menu.hidden;menu.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));});
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();toggle.focus();}});
  document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!toggle.contains(e.target))close();});
  window.addEventListener('resize',()=>{if(window.innerWidth>760)close();});
})();
