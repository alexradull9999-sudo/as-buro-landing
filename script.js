const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const gallery = $('#gallery'), menu = $('#menu'), callback = $('#callback-dialog');
const dialogOpeners = new WeakMap();
let current = null, photo = 0;

function openDialog(dialog, trigger) {
  // Restore focus to the visible launcher when moving between dialogs.
  const parentDialog = trigger?.closest('dialog');
  const opener = parentDialog ? dialogOpeners.get(parentDialog) : trigger;
  dialogOpeners.set(dialog, opener);
  for (const other of $$('dialog[open]')) if (other !== dialog) other.close();
  if (!dialog.open) dialog.showModal();
  $('[data-dialog-focus]', dialog)?.focus({preventScroll:true});
}
function closeDialog(dialog) {dialog.close();}
function showPhoto() {
  if (!current) return;
  const asset = current.images[photo];
  $('#gallery-image').src = asset;
  $('#gallery-image').alt = current.alts?.[photo] || current.title + ' · лист портфолио ' + (photo + 1);
  $('#gallery-full').href = asset;
  $('#gallery-count').textContent = String(photo + 1).padStart(2,'0') + ' / ' + String(current.images.length).padStart(2,'0');
  $$('[data-thumb]',gallery).forEach((button,i) => button.setAttribute('aria-current', String(i === photo)));
  $('#gallery-prev').disabled = current.images.length < 2;
  $('#gallery-next').disabled = current.images.length < 2;
}
function openProject(id,index,trigger) {
  current = window.LANDING_PROJECTS.find(project => project.id === id);
  if (!current) return;
  photo = Math.min(Math.max(index,0),current.images.length - 1);
  $('#gallery-title').textContent = current.title;
  $('#gallery-description').textContent = current.description;
  $('#gallery-thumbs').replaceChildren(...current.images.map((src,i) => {
    const button = document.createElement('button');
    button.type = 'button';button.dataset.thumb = i;
    button.setAttribute('aria-label','Показать лист портфолио ' + (i + 1));
    const img = document.createElement('img');img.src = src;img.alt = '';img.loading = 'lazy';
    button.append(img);return button;
  }));
  showPhoto();openDialog(gallery,trigger);
}
document.addEventListener('click', event => {
  const callbackTrigger = event.target.closest('[data-callback-open]');
  if (callbackTrigger) {
    event.preventDefault();
    $('#callback-form').elements.namedItem('Кнопка обращения').value = callbackTrigger.textContent.replace(/↗/g,'').trim();
    openDialog(callback, callbackTrigger);
    return;
  }
  const project = event.target.closest('[data-project]');
  if (project) openProject(project.dataset.project,Number(project.dataset.start) || 0,project);
  const thumb = event.target.closest('[data-thumb]');
  if (thumb) {photo = Number(thumb.dataset.thumb);showPhoto();}
  if (event.target.closest('[data-close]')) closeDialog(event.target.closest('dialog'));
  const menuTrigger = event.target.closest('[data-menu-open]');
  if (menuTrigger) openDialog(menu,menuTrigger);
  if (event.target.closest('[data-menu-link]')) menu.close();
});
$('#gallery-prev').addEventListener('click', () => {photo = (photo - 1 + current.images.length) % current.images.length;showPhoto();});
$('#gallery-next').addEventListener('click', () => {photo = (photo + 1) % current.images.length;showPhoto();});
gallery.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') {$('#gallery-prev').click();event.preventDefault();}
  if (event.key === 'ArrowRight') {$('#gallery-next').click();event.preventDefault();}
});
for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
  });
  dialog.addEventListener('close', () => {
    if ($('dialog[open]')) return;
    const opener = dialogOpeners.get(dialog);
    if (opener?.isConnected && opener.getClientRects().length) opener.focus({preventScroll:true});
  });
}
