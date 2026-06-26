function createViewer(photos) {
  const viewer = document.createElement("div");
  const image = document.createElement("img");
  const previousButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const closeButton = document.createElement("button");
  let currentIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartedOnControl = false;
  let touchWasMultiTouch = false;
  const preloadedPhotos = new Set();

  viewer.className = "photo-viewer";
  viewer.hidden = true;
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Photo viewer");

  image.className = "photo-viewer-image";
  image.alt = "";

  previousButton.className = "photo-viewer-control photo-viewer-previous";
  previousButton.type = "button";
  previousButton.textContent = "Previous";
  previousButton.setAttribute("aria-label", "Previous photo");

  nextButton.className = "photo-viewer-control photo-viewer-next";
  nextButton.type = "button";
  nextButton.textContent = "Next";
  nextButton.setAttribute("aria-label", "Next photo");

  closeButton.className = "photo-viewer-close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close photo viewer");

  function getWrappedIndex(index) {
    return (index + photos.length) % photos.length;
  }

  function preloadPhoto(index) {
    const photo = photos[getWrappedIndex(index)];

    if (!photo || !photo.src || preloadedPhotos.has(photo.src)) {
      return;
    }

    preloadedPhotos.add(photo.src);

    const preloadImage = new Image();
    preloadImage.decoding = "async";
    preloadImage.src = photo.src;

    if (preloadImage.decode) {
      preloadImage.decode().catch(() => {});
    }
  }

  function preloadNearbyPhotos() {
    if (photos.length < 2) {
      return;
    }

    preloadPhoto(currentIndex - 2);
    preloadPhoto(currentIndex - 1);
    preloadPhoto(currentIndex + 1);
    preloadPhoto(currentIndex + 2);
  }

  function updateViewer() {
    const photo = photos[currentIndex];

    image.src = photo.src;
    image.alt = photo.alt || "";
    previousButton.disabled = photos.length < 2;
    nextButton.disabled = photos.length < 2;
    preloadNearbyPhotos();
  }

  function openViewer(index) {
    currentIndex = index;
    updateViewer();
    viewer.hidden = false;
    document.body.classList.add("viewer-open");
    closeButton.focus();
  }

  function closeViewer() {
    viewer.hidden = true;
    document.body.classList.remove("viewer-open");
  }

  function showPrevious() {
    currentIndex = getWrappedIndex(currentIndex - 1);
    updateViewer();
  }

  function showNext() {
    currentIndex = getWrappedIndex(currentIndex + 1);
    updateViewer();
  }

  function isViewerControl(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return element.closest("button");
  }

  function handleTouchStart(event) {
    if (photos.length < 2) {
      return;
    }

    if (event.touches.length > 1) {
      touchWasMultiTouch = true;
      return;
    }

    const touch = event.touches[0];

    touchWasMultiTouch = false;
    touchStartedOnControl = isViewerControl(event.target);
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }

  function handleTouchMove(event) {
    if (event.touches.length > 1) {
      touchWasMultiTouch = true;
    }
  }

  function resetTouch() {
    touchStartedOnControl = false;
    touchWasMultiTouch = false;
  }

  function handleTouchEnd(event) {
    if (touchWasMultiTouch) {
      if (event.touches.length === 0) {
        resetTouch();
      }

      return;
    }

    if (photos.length < 2 || touchStartedOnControl || event.changedTouches.length !== 1) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    const swipeDistance = 48;
    const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;

    if (!horizontalIntent || Math.abs(deltaX) < swipeDistance) {
      if (event.touches.length === 0) {
        resetTouch();
      }

      return;
    }

    if (deltaX < 0) {
      showNext();
    } else {
      showPrevious();
    }

    resetTouch();
  }

  previousButton.addEventListener("click", showPrevious);
  nextButton.addEventListener("click", showNext);
  closeButton.addEventListener("click", closeViewer);
  viewer.addEventListener("touchstart", handleTouchStart, { passive: true });
  viewer.addEventListener("touchmove", handleTouchMove, { passive: true });
  viewer.addEventListener("touchend", handleTouchEnd, { passive: true });
  viewer.addEventListener("touchcancel", resetTouch, { passive: true });
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) {
      closeViewer();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (viewer.hidden) {
      return;
    }

    if (event.key === "Escape") {
      closeViewer();
    }

    if (event.key === "ArrowLeft") {
      showPrevious();
    }

    if (event.key === "ArrowRight") {
      showNext();
    }
  });

  viewer.append(closeButton, previousButton, image, nextButton);
  document.body.append(viewer);

  return openViewer;
}

async function loadPhotos() {
  const grid = document.querySelector("[data-photo-grid]");
  const emptyState = document.querySelector("[data-empty-state]");

  if (!grid || !emptyState) {
    return;
  }

  try {
    const response = await fetch("data/photos.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Unable to load photos: ${response.status}`);
    }

    const photos = await response.json();

    if (!Array.isArray(photos) || photos.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const openViewer = createViewer(photos);

    photos.forEach((photo, index) => {
      if (!photo || !photo.src) {
        return;
      }

      const figure = document.createElement("figure");
      const button = document.createElement("button");
      const image = document.createElement("img");

      figure.className = "photo-item";
      button.className = "photo-button";
      button.type = "button";
      button.setAttribute("aria-label", `Open photo ${index + 1}`);
      image.src = photo.thumb || photo.src;
      image.alt = photo.alt || "";
      image.loading = index < 15 ? "eager" : "lazy";
      image.decoding = "async";

      button.addEventListener("click", () => openViewer(index));
      button.append(image);
      figure.append(button);
      fragment.append(figure);
    });

    if (!fragment.childElementCount) {
      return;
    }

    grid.append(fragment);
    grid.hidden = false;
    emptyState.hidden = true;
  } catch (error) {
    console.warn(error.message);
  }
}

loadPhotos();
