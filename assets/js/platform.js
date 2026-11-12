(() => {
  const path=location.pathname, inApps=path.includes('/apps/'), base=inApps?'../../':'';
  const apps=[['home','Dashboard','index.html'],['converter','Converter','#converter'],['idcard','ID Card Studio','apps/idcard/'],['qr-generator','QR Generator','apps/qr-generator/'],['print-layout','PRINTLAY','apps/print-layout/'],['photo-print-studio','Photo Print Studio','apps/photo-print-studio/']];
  let active='home';
  if(path.includes('/idcard/'))active='idcard'; else if(path.includes('/qr-generator/'))active='qr-generator'; else if(path.includes('/print-layout/'))active='print-layout'; else if(path.includes('/photo-print-studio/'))active='photo-print-studio';
  const titles={home:'Dashboard',idcard:'ID Card Studio','qr-generator':'QR Generator','print-layout':path.endsWith('/idcard.html')?'PRINTLAY · ID Card':'PRINTLAY','photo-print-studio':'Photo Print Studio'};
  let settings=document.getElementById('settingsBtn'); const save=document.getElementById('btn-save');
  if(active==='print-layout' && !path.endsWith('/idcard.html') && !settings){ settings=document.createElement('button'); settings.type='button'; settings.id='settingsBtn'; settings.className='icon-btn'; settings.setAttribute('aria-label','Pengaturan'); settings.title='Pengaturan'; settings.textContent='⚙'; }
  document.querySelectorAll('header.topbar, body > header.top').forEach(el=>el.remove());
  const nav=document.createElement('nav'); nav.className='kd-global-nav'; nav.setAttribute('aria-label','Navigasi utama KRISNA DIGITAL');
  nav.innerHTML=`<a class="kd-brand" href="${base}index.html">KRISNA DIGITAL</a><span class="kd-app-title">${titles[active]}</span><div class="kd-nav-tools"><button type="button" class="kd-menu-toggle" aria-label="Buka menu aplikasi" aria-expanded="false"><span></span><span></span><span></span></button><div class="kd-links">${apps.map(([id,label,url])=>`<a class="kd-link" href="${base}${url}" ${id===active?'aria-current="page"':''}>${label}</a>`).join('')}</div></div><div class="kd-nav-actions"></div>`;
  document.body.insertBefore(nav,document.body.firstChild);
  const actions=nav.querySelector('.kd-nav-actions'); [settings,save].filter(Boolean).forEach(n=>actions.appendChild(n));
  const menuToggle=nav.querySelector('.kd-menu-toggle'); const menuLinks=nav.querySelector('.kd-links');
  const closeMenu=()=>{nav.classList.remove('nav-open'); menuToggle?.setAttribute('aria-expanded','false');};
  const openMenu=()=>{nav.classList.add('nav-open'); menuToggle?.setAttribute('aria-expanded','true');};
  menuToggle?.addEventListener('click',()=>{
    const isOpen=nav.classList.contains('nav-open');
    if(isOpen){closeMenu();} else {openMenu();}
  });
  menuLinks?.querySelectorAll('.kd-link').forEach(link=>link.addEventListener('click',()=>closeMenu()));
  document.addEventListener('click',(event)=>{
    if(!nav.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth > 760) closeMenu();
  });
  document.documentElement.dataset.theme='dark';
  document.body.dataset.theme='dark';
  document.documentElement.dataset.kdTheme='dark';
  document.body.dataset.kdTheme='dark';
  localStorage.setItem('kd-theme','dark');
})();