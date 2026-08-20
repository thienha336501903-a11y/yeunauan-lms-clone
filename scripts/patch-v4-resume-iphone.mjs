import fs from 'node:fs';

const file = 'v4.html';
let src = fs.readFileSync(file, 'utf8');

const oldResume = "function markSeen(id){if(!id)return;const fresh=!seen.has(id);seen.add(id);lastSeen=id;saveProgress();if(fresh)updateProgressUI();document.querySelectorAll(`[data-lesson-id=\"${CSS.escape(id)}\"]`).forEach(el=>el.classList.add('seen'))}function getResumeLesson(){if(!lessons.length)return null;const lastIndex=lessons.findIndex(x=>x.id===lastSeen);if(lastIndex>=0){for(let i=lastIndex+1;i<lessons.length;i++){if(!seen.has(lessons[i].id))return lessons[i]}}const firstUnseen=lessons.find(x=>!seen.has(x.id));if(firstUnseen)return firstUnseen;return lastIndex>=0?lessons[lastIndex]:lessons[lessons.length-1]||null}";
const newResume = "function markSeen(id){if(!id)return;const fresh=!seen.has(id);seen.add(id);lastSeen=id;saveProgress();if(fresh)updateProgressUI();document.querySelectorAll(`[data-lesson-id=\"${CSS.escape(id)}\"]`).forEach(el=>el.classList.add('seen'))}function getResumeLesson(){if(!lessons.length)return null;const lastIndex=lessons.findIndex(x=>x.id===lastSeen);if(lastIndex<0)return lessons[0];return lessons[(lastIndex+1)%lessons.length]||lessons[0]}";
if (!src.includes(oldResume)) throw new Error('resume anchor not found');
src = src.replace(oldResume, newResume);

const oldScroll = "function scrollToLesson(id,mark=true){const el=document.getElementById(id);if(!el)return;if(mark){lastSeen=id;saveProgress()}el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');document.querySelectorAll('.outline-item').forEach(x=>x.classList.toggle('current',x.dataset.lessonId===id))}";
const newScroll = oldScroll + "function scrollToLessonFromResume(id){const el=document.getElementById(id);if(!el)return false;const mobile=window.matchMedia('(max-width:760px)').matches,header=mobile?document.querySelector('.mobile-top'):null,offset=(header?.getBoundingClientRect().height||0)+(mobile?10:14),top=Math.max(0,window.scrollY+el.getBoundingClientRect().top-offset);window.scrollTo({top,behavior:'smooth'});el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');document.querySelectorAll('.outline-item').forEach(x=>x.classList.toggle('current',x.dataset.lessonId===id));return true}";
if (!src.includes(oldScroll)) throw new Error('scroll anchor not found');
src = src.replace(oldScroll, newScroll);

const oldBindPart = "const resume=()=>{const l=getResumeLesson();if(!l)return;activeFilter='all';searchQuery='';$('searchInput').value='';$('mobileSearchInput').value='';$('mobileSearch').classList.remove('show');applyFilter('all');requestAnimationFrame(()=>scrollToLesson(l.id,false))};";
const newBindPart = "const resume=()=>{const l=getResumeLesson();if(!l)return;activeFilter='all';searchQuery='';$('searchInput').value='';$('mobileSearchInput').value='';$('mobileSearch').classList.remove('show');applyFilter('all');requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToLessonFromResume(l.id)))};";
if (!src.includes(oldBindPart)) throw new Error('resume bind anchor not found');
src = src.replace(oldBindPart, newBindPart);

fs.writeFileSync(file, src);
