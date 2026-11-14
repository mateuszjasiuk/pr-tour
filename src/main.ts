function highlight() {
  $('#diff').querySelectorAll('.tour-hl').forEach((el) => el.classList.remove('tour-hl'));
  $('#diff').querySelectorAll('.tour-note').forEach((el) => el.remove());
  document.querySelector('.missing')?.remove();
  const s = tour.steps[current];
  if (!s) return;
  const rows = rowsFor(s);
  if (!rows.length) {
    $('#side').insertAdjacentHTML('afterbegin', `<div class="missing">${noteHtml(s)}${s.file ? outsideDiff(s) : ''}</div>`);
    return;
  }
  rows.forEach((tr) => tr.classList.add('tour-hl'));
  rows[rows.length - 1].insertAdjacentHTML('afterend', `<tr class="tour-note"><td colspan="2">${noteHtml(s)}</td></tr>`);

  // Przewiń TYLKO w pionie wewnątrz #diff — nie ruszaj scrolla poziomego ani body
  const diffEl = $('#diff');
  const rowRect = rows[0].getBoundingClientRect();
  const diffRect = diffEl.getBoundingClientRect();
  const target = diffEl.scrollTop + rowRect.top - diffRect.top - diffEl.clientHeight / 2 + rows[0].clientHeight / 2;
  diffEl.scrollTo({ top: target, behavior: 'smooth' });
}