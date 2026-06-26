function createViewer(photos) {
  const viewer = document.createElement("div");
  const picture = document.createElement("picture");
  const webpSource = document.createElement("source");
  const image = document.createElement("img");
  const previousButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const closeButton = document.createElement("button");
  let currentIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartedOnControl = false;
  let touchWasMultiTouch = false;
  let touchMoved = false;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let panX = 0;
  let panY = 0;
  let isZoomed = false;
  let isMousePanning = false;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  const zoomScale = 2.4;
  const preloadedPhotos = new Set();

  viewer.className = "photo-viewer";
  viewer.hidden = true;
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Photo viewer");

  picture.className = "photo-viewer-picture";
  webpSource.type = "image/webp";

  image.className = "photo-viewer-image";
  image.alt = "";
  image.sizes = "(max-width: 760px) calc(100vw - 2.4rem), 80vw";

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

  function firstSrcsetCandidate(srcset) {
    if (!srcset) {
      return "";
    }

    return srcset.split(",")[0].trim().split(/\s+/)[0] || "";
  }

  function preloadSource(src) {
    if (!src || preloadedPhotos.has(src)) {
      return;
    }

    preloadedPhotos.add(src);

    const preloadImage = new Image();
    preloadImage.decoding = "async";
    preloadImage.src = src;

    if (preloadImage.decode) {
      preloadImage.decode().catch(() => {});
    }
  }

  function preloadPhoto(index) {
    const photo = photos[getWrappedIndex(index)];
    const preloadSrc = photo
      ? firstSrcsetCandidate(photo.srcWebpSrcset) ||
        firstSrcsetCandidate(photo.srcSrcset) ||
        photo.srcWebp ||
        photo.src
      : "";

    preloadSource(preloadSrc);
  }

  function preloadFullPhoto(index) {
    const photo = photos[getWrappedIndex(index)];
    const preloadSrc = photo ? photo.srcWebp || photo.src : "";

    preloadSource(preloadSrc);
  }

  function setViewerImage(photo) {
    image.sizes = "(max-width: 760px) calc(100vw - 2.4rem), 80vw";

    if (photo.srcWebpSrcset || photo.srcWebp) {
      webpSource.srcset = photo.srcWebpSrcset || photo.srcWebp;
    } else {
      webpSource.removeAttribute("srcset");
    }

    if (photo.srcSrcset) {
      image.srcset = photo.srcSrcset;
    } else {
      image.removeAttribute("srcset");
    }

    image.src = photo.src;
  }

  function upgradeToFullRes(photo) {
    // The viewer's srcset usually loads a smaller candidate; zoom wants the
    // full-resolution file so the close-up stays sharp. Decode it off-screen
    // first, then swap it in. Because the current image keeps showing until the
    // larger one is fully decoded, the upgrade is seamless with no blank flash.
    const fullWebp = photo.srcWebp || "";
    const fullJpeg = photo.src || "";
    const primary = fullWebp || fullJpeg;

    if (!primary) {
      return;
    }

    const loader = new Image();
    loader.decoding = "async";

    const swap = () => {
      // Bail if the user exited zoom or moved to another photo while decoding.
      if (!isZoomed || photos[currentIndex] !== photo) {
        return;
      }

      if (fullWebp) {
        webpSource.srcset = fullWebp;
      } else {
        webpSource.removeAttribute("srcset");
      }

      image.removeAttribute("srcset");
      image.src = fullJpeg;
    };

    loader.src = primary;

    if (loader.decode) {
      loader.decode().then(swap).catch(swap);
    } else {
      loader.onload = swap;
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

  function getPanBounds() {
    const scale = isZoomed ? zoomScale : 1;
    const maxPanX = Math.max(0, (image.clientWidth * (scale - 1)) / 2);
    const maxPanY = Math.max(0, (image.clientHeight * (scale - 1)) / 2);

    return { maxPanX, maxPanY };
  }

  function clampPan() {
    const { maxPanX, maxPanY } = getPanBounds();

    panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
    panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
  }

  function applyZoom() {
    viewer.classList.toggle("photo-viewer-zoomed", isZoomed);

    if (!isZoomed) {
      image.style.transform = "";
      return;
    }

    clampPan();
    image.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoomScale})`;
  }

  function resetZoom() {
    isZoomed = false;
    isPanning = false;
    isMousePanning = false;
    panX = 0;
    panY = 0;
    viewer.classList.remove("photo-viewer-panning");
    applyZoom();
  }

  function zoomInAt(clientX, clientY) {
    const photo = photos[currentIndex];
    const imageRect = image.getBoundingClientRect();
    const offsetX = clientX - (imageRect.left + imageRect.width / 2);
    const offsetY = clientY - (imageRect.top + imageRect.height / 2);

    isZoomed = true;
    panX = -offsetX * (zoomScale - 1);
    panY = -offsetY * (zoomScale - 1);
    applyZoom();

    if (photo) {
      upgradeToFullRes(photo);
    }
  }

  function toggleZoom(clientX, clientY) {
    if (isZoomed) {
      resetZoom();
      return;
    }

    zoomInAt(clientX, clientY);
  }

  function updateViewer() {
    const photo = photos[currentIndex];

    setViewerImage(photo);
    image.alt = photo.alt || "";
    previousButton.disabled = photos.length < 2;
    nextButton.disabled = photos.length < 2;
    preloadNearbyPhotos();
  }

  function openViewer(index) {
    currentIndex = index;
    resetZoom();
    updateViewer();
    viewer.hidden = false;
    document.body.classList.add("viewer-open");
    closeButton.focus();
  }

  function closeViewer() {
    resetZoom();
    viewer.hidden = true;
    document.body.classList.remove("viewer-open");
  }

  function showPrevious() {
    resetZoom();
    currentIndex = getWrappedIndex(currentIndex - 1);
    updateViewer();
  }

  function showNext() {
    resetZoom();
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
    if (event.touches.length > 1) {
      event.preventDefault();
      touchWasMultiTouch = true;
      isPanning = false;
      return;
    }

    const touch = event.touches[0];

    touchWasMultiTouch = false;
    touchStartedOnControl = isViewerControl(event.target);
    touchMoved = false;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;

    if (isZoomed && !touchStartedOnControl) {
      isPanning = true;
      panStartX = touch.clientX;
      panStartY = touch.clientY;
      panOriginX = panX;
      panOriginY = panY;
      viewer.classList.add("photo-viewer-panning");
    }
  }

  function handleTouchMove(event) {
    if (event.touches.length > 1) {
      event.preventDefault();
      touchWasMultiTouch = true;
      isPanning = false;
      viewer.classList.remove("photo-viewer-panning");
      return;
    }

    if (event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if (Math.hypot(deltaX, deltaY) > 8) {
      touchMoved = true;
    }

    if (isZoomed && isPanning) {
      event.preventDefault();
      panX = panOriginX + touch.clientX - panStartX;
      panY = panOriginY + touch.clientY - panStartY;
      applyZoom();
    }
  }

  function resetTouch() {
    touchStartedOnControl = false;
    touchWasMultiTouch = false;
    touchMoved = false;
    isPanning = false;
    viewer.classList.remove("photo-viewer-panning");
  }

  function isDoubleTap(touch) {
    const tapTime = window.performance.now();
    const tapDistance = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
    const doubleTap = tapTime - lastTapTime < 300 && tapDistance < 32;

    lastTapTime = tapTime;
    lastTapX = touch.clientX;
    lastTapY = touch.clientY;

    if (doubleTap) {
      lastTapTime = 0;
    }

    return doubleTap;
  }

  function handleTouchEnd(event) {
    if (touchWasMultiTouch) {
      if (event.touches.length === 0) {
        resetTouch();
      }

      return;
    }

    if (touchStartedOnControl || event.changedTouches.length !== 1) {
      if (event.touches.length === 0) {
        resetTouch();
      }

      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    const tapGesture = Math.hypot(deltaX, deltaY) < 12 && !touchMoved && !touchStartedOnControl;

    if (tapGesture && isDoubleTap(touch)) {
      event.preventDefault();
      toggleZoom(touch.clientX, touch.clientY);
      resetTouch();
      return;
    }

    if (tapGesture) {
      preloadFullPhoto(currentIndex);
    }

    if (isPanning && touchMoved) {
      resetTouch();
      return;
    }

    if (isZoomed) {
      resetTouch();
      return;
    }

    if (photos.length < 2) {
      resetTouch();
      return;
    }

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

  function handleDoubleClick(event) {
    event.preventDefault();
    toggleZoom(event.clientX, event.clientY);
  }

  function beginMousePan(event) {
    if (!isZoomed || event.button !== 0 || isViewerControl(event.target)) {
      return;
    }

    event.preventDefault();
    isPanning = true;
    isMousePanning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panOriginX = panX;
    panOriginY = panY;
    viewer.classList.add("photo-viewer-panning");
  }

  function moveMousePan(event) {
    if (!isMousePanning) {
      return;
    }

    event.preventDefault();
    panX = panOriginX + event.clientX - panStartX;
    panY = panOriginY + event.clientY - panStartY;
    applyZoom();
  }

  function endMousePan() {
    if (!isMousePanning) {
      return;
    }

    isPanning = false;
    isMousePanning = false;
    viewer.classList.remove("photo-viewer-panning");
  }

  previousButton.addEventListener("click", showPrevious);
  nextButton.addEventListener("click", showNext);
  closeButton.addEventListener("click", closeViewer);
  viewer.addEventListener("touchstart", handleTouchStart, { passive: false });
  viewer.addEventListener("touchmove", handleTouchMove, { passive: false });
  viewer.addEventListener("touchend", handleTouchEnd, { passive: false });
  viewer.addEventListener("touchcancel", resetTouch, { passive: true });
  image.addEventListener("dblclick", handleDoubleClick);
  image.addEventListener("mousedown", beginMousePan);
  document.addEventListener("mousemove", moveMousePan);
  document.addEventListener("mouseup", endMousePan);
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

  picture.append(webpSource, image);
  viewer.append(closeButton, previousButton, picture, nextButton);
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
      const picture = document.createElement("picture");
      const webpSource = document.createElement("source");
      const image = document.createElement("img");

      figure.className = "photo-item";
      button.className = "photo-button";
      button.type = "button";
      button.setAttribute("aria-label", `Open photo ${index + 1}`);
      webpSource.type = "image/webp";

      if (photo.thumbWebpSrcset || photo.thumbWebp) {
        webpSource.srcset = photo.thumbWebpSrcset || photo.thumbWebp;
      }

      image.src = photo.thumb || photo.src;

      if (photo.thumbSrcset) {
        image.srcset = photo.thumbSrcset;
      }

      image.sizes = "(max-width: 760px) calc(100vw - 2.8rem), 180px";
      image.alt = photo.alt || "";
      image.loading = index < 4 ? "eager" : "lazy";
      image.fetchPriority = index < 2 ? "high" : "auto";
      image.decoding = "async";

      button.addEventListener("click", () => openViewer(index));
      picture.append(webpSource, image);
      button.append(picture);
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
