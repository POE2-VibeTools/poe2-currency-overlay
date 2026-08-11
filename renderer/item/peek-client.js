// peek-client.js - renders listing-card HTML pushed from main into the peek window.
window.peekApi.onContent((payload) => {
  const { html, alpha, dyslexic, theme } = typeof payload === 'string' ? { html: payload, alpha: 0.97 } : payload;
  const card = document.getElementById('card');
  card.innerHTML = html;
  // match the overlay's background-transparency setting
  // themed: --s-root follows the palette, alpha follows the opacity slider
  card.style.background = `color-mix(in srgb, var(--s-root) ${Math.round(alpha * 1000) / 10}%, transparent)`;
  // mirror the app's dyslexia-friendly font toggle onto this separate window
  document.documentElement.classList.toggle('dyslexic-font', !!dyslexic);
  // separate window, same palette: themes.css keys off this attribute
  document.documentElement.dataset.theme = theme === 'industry' ? 'industry' : 'default';
  // report content height so main can size the window to fit
  requestAnimationFrame(() => {
    window.peekApi.reportHeight(card.scrollHeight + 4);
  });
});
