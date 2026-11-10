// Loaded by both forms; the static deployment retains its native FormSubmit POST.
export async function sendDirect(form, status) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  status.textContent = 'Отправляем заявку…';
  try {
    const response = await fetch(form.action, {
      method: 'POST', credentials: 'same-origin',
      headers: {'Accept': 'application/json'},
      body: new URLSearchParams(new FormData(form)),
      signal: AbortSignal.timeout(45000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    if (!['/thanks.html', '/contact-thanks.html'].includes(result.next)) throw new Error('Не удалось открыть страницу после отправки.');
    window.location.assign(result.next);
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
      ? 'Нет подтверждения отправки. Проверьте соединение и повторите попытку. Также можно позвонить: +7 (499) 674-06-71.'
      : error.message;
  } finally {
    button.disabled = false;
    form.removeAttribute('aria-busy');
  }
}
