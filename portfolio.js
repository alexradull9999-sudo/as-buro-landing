const cards = [...document.querySelectorAll('[data-project-style]')];
const filters = [...document.querySelectorAll('[data-style]')];
const more = document.querySelector('#portfolio-more');
const count = document.querySelector('#portfolio-count');
let style = 'all', expanded = false;

function showProjects() {
  const matches = cards.filter(card => style === 'all' || card.dataset.projectStyle === style);
  const visible = expanded ? matches : matches.slice(0,6);
  cards.forEach(card => card.hidden = !visible.includes(card));
  more.hidden = expanded || matches.length <= 6;
  count.textContent = `Показано ${visible.length} из ${matches.length}` + (style === 'all' ? ' · 5 стилевых направлений' : ` · ${style}`);
  filters.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.style === style)));
}
filters.forEach(button => button.addEventListener('click', () => {style = button.dataset.style;expanded = false;showProjects();}));
more.addEventListener('click', () => {
  const firstNew = cards.filter(card => style === 'all' || card.dataset.projectStyle === style)[6];
  expanded = true;showProjects();firstNew?.focus({preventScroll:true});
});
showProjects();
