import fs from 'node:fs';

const file = 'v4.html';
let s = fs.readFileSync(file, 'utf8');

function mustReplace(from, to, label) {
  if (!s.includes(from)) throw new Error(`Missing anchor: ${label}`);
  s = s.replace(from, to);
}

// Remove the now-unwanted top-right options buttons entirely.
mustReplace('<button class="iconbtn" id="sideMenuBtn" type="button" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded="false">•••</button>', '', 'desktop options button');
mustReplace('<button class="iconbtn" id="mobileMenuBtn" type="button" aria-label="Tùy chọn" aria-haspopup="menu" aria-expanded="false">•••</button>', '', 'mobile options button');

// Restore the floating resume label markup to the original minimal form.
s = s.replace('<strong id="resumeFloatLabel">Tiếp tục học</strong>', '<strong>Tiếp tục học</strong>');

// Remove course-menu markup if present.
const menuStart = s.indexOf('  <div class="course-menu-backdrop" id="courseMenuBackdrop"');
if (menuStart >= 0) {
  const navStart = s.indexOf('  <nav class="mobile-filters"', menuStart);
  if (navStart < 0) throw new Error('Missing mobile filters anchor after course menu');
  s = s.slice(0, menuStart) + s.slice(navStart);
}

// Remove course-menu CSS block only, leaving the surrounding resume/lightbox CSS intact.
const cssStart = s.indexOf('.course-menu-backdrop{');
if (cssStart >= 0) {
  const cssEnd = s.indexOf('.lightbox{', cssStart);
  if (cssEnd < 0) throw new Error('Missing lightbox CSS anchor after course menu CSS');
  s = s.slice(0, cssStart) + s.slice(cssEnd);
}

// Keep next-unseen resume logic, but remove the dynamic floating-label change that was part of the menu patch.
s = s.replace("$('resumeFloatLabel').textContent=revisiting?'Xem lại bài gần nhất':'Tiếp tục học';", '');

// Remove all course-menu helper functions.
const helperStart = s.indexOf('function closeCourseMenu(){');
if (helperStart >= 0) {
  const helperEnd = s.indexOf('function render(d){', helperStart);
  if (helperEnd < 0) throw new Error('Missing render anchor after course menu helpers');
  s = s.slice(0, helperStart) + s.slice(helperEnd);
}

// Bind only the repaired Resume behavior. It clears filters/search first so the target cannot remain hidden.
const bindStart = s.indexOf('function bind(){');
const bindEnd = s.indexOf('\nbind();init();', bindStart);
if (bindStart < 0 || bindEnd < 0) throw new Error('Missing bind anchors');
const bind = `function bind(){$('sideBack').onclick=$('mobileBack').onclick=()=>location.href='/learning';document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>applyFilter(btn.dataset.filter)));$('searchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('mobileSearchInput').value=searchQuery;applyFilter()});$('mobileSearchInput').addEventListener('input',e=>{searchQuery=e.target.value;$('searchInput').value=searchQuery;applyFilter()});$('mobileSearchBtn').onclick=()=>{$('mobileSearch').classList.toggle('show');if($('mobileSearch').classList.contains('show'))setTimeout(()=>$('mobileSearchInput').focus(),50)};$('mobileOutlineBtn').onclick=openMobileOutline;$('mobileOutlineClose').onclick=closeMobileOutline;$('mobileOutlineBackdrop').onclick=closeMobileOutline;const resume=()=>{const l=getResumeLesson();if(!l)return;activeFilter='all';searchQuery='';$('searchInput').value='';$('mobileSearchInput').value='';$('mobileSearch').classList.remove('show');applyFilter('all');requestAnimationFrame(()=>scrollToLesson(l.id,false))};$('resumeSide').onclick=resume;$('resumeFloat').onclick=resume;$('lightClose').onclick=()=>$('lightbox').classList.remove('open');$('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))$('lightbox').classList.remove('open')});document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('lightbox').classList.remove('open');closeMobileOutline()}})}`;
s = s.slice(0, bindStart) + bind + s.slice(bindEnd);

if (s.includes('courseMenu') || s.includes('mobileMenuBtn') || s.includes('sideMenuBtn')) throw new Error('Course menu remnants remain');
if (s.includes('aria-label="Tùy chọn"')) throw new Error('Top-right options button still remains');

fs.writeFileSync(file, s);
