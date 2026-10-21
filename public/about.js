// About: this instance's name (APP_NAME) in the title and the way back; the optional sources it has no key for (or the
// weather, off) leave the credits. If /api/config doesn't answer, all stay
fetch('api/config').then((r) => r.json()).then((c) => {
  if (c.name) { document.title = `About · ${c.name}`; document.querySelector('.back a').textContent = `← ${c.name}`; }
  const on = { ...c.sources, weather: c.weather };
  for (const el of document.querySelectorAll('[data-source]')) if (!on[el.dataset.source]) el.remove();
}).catch(() => {});
