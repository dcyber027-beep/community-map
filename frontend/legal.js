// Back-button handler for the static legal pages (privacy / terms / support).
// Kept as an external file (not an inline onclick) so it satisfies the strict
// Content-Security-Policy, which intentionally omits 'unsafe-inline' for
// script-src and therefore blocks inline event handlers.
(function () {
  function goBack() {
    // Prefer real history when the page was opened from within the app; fall
    // back to the map for a direct visit (e.g. the Play Store privacy URL).
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector(".legal-back-btn");
    if (btn) {
      btn.addEventListener("click", goBack);
    }
  });
})();
