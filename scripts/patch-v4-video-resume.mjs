import fs from 'node:fs';

const path = 'v4.html';
let s = fs.readFileSync(path, 'utf8');

function replaceRegex(label, re, replacement) {
  const matches = s.match(re);
  if (!matches) throw new Error(`Missing anchor: ${label}`);
  s = s.replace(re, replacement);
}

replaceRegex(
  'progress keys',
  /const VIDEO_TYPES=new Set\(\['video','animation','video_note'\]\),FILE_TYPES=new Set\(\['document','audio','voice'\]\),progressKey=`v4_progress_\$\{course\|\|'unknown'\}`;let data=null,lessons=\[\],activeFilter='all',searchQuery='',seen=new Set\(\),lastSeen='',observeTimers=new Map\(\),mediaWorkerReadyPromise=null;/,
  "const VIDEO_TYPES=new Set(['video','animation','video_note']),FILE_TYPES=new Set(['document','audio','voice']),progressKey=`v4_progress_${course||'unknown'}`,videoProgressKey=`v4_video_progress_${course||'unknown'}`;let data=null,lessons=[],activeFilter='all',searchQuery='',seen=new Set(),lastSeen='',observeTimers=new Map(),mediaWorkerReadyPromise=null,videoProgress=null;"
);

replaceRegex(
  'progress helpers',
  /function loadProgress\(\)\{[\s\S]*?\}function saveProgress\(\)\{[\s\S]*?\}\nfunction markSeen/,
  `function loadProgress(){try{const p=JSON.parse(localStorage.getItem(progressKey)||'{}');seen=new Set(Array.isArray(p.seen)?p.seen:[]);lastSeen=String(p.last||'')}catch{seen=new Set();lastSeen=''}}function saveProgress(){try{localStorage.setItem(progressKey,JSON.stringify({seen:[...seen],last:lastSeen,updatedAt:new Date().toISOString()}))}catch{}}
function loadVideoProgress(){try{const p=JSON.parse(localStorage.getItem(videoProgressKey)||'null');videoProgress=p&&p.messageId?p:null}catch{videoProgress=null}}
function isUnfinishedVideoProgress(p){if(!p||!p.messageId||!p.lessonId)return false;const t=Number(p.currentTime||0),d=Number(p.duration||0);if(!(t>.5))return false;if(d>0&&(t>=d-2||t/d>=.98))return false;return true}
function saveVideoProgress(state){const next={lessonId:String(state?.lessonId||''),messageId:String(state?.messageId||''),currentTime:Number(state?.currentTime||0),duration:Number(state?.duration||0),updatedAt:new Date().toISOString()};if(!next.lessonId||!next.messageId||!(next.currentTime>.5))return;videoProgress=next;try{localStorage.setItem(videoProgressKey,JSON.stringify(next))}catch{}}
function clearVideoProgress(messageId=''){if(messageId&&videoProgress?.messageId&&String(videoProgress.messageId)!==String(messageId))return;videoProgress=null;try{localStorage.removeItem(videoProgressKey)}catch{}}
function markSeen`
);

replaceRegex(
  'resume target',
  /function markSeen\(id\)\{[\s\S]*?\}function getResumeLesson\(\)\{[\s\S]*?\}\nfunction updateProgressUI/,
  `function markSeen(id){if(!id)return;const fresh=!seen.has(id);seen.add(id);lastSeen=id;saveProgress();if(fresh)updateProgressUI();document.querySelectorAll(\`[data-lesson-id="\${CSS.escape(id)}"]\`).forEach(el=>el.classList.add('seen'))}
function getResumeTarget(){if(isUnfinishedVideoProgress(videoProgress)){const lesson=lessons.find(x=>x.id===videoProgress.lessonId);if(lesson)return{lessonId:lesson.id,messageId:String(videoProgress.messageId||'')}}const last=lessons.find(x=>x.id===lastSeen)||lessons[0]||null;return last?{lessonId:last.id,messageId:''}:null}
function getResumeLesson(){const target=getResumeTarget();return target?lessons.find(x=>x.id===target.lessonId)||null:null}
function updateProgressUI`
);

replaceRegex(
  'resume scrolling',
  /function scrollToLessonFromResume\(id\)\{[\s\S]*?\}\nfunction mediaItemHtml/,
  `function scrollToResumeTarget(target){if(!target?.lessonId)return false;const lesson=document.getElementById(target.lessonId);if(!lesson)return false;let el=lesson;if(target.messageId){const media=lesson.querySelector(\`[data-message-id="\${CSS.escape(String(target.messageId))}"]\`);if(media)el=media}const mobile=window.matchMedia('(max-width:760px)').matches,header=mobile?document.querySelector('.mobile-top'):null,offset=(header?.getBoundingClientRect().height||0)+(mobile?10:14),top=Math.max(0,window.scrollY+el.getBoundingClientRect().top-offset);window.scrollTo({top,behavior:'smooth'});lesson.classList.remove('flash');void lesson.offsetWidth;lesson.classList.add('flash');document.querySelectorAll('.outline-item').forEach(x=>x.classList.toggle('current',x.dataset.lessonId===target.lessonId));return true}
function mediaItemHtml`
);

replaceRegex(
  'protected video playback',
  /async function startProtectedVideo\(cell,messageId\)\{[\s\S]*?\}\nfunction wireMedia/,
  `async function startProtectedVideo(cell,messageId){if(cell.dataset.loading==='1')return;cell.dataset.loading='1';const btn=cell.querySelector('.play');if(btn)btn.disabled=true;const loading=document.createElement('div');loading.className='media-loading';loading.textContent='Đang cấp quyền phát an toàn…';cell.appendChild(loading);try{const worker=await ensureMediaWorker(),lease=await requestPlaybackLease(messageId);await sendLeaseToWorker(worker,lease);const lesson=cell.closest('.lesson-card'),lessonId=lesson?.dataset.lessonId||'';if(lesson)markSeen(lessonId);const video=document.createElement('video');video.controls=true;video.autoplay=true;video.preload='metadata';video.playsInline=true;video.setAttribute('controlsList','nodownload noremoteplayback');video.setAttribute('disableRemotePlayback','');try{video.disablePictureInPicture=true}catch{}video.addEventListener('contextmenu',e=>e.preventDefault());let lastSavedAt=0;const rememberProgress=(force=false)=>{const now=Date.now();if(!force&&now-lastSavedAt<900)return;lastSavedAt=now;const currentTime=Number(video.currentTime||0),duration=Number(video.duration||0);if(duration>0&&(currentTime>=duration-2||currentTime/duration>=.98)){clearVideoProgress(messageId);return}saveVideoProgress({lessonId,messageId,currentTime,duration})};video.addEventListener('loadedmetadata',()=>{if(isUnfinishedVideoProgress(videoProgress)&&String(videoProgress.messageId)===String(messageId)){const saved=Number(videoProgress.currentTime||0),max=Math.max(0,Number(video.duration||0)-1);if(saved>0)try{video.currentTime=max>0?Math.min(saved,max):saved}catch{}}});video.addEventListener('timeupdate',()=>rememberProgress(false));video.addEventListener('pause',()=>{rememberProgress(true);updateProgressUI()});video.addEventListener('play',()=>{rememberProgress(true);updateProgressUI()});const mark=document.createElement('div');mark.className='media-watermark';mark.hidden=true;const markTimer=startMovingWatermark(mark);video.addEventListener('ended',()=>{clearInterval(markTimer);clearVideoProgress(messageId);if(lesson)markSeen(lessonId);updateProgressUI();worker.postMessage({type:'V4_MEDIA_REVOKE',leaseId:lease.leaseId})});video.addEventListener('error',()=>{clearInterval(markTimer);rememberProgress(true);mark.hidden=false;mark.textContent='Phiên phát video đã hết hạn — chạm tải lại trang để thử lại'});cell.replaceChildren(video,mark);video.src='/v4-media/'+encodeURIComponent(lease.leaseId);video.play().catch(()=>{})}catch(error){loading.textContent=error?.message||'Không phát được video';if(btn)btn.disabled=false;setTimeout(()=>{loading.remove();cell.dataset.loading=''},2200);return}cell.dataset.loading=''}
function wireMedia`
);

replaceRegex(
  'load video progress during render',
  /function render\(d\)\{data=d;loadProgress\(\);lessons=/,
  "function render(d){data=d;loadProgress();loadVideoProgress();lessons="
);

replaceRegex(
  'resume button binding',
  /const resume=\(\)=>\{const l=getResumeLesson\(\);if\(!l\)return;[\s\S]*?scrollToLessonFromResume\(l\.id\)\)\)\};\$\('resumeSide'\)\.onclick=resume;/,
  "const resume=()=>{const target=getResumeTarget();if(!target)return;activeFilter='all';searchQuery='';$('searchInput').value='';$('mobileSearchInput').value='';$('mobileSearch').classList.remove('show');applyFilter('all');requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToResumeTarget(target)))};$('resumeSide').onclick=resume;"
);

fs.writeFileSync(path, s);
console.log('Patched V4 unfinished-video resume behavior');
