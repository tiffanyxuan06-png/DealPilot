// =========================================================================
// UI MOTION: fade cards up once as they scroll into view
// =========================================================================
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = !reduce && 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.15 })
    : null;

  // Called on page switch so cards on a freshly shown page animate in again
  window.revealIn = function (root) {
    (root || document).querySelectorAll('.reveal').forEach(el => {
      if (!io) { el.classList.add('is-in'); return; }
      el.classList.remove('is-in');
      io.observe(el);
    });
  };

  window.revealIn(document);
})();
