import fs from 'node:fs';

const path = new URL('../v4.html', import.meta.url);
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const first = src.indexOf(from);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (src.indexOf(from, first + from.length) >= 0) throw new Error(`Anchor not unique: ${label}`);
  src = src.slice(0, first) + to + src.slice(first + from.length);
}

replaceOnce(
  '.resume-float .circle{width:38px;height:38px;border-radius:50%;background:#fff;color:var(--tg-green-dark);display:grid;place-items:center;font-size:15px}.resume-float .rtext{text-align:left;line-height:1.1}.resume-float strong{display:block;font-size:12px}.resume-float span{font-size:10px;opacity:.8}.lightbox{',
  '.resume-float .circle{width:38px;height:38px;border-radius:50%;background:#fff;color:var(--tg-green-dark);display:grid;place-items:center;font-size:15px}.resume-float .rtext{text-align:left;line-height:1.1}.resume-float strong{display:block;font-size:12px}.resume-float span{font-size:10px;opacity:.8}.course-menu-backdrop{position:fixed;inset:0;z-index:80;display:none;background:rgba(18,31,23,.18);backdrop-filter:blur(1px)}.course-menu-backdrop.open{display:block}.course-menu{position:fixed;z-index:81;display:none;width:min(294px,calc(100vw - 24px));background:#fff;border:1px solid #dfe7e1;border-radius:16px;padding:7px;box-shadow:0 14px 38px rgba(31,55,39,.2)}.course-menu.open{display:block}.course-menu-title{padding:7px 9px 6px;font-size:10px;font-weight:800;color:#8a9690;text-transform:uppercase;letter-spacing:.04em}.course-menu-item{width:100%;min-height:44px;border:0;border-radius:11px;background:#fff;padding:10px 11px;display:flex;align-items:center;gap:10px;text-align:left;font-size:13px;font-weight:700;cursor:pointer}.course-menu-item:hover,.course-menu-item:focus{background:#f0f6ef;outline:none}.course-menu-item .mi{width:26px;height:26px;border-radius:8px;background:#eaf3e7;color:var(--tg-green-dark);display:grid;place-items:center;flex:0 0 26px}.course-menu-sep{height:1px;background:#edf1ee;margin:5px 3px}.lightbox{',
  'course menu styles'
);

replaceOnce(
  '<button class="iconbtn" type="button" aria-label="Tùy chọn">•••</button></div>',
  '<button class="iconbtn" id="sideMenuBtn" type="button" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded="false">•••</button></div>',
  'desktop options button'
);

replaceOnce(
  '<button class="iconbtn" id="mobileSearchBtn" type="button" aria-label="Tìm kiếm">⌕</button><button class="iconbtn" type="button" aria-label="Tùy chọn">•••</button></header>',
  '<button class="iconbtn" id="mobileSearchBtn" type="button" aria-label="Tìm kiếm">⌕</button><button class="iconbtn" id="mobileMenuBtn" type="button" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded="false">•••</button></header>',
  'mobile options button'
);

replaceOnce(
  '<button class="resume-float" id="resumeFloat" type="button"><span class="circle">▶</span><span class="rtext"><strong>Tiếp tục học</strong><span id="resumeFloatText">Từ bài gần nhất</span></span></button>\n  <nav class="mobile-filters"',
  '<button class="resume-float" id="resumeFloat" type="button"><span class="circle">▶</span><span class="rtext"><strong id="resumeFloatLabel">Tiếp tục học</strong><span id="resumeFloatText">Từ bài gần nhất</span></span></button>\n  <div class="course-menu-backdrop" id="courseMenuBackdrop" aria-hidden="true"></div><div class="course-menu" id="courseMenu" role="menu" aria-hidden="true"><div class="course-menu-title">Tùy chọn khóa học</div><button class="course-menu-item" id="menuResume" type="button" role="menuitem"><span class="mi">▶</span><span>Tiếp tục học</span></button><button class="course-menu-item" id="menuSearch" type="button" role="menuitem"><span class="mi">⌕</span><span>Tìm trong khóa học</span></button><button class="course-menu-item" id="menuOutline" type="button" role="menuitem"><span class="mi">☰</span><span>Mở phụ lục</span></button><div class="course-menu-sep"></div><button class="course-menu-item" id="menuRefresh" type="button" role="menuitem"><span class="mi">↻</span><span>Làm mới khóa học</span></button><button class="course-menu-item" id="menuCourses" type="button" role="menuitem"><span class="mi">‹</span><span>Về danh sách khóa học</span></button></div>\n  <nav class="mobile-filters"',
  'resume/menu markup'
);

replaceOnce(
  "function markSeen(id){if(!id)return;const fresh=!seen.has(id);seen.add(id);lastSeen=id;saveProgress();if(fresh)updateProgressUI();document.querySelectorAll(`[data-lesson-id=\"${CSS.escape(id)}\"]`).forEach(el=>el.classList.add('seen'))}function getResumeLesson(){return lessons.find(x=>x.id===lastSeen)||lessons.find(x=>!seen.has(x.id))||lessons[0]||null}",
  "function markSeen(id){if(!id)return;const fresh=!seen.has(id);seen.add(id);lastSeen=id;saveProgress();if(fresh)updateProgressUI();document.querySelectorAll(`[data-lesson-id=\"${CSS.escape(id)}\"]`).forEach(el=>el.classList.add('seen'))}function getResumeLesson(){if(!lessons.length)return null;const lastIndex=lessons.findIndex(x=>x.id===lastSeen);if(lastIndex>=0){for(let i=lastIndex+1;i<lessons.length;i++){if(!seen.has(lessons[i].id))return lessons[i]}}const firstUnseen=lessons.find(x=>!seen.has(x.id));if(firstUnseen)return firstUnseen;return lastIndex>=0?lessons[lastIndex]:lessons[lessons.length-1]||null}",
  'resume target logic'
);

replaceOnce(
  "function updateProgressUI(){const total=Math.max(lessons.length,1),pct=Math.round((seen.size/total)*100);$('progressPct').textContent=`${pct}%`;$('progressFill').style.width=`${pct}%`;$('mobileProgress').style.width=`${pct}%`;$('outlineSeen').textContent=`${seen.size} đã xem`;const resume=getResumeLesson();if(resume){$('resumeSideTitle').textContent=resume.title;$('resumeSideLabel').textContent=seen.has(resume.id)?'Xem lại bài gần nhất':'Tiếp tục học';$('resumeFloatText').textContent=resume.title.length>30?resume.title.slice(0,30)+'…':resume.title}document.querySelectorAll('.outline-item').forEach(el=>el.classList.toggle('seen',seen.has(el.dataset.lessonId)));document.querySelectorAll('.lesson-card').forEach(el=>{const check=el.querySelector('.seen-check');if(check)check.hidden=!seen.has(el.dataset.lessonId)})}",
  "function updateProgressUI(){const total=Math.max(lessons.length,1),pct=Math.round((seen.size/total)*100);$('progressPct').textContent=`${pct}%`;$('progressFill').style.width=`${pct}%`;$('mobileProgress').style.width=`${pct}%`;$('outlineSeen').textContent=`${seen.size} đã xem`;const resume=getResumeLesson();if(resume){const revisiting=seen.has(resume.id);$('resumeSideTitle').textContent=resume.title;$('resumeSideLabel').textContent=revisiting?'Xem lại bài gần nhất':'Tiếp tục học';$('resumeFloatLabel').textContent=revisiting?'Xem lại bài gần nhất':'Tiếp tục học';$('resumeFloatText').textContent=resume.title.length>30?resume.title.slice(0,30)+'…':resume.title}document.querySelectorAll('.outline-item').forEach(el=>el.classList.toggle('seen',seen.has(el.dataset.lessonId)));document.querySelectorAll('.lesson-card').forEach(el=>{const check=el.querySelector('.seen-check');if(check)check.hidden=!seen.has(el.dataset.lessonId)})}",
  'resume labels'
);

replaceOnce(
  "function render(d){data=d;loadProgress();lessons=buildLessons(Array.isArray(d.posts)?d.posts:[]);",
  "function closeCourseMenu(){const menu=$('courseMenu'),backdrop=$('courseMenuBackdrop');menu?.classList.remove('open');backdrop?.classList.remove('open');menu?.setAttribute('aria-hidden','true');backdrop?.setAttribute('aria-hidden','true');$('sideMenuBtn')?.setAttribute('aria-expanded','false');$('mobileMenuBtn')?.setAttribute('aria-expanded','false')}function openCourseMenu(e){const menu=$('courseMenu'),backdrop=$('courseMenuBackdrop'),btn=e?.currentTarget;if(!menu||!backdrop)return;closeMobileOutline();$('mobileSearch')?.classList.remove('show');const rect=btn?.getBoundingClientRect();const width=Math.min(294,Math.max(220,window.innerWidth-24));const left=rect?Math.min(Math.max(12,rect.right-width),window.innerWidth-width-12):Math.max(12,window.innerWidth-width-12);const top=rect?Math.min(rect.bottom+6,Math.max(12,window.innerHeight-282)):76;menu.style.left=`${left}px`;menu.style.top=`${top}px`;menu.classList.add('open');backdrop.classList.add('open');menu.setAttribute('aria-hidden','false');backdrop.setAttribute('aria-hidden','false');btn?.setAttribute('aria-expanded','true')}function resumeCourse(){const l=getResumeLesson();if(!l)return;closeCourseMenu();closeMobileOutline();activeFilter='all';searchQuery='';$('searchInput').value='';$('mobileSearchInput').value='';$('mobileSearch').classList.remove('show');applyFilter('all');requestAnimationFrame(()=>scrollToLesson(l.id,false))}function openCourseSearch(){closeCourseMenu();if(window.matchMedia('(max-width:760px)').matches){$('mobileSearch').classList.add('show');setTimeout(()=>$('mobileSearchInput').focus(),50)}else $('searchInput').focus()}function openCourseOutline(){closeCourseMenu();if(window.matchMedia('(max-width:760px)').matches)openMobileOutline();else $('outline')?.scrollIntoView({behavior:'smooth',block:'start'})}\nfunction render(d){data=d;loadProgress();lessons=buildLessons(Array.isArray(d.posts)?d.posts:[]);",
  'menu/resume functions'
);

replaceOnce(
  "function bind(){$('sideBack').onclick=$('mobileBack').onclick=()=>location.href='/learning';document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>applyFilter(btn.dataset.filter)));$('searchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('mobileSearchInput').value=searchQuery;applyFilter()});$('mobileSearchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('searchInput').value=searchQuery;applyFilter()});$('mobileSearchBtn').onclick=()=>{$('mobileSearch').classList.toggle('show');if($('mobileSearch').classList.contains('show'))setTimeout(()=>$('mobileSearchInput').focus(),50)};$('mobileOutlineBtn').onclick=openMobileOutline;$('mobileOutlineClose').onclick=closeMobileOutline;$('mobileOutlineBackdrop').onclick=closeMobileOutline;const resume=()=>{const l=getResumeLesson();if(l)scrollToLesson(l.id,false)};$('resumeSide').onclick=resume;$('resumeFloat').onclick=resume;$('lightClose').onclick=()=>$('lightbox').classList.remove('open');$('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))$('lightbox').classList.remove('open')});document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('lightbox').classList.remove('open');closeMobileOutline()}})}",
  "function bind(){$('sideBack').onclick=$('mobileBack').onclick=()=>location.href='/learning';document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>applyFilter(btn.dataset.filter)));$('searchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('mobileSearchInput').value=searchQuery;applyFilter()});$('mobileSearchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('searchInput').value=searchQuery;applyFilter()});$('mobileSearchBtn').onclick=()=>{$('mobileSearch').classList.toggle('show');if($('mobileSearch').classList.contains('show'))setTimeout(()=>$('mobileSearchInput').focus(),50)};$('mobileOutlineBtn').onclick=openMobileOutline;$('mobileOutlineClose').onclick=closeMobileOutline;$('mobileOutlineBackdrop').onclick=closeMobileOutline;$('sideMenuBtn').onclick=openCourseMenu;$('mobileMenuBtn').onclick=openCourseMenu;$('courseMenuBackdrop').onclick=closeCourseMenu;$('menuResume').onclick=resumeCourse;$('menuSearch').onclick=openCourseSearch;$('menuOutline').onclick=openCourseOutline;$('menuRefresh').onclick=()=>location.reload();$('menuCourses').onclick=()=>location.href='/my-courses.html';$('resumeSide').onclick=resumeCourse;$('resumeFloat').onclick=resumeCourse;$('lightClose').onclick=()=>$('lightbox').classList.remove('open');$('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))$('lightbox').classList.remove('open')});document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('lightbox').classList.remove('open');closeMobileOutline();closeCourseMenu()}})}",
  'bind handlers'
);

fs.writeFileSync(path, src);
console.log('Patched V4 resume target and course options menu.');
