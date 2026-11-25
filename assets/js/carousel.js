(() => {
  "use strict";

  // === 01. ELEMENTOS E TEMPO DE TROCA ===
  // Usa #educacao do index.html. Troque imagens e textos nos slides do HTML e o intervalo abaixo.
  const ROTATION_INTERVAL_MS = 8000;
  const carousel = document.querySelector("#educacao");
  const slides = [...carousel.querySelectorAll(".carousel-slide")];
  const dots = [...carousel.querySelectorAll("[data-carousel-index]")];
  const pause = document.querySelector("#carousel-pause");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let current = 0;
  let paused = reducedMotion.matches;
  let hovered = false;
  let focused = false;
  let timer;

  // === 02. MOSTRAR A DICA ===
  // Alterna .carousel-slide e os indicadores data-carousel-index. Ao adicionar slides, ajuste os indicadores no HTML.
  function showSlide(index, announce = true) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => { slide.hidden = position !== current; });
    dots.forEach((dot, position) => {
      dot.classList.toggle("is-active", position === current);
      dot.setAttribute("aria-pressed", String(position === current));
    });
    if (announce) document.querySelector("#carousel-status").textContent = `Dica ${current + 1} de ${slides.length}: ${slides[current].querySelector("h3").textContent}`;
  }

  // === 03. ROTACAO AUTOMATICA ===
  // Respeita pausa, foco e movimento reduzido. ROTATION_INTERVAL_MS define o tempo em milissegundos.
  function updateRotation() {
    clearInterval(timer);
    pause.disabled = reducedMotion.matches;
    pause.setAttribute("aria-pressed", String(paused || reducedMotion.matches));
    pause.textContent = reducedMotion.matches ? "Rotação pausada" : paused ? "Retomar rotação" : "Pausar rotação";
    if (!paused && !reducedMotion.matches && !hovered && !focused && !document.hidden) {
      timer = setInterval(() => showSlide(current + 1, false), ROTATION_INTERVAL_MS);
    }
  }

  // === 04. CONTROLES E PAUSAS ===
  // Liga botões, setas, Home e End. A troca pausa durante a leitura ou quando a página fica oculta.
  carousel.querySelector("[data-carousel-previous]").addEventListener("click", () => showSlide(current - 1));
  carousel.querySelector("[data-carousel-next]").addEventListener("click", () => showSlide(current + 1));
  dots.forEach((dot) => dot.addEventListener("click", () => showSlide(Number(dot.dataset.carouselIndex))));
  carousel.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    showSlide(event.key === "Home" ? 0 : event.key === "End" ? slides.length - 1 : current + (event.key === "ArrowLeft" ? -1 : 1));
  });
  pause.addEventListener("click", () => { paused = !paused; updateRotation(); });
  carousel.addEventListener("mouseenter", () => { hovered = true; updateRotation(); });
  carousel.addEventListener("mouseleave", () => { hovered = false; updateRotation(); });
  carousel.addEventListener("focusin", () => { focused = true; updateRotation(); });
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) { focused = false; updateRotation(); }
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) paused = true;
    updateRotation();
  });
  document.addEventListener("visibilitychange", updateRotation);
  updateRotation();
})();
