const state={episodes:[],member:"ALL",status:"all",search:"",favOnly:false,favorites:new Set(JSON.parse(localStorage.getItem("stationhead-favorites")||"[]"))};
const members=["ALL","EIKI","KAIRYU","NAOYA","RAN","SEITO","RYUKI","TAKUTO","HAYATO"];
const list=document.querySelector("#episodeList"),template=document.querySelector("#episodeTemplate"),chips=document.querySelector("#memberChips"),searchInput=document.querySelector("#searchInput"),countLabel=document.querySelector("#countLabel"),filterLabel=document.querySelector("#filterLabel"),favOnlyBtn=document.querySelector("#favOnlyBtn");
const fmt=d=>new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).format(new Date(d+"T00:00:00"));
const hasSource=e=>!!(e.audioUrl||e.youtubeIndex);
function saveFavs(){localStorage.setItem("stationhead-favorites",JSON.stringify([...state.favorites]))}

let ytApiPromise=null,ytPlayer=null;
function ensureYTApi(){
  if(window.YT?.Player)return Promise.resolve();
  if(ytApiPromise)return ytApiPromise;
  ytApiPromise=new Promise(resolve=>{
    const prev=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{if(typeof prev==="function")prev();resolve()};
    const s=document.createElement("script");s.src="https://www.youtube.com/iframe_api";document.head.appendChild(s);
  });
  return ytApiPromise;
}
function getYTModal(){
  let modal=document.querySelector("#ytModal");
  if(modal)return modal;
  modal=document.createElement("div");modal.id="ytModal";modal.className="yt-modal";
  modal.innerHTML='<div class="yt-backdrop"></div><div class="yt-sheet"><div class="yt-head"><div><p class="yt-kicker">YOUTUBE ARCHIVE</p><strong id="ytTitle"></strong></div><button class="yt-close" aria-label="閉じる">×</button></div><div class="yt-player"><div id="ytPlayer"></div></div><p class="yt-note">提供：いちごになりたいNaNa さんの再生リスト</p></div>';
  document.body.appendChild(modal);
  const close=()=>{modal.classList.remove("open");document.body.classList.remove("modal-open");if(ytPlayer?.pauseVideo)ytPlayer.pauseVideo()};
  modal.querySelector(".yt-close").onclick=close;modal.querySelector(".yt-backdrop").onclick=close;
  return modal;
}
async function openYouTube(ep){
  const modal=getYTModal();modal.querySelector("#ytTitle").textContent=`${fmt(ep.date)}  ${ep.members.join(" × ")}`;
  modal.classList.add("open");document.body.classList.add("modal-open");
  await ensureYTApi();
  const index=Math.max(0,(ep.youtubeIndex||1)-1);
  if(!ytPlayer){
    ytPlayer=new YT.Player("ytPlayer",{width:"100%",height:"100%",playerVars:{playsinline:1,rel:0},events:{onReady:e=>e.target.loadPlaylist({list:ep.youtubePlaylist,listType:"playlist",index,startSeconds:0})}});
  }else{
    ytPlayer.loadPlaylist({list:ep.youtubePlaylist,listType:"playlist",index,startSeconds:0});
  }
}

function makeChips(){chips.innerHTML="";members.forEach(name=>{const b=document.createElement("button");b.className="chip"+(state.member===name?" active":"");b.textContent=name;b.onclick=()=>{state.member=name;makeChips();render()};chips.appendChild(b)})}
function filtered(){const q=state.search.trim().toLowerCase();return state.episodes.filter(e=>state.member==="ALL"||e.members.includes(state.member)).filter(e=>state.status==="all"||(state.status==="ready"?hasSource(e):!hasSource(e))).filter(e=>!state.favOnly||state.favorites.has(e.id)).filter(e=>!q||[e.date,e.series,e.memo,e.source,...e.members].join(" ").toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date))}
function render(){list.innerHTML="";const items=filtered();countLabel.textContent=`${items.length} shows`;filterLabel.textContent=state.favOnly?"FAVORITES":state.member;favOnlyBtn.classList.toggle("active",state.favOnly);if(!items.length){list.innerHTML='<div class="empty">該当する配信がありません</div>';return}
items.forEach(ep=>{const node=template.content.cloneNode(true);node.querySelector(".date").textContent=fmt(ep.date);node.querySelector(".series").textContent=ep.series||"Stationhead";node.querySelector(".memo").textContent=ep.memo||"";
const mw=node.querySelector(".members");if(ep.members?.length){ep.members.forEach(m=>{const s=document.createElement("span");s.className="member"+(m==="EIKI"?" eiki":"");s.textContent=m;mw.appendChild(s)})}else{const s=document.createElement("span");s.className="member";s.textContent="出演者未入力";mw.appendChild(s)}
const fav=node.querySelector(".fav-btn");const sync=()=>{const on=state.favorites.has(ep.id);fav.textContent=on?"♥":"♡";fav.classList.toggle("active",on)};sync();fav.onclick=()=>{state.favorites.has(ep.id)?state.favorites.delete(ep.id):state.favorites.add(ep.id);saveFavs();sync();if(state.favOnly)render()};
const pw=node.querySelector(".player-wrap");
if(ep.audioUrl){const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";audio.src=ep.audioUrl;const key=`stationhead-progress-${ep.id}`;audio.addEventListener("loadedmetadata",()=>{const p=Number(localStorage.getItem(key)||0);if(p>2&&p<audio.duration-5)audio.currentTime=p});let last=0;audio.addEventListener("timeupdate",()=>{if(Date.now()-last>3000){localStorage.setItem(key,String(audio.currentTime));last=Date.now()}});audio.addEventListener("ended",()=>localStorage.removeItem(key));audio.addEventListener("error",()=>audio.remove());pw.appendChild(audio)}
if(ep.youtubeIndex){const b=document.createElement("button");b.className="youtube-btn";b.innerHTML='<span class="yt-icon">▶</span><span>YouTubeで再生</span><small>PLAYLIST '+ep.youtubeIndex+'</small>';b.onclick=()=>openYouTube(ep);pw.appendChild(b)}
if(!hasSource(ep)){const m=document.createElement("div");m.className="missing";m.textContent="音源未登録";pw.appendChild(m)}
const sources=[];if(ep.audioUrl)sources.push("保存音源");if(ep.youtubeIndex)sources.push("YouTube");
node.querySelector(".meta").innerHTML=`<span>${sources.join(" + ")||ep.source||""}</span><span>${hasSource(ep)?"再生できます":"あとで追加OK"}</span>`;list.appendChild(node)})}
document.querySelectorAll(".status-btn").forEach(b=>b.onclick=()=>{document.querySelectorAll(".status-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.status=b.dataset.status;render()});
searchInput.oninput=e=>{state.search=e.target.value;render()};favOnlyBtn.onclick=()=>{state.favOnly=!state.favOnly;render()};
fetch("./data/episodes.json").then(r=>r.json()).then(d=>{state.episodes=d;makeChips();render()}).catch(()=>list.innerHTML='<div class="empty">episodes.jsonを読み込めませんでした</div>');
