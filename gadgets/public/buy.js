// Buy button: asks the checkout worker for a Stripe Checkout URL and goes there.
const endpoint = document.body.dataset.buyEndpoint || '';
for (const button of document.querySelectorAll('[data-buy-slug]')) {
  const note = button.parentElement.querySelector('[data-buy-note]');
  button.addEventListener('click', async () => {
    if (!endpoint) { if (note) note.textContent = 'Checkout is not set up on this preview yet.'; return; }
    button.disabled = true; button.textContent = 'Opening checkout…';
    try {
      const response = await fetch(`${endpoint}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: button.dataset.buySlug }) });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Checkout could not start.');
      location.assign(data.url);
    } catch (error) {
      button.disabled = false; button.textContent = button.dataset.buyLabel;
      if (note) note.textContent = error.message;
    }
  });
}

// Confirmation page: shows the order once the webhook has recorded it.
const thanks = document.querySelector('[data-order-status]');
if (thanks) {
  const session = new URLSearchParams(location.search).get('session');
  const render = text => { thanks.textContent = text; };
  if (!endpoint || !session) render('Your payment went through. A confirmation email is on its way.');
  else {
    let tries = 0;
    const poll = async () => {
      tries += 1;
      try {
        const response = await fetch(`${endpoint}/orders/lookup?session=${encodeURIComponent(session)}`);
        if (response.status === 202 && tries < 8) return setTimeout(poll, 1500);
        const data = await response.json();
        if (!response.ok || data.pending) return render('Your payment went through. A confirmation email is on its way.');
        render(`Order ${data.id}: ${data.name} for ${data.total}. ${data.maker} will ship it${data.leadTime ? ` (${data.leadTime.toLowerCase()})` : ''}. ${data.email ? `A confirmation is on its way to ${data.email}.` : ''}`);
      } catch { render('Your payment went through. A confirmation email is on its way.'); }
    };
    poll();
  }
}
