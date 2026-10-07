const $ = id => document.getElementById(id);
let configured=false, running=false, submitting=false, lastUrl='', sourceObject='', metadata=null, catalog=[], quote=null, version=0, preparing=false, quoteTimer, job=null;
const uploads = new WeakMap(); let thumbnailUrls=[];
let count=1, selectedResult=0, resultJobId='', resultSignature='';
function changeCount(delta){if(running||submitting)return;count=Math.min(4,Math.max(1,count+delta));$('video-count').textContent=`${count}/4`;invalidate();}
$('count-minus').addEventListener('click',()=>changeCount(-1));
$('count-plus').addEventListener('click',()=>changeCount(1));
const descriptions={ 'motion-transfer':'Recria personagens e a cena usando suas referências, preservando movimento e câmera.', 'object-swap':'Troca personagens, roupas ou objetos específicos. Descreva o que deve mudar e o que deve permanecer.', restyle:'Aplica um estilo do catálogo ao vídeo. As referências de personagens são opcionais.' };
function error(message){$('error').textContent=message;$('error').hidden=!message;}
function updateButton(){
  if(quote && quote.expires<=Date.now()){quote=null;$('quote-status').textContent='Cotação expirada. Recalcule para continuar.';$('recalculate').hidden=false;}
  $('generate').disabled=!configured||running||submitting||preparing||!quote;
  $('count-minus').disabled=count===1||running||submitting;
  $('count-plus').disabled=count===4||running||submitting;
  $('generate').textContent=submitting?'Enviando geração…':running?'Transformando…':preparing?'Calculando créditos…':quote?`Gerar por ${quote.credits.toLocaleString('pt-BR')} Créditos`:'Gerar';
}
function modeChanged(){const mode=$('mode').value;$('mode-help').textContent=descriptions[mode];$('refs-help').textContent=mode==='restyle'?'De 0 a 5 imagens de personagens. Até 64 MiB por arquivo.':'De 1 a 8 imagens de personagens, produtos ou cenários. Até 64 MiB por arquivo.';$('preset-area').hidden=mode!=='restyle';$('mode-limits').textContent=mode==='object-swap'?'O vídeo original precisa ter pelo menos 409.600 pixels por quadro.':'Duração e enquadramento acompanham o vídeo original.';$('model-label').textContent='GENJUTSU · '+mode.replace('-',' ').toUpperCase();invalidate();}
function invalidate(){version++;quote=null;clearTimeout(quoteTimer);updateButton();quoteTimer=setTimeout(prepareQuote,650);}
function inputs(){
  const mode=$('mode').value, file=$('video-file').files[0], images=[...$('images').files];
  if(!file||!metadata)throw Error('Adicione um vídeo legível para calcular o custo.');
  if(file.size>200*1024*1024 || (file.type!=='video/mp4'&&!file.name.toLowerCase().endsWith('.mp4')))throw Error('Use um MP4 de até 200 MiB.');
  if(!Number.isFinite(metadata.duration)||metadata.duration<4)throw Error('O vídeo precisa ter pelo menos 4 segundos.');
  if(mode==='object-swap'&&metadata.width*metadata.height<409600)throw Error('Object Swap exige pelo menos 409.600 pixels por quadro.');
  const min=mode==='restyle'?0:1,max=mode==='restyle'?5:8;
  if(images.length<min||images.length>max)throw Error(`Adicione de ${min} a ${max} imagens de referência.`);
  if(images.some(f=>f.size>64*1024*1024||!['image/jpeg','image/png','image/webp','image/gif'].includes(f.type)))throw Error('Use imagens JPG, PNG, WebP ou GIF de até 64 MiB.');
  if(mode==='restyle'&&!$('preset').value)throw Error('Selecione um estilo para calcular o custo.');
  return {file,images,payload:{mode,count,prompt:$('prompt').value,resolution:$('resolution').value,...(mode==='restyle'?{preset_id:$('preset').value}:{})}};
}
async function upload(file){
  if(uploads.has(file))return uploads.get(file);
  $('quote-status').textContent=`Enviando ${file.name} para cotação…`;
  const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':file.type||'video/mp4'},body:file});
  const d=await r.json();if(!r.ok)throw Error(d.error);uploads.set(file,d.url);return d.url;
}
async function prepareQuote(){
  if(preparing||running||submitting)return;
  if(!configured){$('quote-status').textContent='Conecte sua conta para calcular o custo.';return;}
  let selection;try{selection=inputs();}catch(e){$('quote-status').textContent=e.message;return;}
  const revision=version;preparing=true;quote=null;updateButton();error('');$('recalculate').hidden=true;
  try{
    const video_url=await upload(selection.file),image_urls=[];
    for(const file of selection.images){if(revision!==version)return;image_urls.push(await upload(file));}
    if(revision!==version)return;
    $('quote-status').textContent='Consultando o custo desta geração…';
    const r=await fetch('/api/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selection.payload,video_url,image_urls})});
    const d=await r.json();if(!r.ok)throw Error(d.error);
    if(revision!==version)return;
    quote=d;$('quote-status').textContent=`${d.seconds} s cobrados · ${d.credits.toLocaleString('pt-BR')} créditos · ${d.count} ${d.count===1?'vídeo':'vídeos'} (${d.unitCredits} por vídeo). Cotação válida por 5 minutos.`;
  }catch(e){if(revision===version){$('quote-status').textContent=e.message||'Falha ao calcular o custo.';$('recalculate').hidden=false;}}
  finally{preparing=false;updateButton();if(revision!==version)quoteTimer=setTimeout(prepareQuote,300);}
}
$('recalculate').addEventListener('click',invalidate);
$('mode').addEventListener('change',modeChanged);$('resolution').addEventListener('change',invalidate);$('prompt').addEventListener('input',invalidate);
function resizePrompt(){const field=$('prompt');field.style.height='auto';field.style.height=`${field.scrollHeight}px`;}
$('prompt').addEventListener('input',resizePrompt);
let promptWidth=0;
new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==promptWidth){promptWidth=width;resizePrompt();}}).observe($('prompt'));
resizePrompt();
$('video-file').addEventListener('change',()=>{metadata=null;if(sourceObject)URL.revokeObjectURL(sourceObject);const file=$('video-file').files[0];$('source').hidden=!file;$('video-info').textContent='';if(file){sourceObject=URL.createObjectURL(file);$('source').src=sourceObject;}invalidate();});
$('source').addEventListener('loadedmetadata',()=>{metadata={duration:$('source').duration,width:$('source').videoWidth,height:$('source').videoHeight};$('video-info').textContent=`${metadata.duration.toFixed(1)} s · ${metadata.width} × ${metadata.height} pixels`;invalidate();});
$('source').addEventListener('error',()=>{metadata=null;invalidate();});
$('images').addEventListener('change',()=>{thumbnailUrls.forEach(URL.revokeObjectURL);thumbnailUrls=[];$('thumbs').replaceChildren();for(const file of [...$('images').files].slice(0,8)){const img=document.createElement('img');img.alt=file.name;img.src=URL.createObjectURL(file);thumbnailUrls.push(img.src);$('thumbs').append(img);}invalidate();});
$('load-presets').addEventListener('click',async()=>{
  $('load-presets').disabled=true;$('preset-message').textContent='Consultando estilos…';
  try{const r=await fetch('/api/presets'),d=await r.json();if(!r.ok)throw Error(d.error);catalog=d.items;$('preset').replaceChildren(new Option('Selecione um estilo',''));for(const item of catalog)$('preset').add(new Option(item.name,item.id));$('preset-preview').hidden=true;$('preset-message').textContent=catalog.length?`${catalog.length} estilos disponíveis.`:'Nenhum estilo disponível.';invalidate();}
  catch(e){$('preset-message').textContent=e.message;}finally{$('load-presets').disabled=false;}
});
$('preset').addEventListener('change',()=>{const item=catalog.find(x=>x.id===$('preset').value);$('preset-preview').hidden=!item?.preview_url;if(item?.preview_url)$('preset-preview').src=item.preview_url;invalidate();});
function updateTime(){if(!running||!job)return;const elapsed=Math.max(0,Math.floor((Date.now()-(job.startedAt||Date.now()))/1000));const total=job.count||1,active=job.items?.[job.activeIndex||0]||job;$('elapsed').textContent=`Tempo decorrido: ${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;$('eta').textContent=elapsed<900*total?`Estimativa inicial total: ${5*total}–${15*total} minutos (aproximada)`:'Levando mais tempo que a estimativa inicial.';$('loading-title').textContent=`Vídeo ${(job.activeIndex||0)+1} de ${total} · ${active.phase==='queued'?'na fila':active.phase==='submitting'?'preparando':'gerando'}`;}
function playerTime(seconds){const value=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0;return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}
let backdropFrame=0;
function drawVideoBackdrop(){
  const video=$('video'),canvas=$('video-backdrop');
  if(video.readyState<2||!video.videoWidth)return;
  const scale=480/Math.max(video.videoWidth,video.videoHeight);
  const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  canvas.getContext('2d').drawImage(video,0,0,width,height);
}
function animateVideoBackdrop(){
  cancelAnimationFrame(backdropFrame);drawVideoBackdrop();
  if(!$('video').paused&&!$('video').ended)backdropFrame=requestAnimationFrame(animateVideoBackdrop);
}
for(const event of ['loadeddata','seeked','pause','ended'])$('video').addEventListener(event,drawVideoBackdrop);
$('video').addEventListener('play',animateVideoBackdrop);
$('video').addEventListener('emptied',()=>{cancelAnimationFrame(backdropFrame);const canvas=$('video-backdrop');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);});
function syncPlayer(){
  const video=$('video'),duration=Number.isFinite(video.duration)?video.duration:0,paused=video.paused||video.ended;
  $('result-player').classList.toggle('is-paused',paused);
  $('player-toggle').setAttribute('aria-label',paused?'Reproduzir vídeo':'Pausar vídeo');
  $('player-current').textContent=playerTime(video.currentTime);$('player-duration').textContent=playerTime(duration);
  const progress=duration?video.currentTime/duration*100:0;
  $('player-seek').value=progress;$('player-seek').disabled=!duration;
  $('player-seek').style.setProperty('--progress',`${progress}%`);
  $('player-seek').setAttribute('aria-valuetext',`${playerTime(video.currentTime)} de ${playerTime(duration)}`);
}
async function togglePlayback(){
  if($('video').paused){try{await $('video').play();$('player-error').hidden=true;}catch{$('player-error').textContent='Não foi possível reproduzir. Tente novamente.';$('player-error').hidden=false;}}
  else $('video').pause();
}
$('player-toggle').addEventListener('click',togglePlayback);
$('video').addEventListener('click',togglePlayback);
for(const event of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','emptied'])$('video').addEventListener(event,syncPlayer);
$('player-seek').addEventListener('input',()=>{if(Number.isFinite($('video').duration)){$('video').currentTime=Number($('player-seek').value)/100*$('video').duration;syncPlayer();}});
let historySelection=null,historySignature='',historyItems=[],historyPage=0;
function renderHistory(){
    const items=historyItems;
    const pages=Math.max(1,Math.ceil(items.length/6));historyPage=Math.min(historyPage,pages-1);
    $('history-pages').hidden=pages<=1;$('history-prev').disabled=historyPage===0;$('history-next').disabled=historyPage===pages-1;$('history-page').textContent=`${historyPage+1}/${pages}`;
    $('history-empty').hidden=items.length>0;$('history-list').replaceChildren();
    for(const item of items.slice(historyPage*6,historyPage*6+6)){const button=document.createElement('button');button.type='button';button.className='history-item';button.dataset.id=item.id;
      button.setAttribute('aria-pressed',String(historySelection?.id===item.id));
      const preview=document.createElement('video');preview.src=item.url;preview.preload='metadata';preview.muted=true;preview.playsInline=true;preview.tabIndex=-1;preview.setAttribute('aria-hidden','true');
      const label=document.createElement('span');label.textContent=new Date(item.completedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});button.append(preview,label);button.setAttribute('aria-label',`Abrir vídeo de ${label.textContent}`);
      button.addEventListener('click',()=>{historySelection=item;renderResults();});$('history-list').append(button);
    }
}
$('history-prev').addEventListener('click',()=>{if(historyPage>0){historyPage--;renderHistory();}});
$('history-next').addEventListener('click',()=>{if((historyPage+1)*6<historyItems.length){historyPage++;renderHistory();}});
async function refreshHistory(){
  try{const response=await fetch('/api/history');if(!response.ok)return;const {items}=await response.json();const signature=JSON.stringify(items);if(signature===historySignature)return;historySignature=signature;
    historyItems=items;renderHistory();
  }catch{}
}
function renderResults(){
  const items=job?.items|| (job?[job]:[]);
  if(resultJobId!==job?.id){resultJobId=job?.id;selectedResult=0;resultSignature='';lastUrl='';}
  const selected=historySelection||items[selectedResult], complete=selected?.status==='completed'&&selected.url;
  $('video').hidden=!complete;$('empty').hidden=Boolean(complete)||running;$('loading').hidden=!running||Boolean(complete);$('download').hidden=!complete;
  $('result-player').hidden=!complete;
  if(!complete)$('video').pause();
  if(complete){if(lastUrl!==selected.url){lastUrl=selected.url;$('video').src=lastUrl;}$('download').href=historySelection?`/api/download?history=${encodeURIComponent(selected.id)}`:`/api/download?index=${selectedResult}`;}
  document.querySelectorAll('.history-item').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.id===selected?.id)));
  const signature=JSON.stringify(items.map(i=>i.status))+':'+selectedResult;
  if(signature!==resultSignature){
    resultSignature=signature;$('batch-results').replaceChildren();$('batch-results').hidden=items.length<2;
    const labels={completed:'Pronto',running:'Gerando',pending:'Aguardando',failed:'Falhou',unverified:'Não verificado',not_submitted:'Não enviado'};
    items.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.textContent=`Vídeo ${index+1}`;button.setAttribute('aria-pressed',String(index===selectedResult));const state=document.createElement('span');state.className='batch-state';state.textContent=labels[item.status]||item.status;button.append(state);button.title=item.message;button.disabled=item.status!=='completed';button.addEventListener('click',()=>{historySelection=null;selectedResult=index;renderResults();});$('batch-results').append(button);});
  }
}
function render(data){
  configured=data.configured;job=data.job;running=job?.status==='running';$('setup').hidden=configured;updateButton();
  $('badge').hidden=job?.status==='completed';
  $('badge').textContent=running?'EM PRODUÇÃO':job?.status==='completed'?'':job?.status==='partial'?'PARCIAL':job?'NÃO CONCLUÍDO':'AGUARDANDO';
  $('status').hidden=job?.status==='completed';
  $('status').textContent=job?.status==='completed'?'':job?.message||(configured?'Adicione seu vídeo e prepare a transformação.':'Configure sua credencial para começar.');
  renderResults();
  updateTime();
}
async function refresh(){try{const r=await fetch('/api/status');if(r.status===401){location.href='/login';return;}if(!r.ok)throw Error();render(await r.json());}catch{configured=false;updateButton();$('status').textContent='Conexão interrompida. Tentando reconectar…';}}
$('form').addEventListener('submit',async e=>{
  e.preventDefault();if(running||submitting||!quote||quote.expires<=Date.now())return;
  historySelection=null;submitting=true;updateButton();error('');const quoteId=quote.id;
  try{const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId})});const d=await r.json();if(!r.ok)throw Error(d.error);running=true;quote=null;}
  catch(e){quote=null;error(e.message||'Confira seu pedido antes de repetir a geração.');$('recalculate').hidden=false;}
  finally{submitting=false;await refresh();}
});
async function loadProfile(){try{const r=await fetch('/api/profile');if(!r.ok)return;const p=await r.json();$('header-initial').textContent=p.name.trim().slice(0,1).toUpperCase();$('header-credits').textContent=Number.isFinite(p.credits)?`${p.credits.toLocaleString('pt-BR')} créditos`:'0 créditos';$('header-credits').parentElement.title=Number.isFinite(p.credits)?'Seu saldo disponível':'Carteira de créditos ainda não ativada';if(p.avatar){$('header-avatar').src=p.avatar;$('header-avatar').hidden=false;$('header-initial').hidden=true;}}catch{}}
let creditPlans=[],selectedPlan='starter';
const currency=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function checkoutUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(url.hostname==='cakto.com.br'||url.hostname.endsWith('.cakto.com.br'))?url.href:null;}catch{return null;}}
function choosePlan(id){
  selectedPlan=id;const plan=creditPlans.find(p=>p.id===id);
  document.querySelectorAll('.credit-plan').forEach(button=>{button.setAttribute('aria-checked',String(button.dataset.plan===id));button.tabIndex=button.dataset.plan===id?0:-1;});
  $('checkout-total').textContent=plan?currency(plan.price):'—';
  const ready=plan&&checkoutUrl(plan.checkoutUrl);
  $('checkout-button').disabled=!ready;
  $('checkout-message').textContent=ready?`${plan.credits.toLocaleString('pt-BR')} créditos no pacote ${plan.name}.`:'O checkout deste pacote ainda não está disponível.';
}
async function openCredits(){
  $('credits-modal').showModal();$('checkout-button').disabled=true;$('checkout-message').textContent='Carregando pacotes…';
  try{
    const response=await fetch('/api/plans');if(!response.ok)throw Error();
    creditPlans=(await response.json()).plans;$('credit-plans').replaceChildren();
    for(const plan of creditPlans){
      const button=document.createElement('button');button.type='button';button.className='credit-plan';button.dataset.plan=plan.id;button.setAttribute('role','radio');button.setAttribute('aria-label',`${plan.name}, ${plan.credits} créditos, ${currency(plan.price)}`);
      if(plan.id==='pro'){button.classList.add('credit-plan-popular');const badge=document.createElement('span');badge.className='plan-popular-badge';badge.textContent='POPULAR';button.append(badge);button.setAttribute('aria-label',`${plan.name}, popular, ${plan.credits} créditos, ${currency(plan.price)}`);}
      for(const [className,text] of [['plan-name',plan.name],['plan-credits',`${plan.credits.toLocaleString('pt-BR')} créditos`],['plan-price',currency(plan.price)],['unit-price',`${currency(plan.price/plan.credits*100)} por 100 créditos`]]){const span=document.createElement('span');span.className=className;span.textContent=text;button.append(span);}
      button.addEventListener('click',()=>choosePlan(plan.id));
      button.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const offset=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;const index=(creditPlans.findIndex(p=>p.id===plan.id)+offset+creditPlans.length)%creditPlans.length;choosePlan(creditPlans[index].id);$('credit-plans').children[index].focus();});
      $('credit-plans').append(button);
    }
    if(!creditPlans.some(p=>p.id===selectedPlan))selectedPlan=creditPlans[0]?.id;
    choosePlan(selectedPlan);
  }catch{$('checkout-message').textContent='Não foi possível carregar os pacotes. Feche e tente novamente.';}
}
$('add-credits').addEventListener('click',openCredits);
$('close-credits').addEventListener('click',()=>$('credits-modal').close());
$('credits-modal').addEventListener('click',event=>{if(event.target!==$('credits-modal'))return;const rect=$('credits-modal').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('credits-modal').close();});
$('credits-modal').addEventListener('close',()=>$('add-credits').focus());
$('checkout-button').addEventListener('click',()=>{const plan=creditPlans.find(p=>p.id===selectedPlan);const url=checkoutUrl(plan?.checkoutUrl);if(url)window.location.assign(url);});
function customSelect(id){
  const select=$(id),label=document.querySelector(`label[for="${id}"]`),wrapper=document.createElement('div');
  wrapper.className='custom-select';select.before(wrapper);wrapper.append(select);select.hidden=true;
  const trigger=document.createElement('button'),menu=document.createElement('div');
  trigger.type='button';trigger.id=`${id}-trigger`;trigger.className='select-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',label.textContent);label.htmlFor=trigger.id;
  menu.id=`${id}-menu`;menu.className='select-menu';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label.textContent);trigger.setAttribute('aria-controls',menu.id);wrapper.append(trigger,menu);
  const options=[...select.options].map(option=>{const button=document.createElement('button');button.type='button';button.className='select-option';button.setAttribute('role','option');button.textContent=option.textContent;button.dataset.value=option.value;button.tabIndex=-1;menu.append(button);button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);});return button;});
  function sync(){trigger.textContent=select.selectedOptions[0].textContent;options.forEach(button=>button.setAttribute('aria-selected',String(button.dataset.value===select.value)));}
  function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
  function open(){menu.hidden=false;trigger.setAttribute('aria-expanded','true');options[select.selectedIndex].focus();}
  trigger.addEventListener('click',()=>menu.hidden?open():close());
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
  menu.addEventListener('keydown',event=>{const index=options.indexOf(document.activeElement);let next=index;if(event.key==='ArrowDown')next=(index+1)%options.length;else if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else if(event.key==='Escape'){event.preventDefault();close(true);return;}else if(event.key==='Tab'){close();return;}else return;event.preventDefault();options[next].focus();});
  document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
  wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close();});
  select.addEventListener('change',sync);sync();
}
customSelect('mode');customSelect('resolution');
async function poll(){if(!submitting){await refresh();await refreshHistory();}setTimeout(poll,2500);}
setInterval(()=>{updateTime();updateButton();},1000);modeChanged();loadProfile();poll();
